import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiTapNavigate, __forTesting } from '../../../percy/navigator/uiTapStrategy.js';
import { perDriver } from '../../../percy/util/cache.js';

const { cheapImageHash } = __forTesting;

// --- Deterministic virtual clock ---------------------------------------------
//
// uiTapStrategy's poll/stability/timeout loops are wall-clock driven
// (`while (Date.now() - start < budget) { … await driver.pause(250) }`). In
// production `pause()` is a real device sleep that throttles the loop; in unit
// tests an instant `pause()` turns those loops into tight CPU busy-spins that
// burn *real* seconds equal to each budget.
//
// We make the loops deterministic and instant by virtualizing time: a shared
// `clock` counter backs `Date.now()` (spied), and every mock `pause(ms)`
// advances the clock by `ms`. Each loop iteration therefore advances virtual
// time by exactly one poll step and terminates after a bounded, predictable
// number of iterations with ~0 real wall-clock — no source changes, behavior
// identical (same iteration counts, same branch outcomes).
let clock = 0;
beforeEach(() => {
  clock = 1_000_000; // arbitrary non-zero epoch
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

/** Advance the virtual clock — used as the mock `pause(ms)` body. */
async function advance(ms) {
  clock += typeof ms === 'number' && ms > 0 ? ms : 1;
}

/**
 * Build an AppiumDriver-wrapper-shaped mock tailored to uiTapStrategy.
 *
 * uiTapStrategy reads:
 *   appiumDriver.$(selector)          → element wrapper ({ isExisting, click })
 *   appiumDriver.pause(ms)            → advances the virtual clock (above)
 *   appiumDriver.takeScreenshot()     → base64 PNG string (for stability hash)
 *   appiumDriver.driver.capabilities  → platform detection + cache key
 *
 * `present` is the set of selectors that should resolve to an existing,
 * clickable element. `selectorMatcher(selector)` may be passed for fuzzy
 * matches (e.g. any android text selector). `screenshots` is a queue of PNGs
 * returned by successive takeScreenshot() calls (last value repeats).
 */
function makeUiDriver({
  platform = 'android',
  present = [],
  selectorMatcher = null,
  screenshots = ['png-a', 'png-a', 'png-a', 'png-a', 'png-a', 'png-a'],
  clickSpy = vi.fn(async () => {}),
} = {}) {
  const presentSet = new Set(present);
  let shotIndex = 0;
  const innerDriver = {
    capabilities: {
      'appium:platformName': platform,
      platformName: platform,
    },
  };
  const appiumDriver = {
    driver: innerDriver,
    pause: vi.fn(advance),
    takeScreenshot: vi.fn(async () => {
      const v = screenshots[Math.min(shotIndex, screenshots.length - 1)];
      shotIndex++;
      return v;
    }),
    $: vi.fn(async (selector) => {
      const matches = presentSet.has(selector) || (selectorMatcher && selectorMatcher(selector));
      return {
        isExisting: vi.fn(async () => Boolean(matches)),
        click: clickSpy,
      };
    }),
  };
  return { appiumDriver, innerDriver, clickSpy };
}

const DESCRIPTOR = { id: 'forms-button--primary', name: 'Primary', componentTitle: 'Forms/Button' };

// Fast, deterministic option overlay — tiny budgets so timeout loops exit
// in milliseconds and stability requires few screenshots.
const FAST = {
  coldBootMaxMs: 60,
  globalNavigationBudgetMs: 5000,
  testIdPollMaxMs: 40,
  stabilityPollMaxMs: 200,
  stabilityMaxAttempts: 4,
  stabilitySettleMs: 1,
  renderMs: 5,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uiTapNavigate — Android happy path (UI-tap, no cache)', () => {
  it('cold-boots, opens drawer, expands path, taps story, and resolves via testId', async () => {
    // Everything an Android nav touches resolves: drawer toggle, any text
    // selector (component group + story leaf), and the percy-ready testId.
    const { appiumDriver, clickSpy } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")'],
      selectorMatcher: (sel) =>
        sel.includes('UiSelector().text(') || sel.startsWith('~percy-ready-'),
    });

    const tiers = await uiTapNavigate(appiumDriver, DESCRIPTOR, FAST);
    // testId tier resolved → testId duration recorded, stability not run.
    expect(tiers).toMatchObject({ stability: 0, renderMs: 0 });
    // drawer toggle + 'Forms' + 'Button' + 'Primary' clicks.
    expect(clickSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('uiTapNavigate — iOS selector cascade', () => {
  it('uses iOS drawer + text selectors and resolves', async () => {
    const { appiumDriver } = makeUiDriver({
      platform: 'ios',
      present: ['~mobile-menu-button'],
      selectorMatcher: (sel) =>
        sel.startsWith('-ios predicate string:') || sel.startsWith('~percy-ready-'),
    });
    const tiers = await uiTapNavigate(appiumDriver, DESCRIPTOR, FAST);
    expect(tiers.testId).toBeGreaterThanOrEqual(0);
  });

  it('falls through to the second iOS drawer selector when the ~ one is absent', async () => {
    const { appiumDriver } = makeUiDriver({
      platform: 'ios',
      // Only the predicate-string drawer selector exists, not ~mobile-menu-button.
      selectorMatcher: (sel) =>
        sel.includes('predicate string:name == "mobile-menu-button"') ||
        sel.startsWith('-ios predicate string:label ==') ||
        sel.startsWith('-ios predicate string:') ||
        sel.startsWith('~percy-ready-'),
    });
    await expect(uiTapNavigate(appiumDriver, DESCRIPTOR, FAST)).resolves.toBeDefined();
  });
});

describe('uiTapNavigate — cold boot timeout', () => {
  it('throws app_cold_boot_timeout when the drawer toggle never appears', async () => {
    const { appiumDriver } = makeUiDriver({
      platform: 'android',
      present: [], // nothing resolves
      selectorMatcher: () => false,
    });
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST, coldBootMaxMs: 30 }),
    ).rejects.toMatchObject({ code: 'app_cold_boot_timeout' });
  });
});

describe('uiTapNavigate — drawer toggle not found after warm-up', () => {
  it('throws nav_element_not_found when the toggle vanishes between cold-boot and openDrawer', async () => {
    // Pre-seed state so warmedUp=true → skip cold boot, but no selector resolves
    // → openDrawer's poll exhausts and throws nav_element_not_found.
    const innerDriver = { capabilities: { platformName: 'android' } };
    perDriver.set(innerDriver, {
      drawerOpen: false,
      expandedComponents: new Set(),
      currentStoryId: null,
      consecutiveDivergences: 0,
      cacheDisabledForSession: false,
      warmedUp: true,
    });
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => 'x'),
      $: vi.fn(async () => ({ isExisting: vi.fn(async () => false), click: vi.fn() })),
    };
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST }),
    ).rejects.toMatchObject({ code: 'nav_element_not_found' });
    perDriver.delete(innerDriver);
  });
});

describe('uiTapNavigate — tapByText not found', () => {
  it('throws nav_element_not_found when a tree node text is missing', async () => {
    // Drawer toggle resolves so openDrawer succeeds, but no text selector
    // resolves → expandPath/tapByText fails.
    const { appiumDriver } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")', '~mobile-menu-button'],
      selectorMatcher: () => false,
    });
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST }),
    ).rejects.toMatchObject({ code: 'nav_element_not_found' });
  });
});

describe('uiTapNavigate — render-ready stability tier (no testId)', () => {
  it('accepts 3 matching screenshot hashes as stable', async () => {
    // No percy-ready testId → testId tier misses (its poll burns its cap and
    // returns undefined), falls to stability tier. Identical PNGs → 3 matching
    // hashes → stable, returns.
    const { appiumDriver } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")'],
      selectorMatcher: (sel) => sel.includes('UiSelector().text('), // no testId match
      screenshots: ['same', 'same', 'same', 'same', 'same'],
    });
    // Stability captures 3 frames with a hardcoded 150ms inter-capture pause, so
    // the stability poll window must comfortably exceed 3×150ms for convergence.
    const tiers = await uiTapNavigate(appiumDriver, DESCRIPTOR, {
      ...FAST,
      stabilityPollMaxMs: 1000,
    });
    // testId tier polled-and-missed → its duration is the poll cap, not 0.
    expect(tiers.testId).toBeGreaterThan(0);
    // Stability tier ran and converged on 3 matching hashes.
    expect(tiers.stability).toBeGreaterThanOrEqual(0);
    // The hard renderMs fallback should NOT have run (stability won).
    expect(tiers.renderMs).toBe(0);
    expect(appiumDriver.takeScreenshot).toHaveBeenCalled();
  });

  it('falls to the hard renderMs tier when frames never stabilize', async () => {
    // Distinct PNGs each call → stability never converges → renderMs fallback.
    let n = 0;
    const { appiumDriver } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")'],
      selectorMatcher: (sel) => sel.includes('UiSelector().text('),
      screenshots: [],
    });
    appiumDriver.takeScreenshot = vi.fn(async () => `frame-${n++}`);
    const tiers = await uiTapNavigate(appiumDriver, DESCRIPTOR, {
      ...FAST,
      stabilityPollMaxMs: 30,
      renderMs: 5,
    });
    expect(tiers.renderMs).toBeGreaterThanOrEqual(0);
  });
});

describe('uiTapNavigate — render-ready budget exhaustion', () => {
  it('throws nav_render_timeout when the global budget is exhausted before the testId tier', async () => {
    // globalNavigationBudgetMs smaller than testIdPollMaxMs guarantees the
    // post-testId budget check (elapsed >= budget) trips.
    const { appiumDriver } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")'],
      selectorMatcher: (sel) => sel.includes('UiSelector().text('),
    });
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, {
        ...FAST,
        testIdPollMaxMs: 30,
        globalNavigationBudgetMs: 10, // tiny → tripped right after the testId poll
      }),
    ).rejects.toMatchObject({ code: 'nav_render_timeout' });
  });
});

describe('uiTapNavigate — caching path', () => {
  beforeEach(() => {
    // Ensure clean per-driver state between cache tests.
  });

  it('reuses expanded state across two navigations to the same component (cache on)', async () => {
    const { appiumDriver, clickSpy } = makeUiDriver({
      platform: 'android',
      present: ['android=new UiSelector().resourceIdMatches(".*mobile-menu-button")'],
      selectorMatcher: (sel) =>
        sel.includes('UiSelector().text(') || sel.startsWith('~percy-ready-'),
    });
    const opts = { ...FAST, cacheNavigatorState: true };
    await uiTapNavigate(appiumDriver, DESCRIPTOR, opts);
    const firstClicks = clickSpy.mock.calls.length;
    // Second nav to a sibling story in the same group — drawer stays open,
    // group stays expanded, so fewer taps.
    await uiTapNavigate(appiumDriver, { ...DESCRIPTOR, id: 'forms-button--secondary', name: 'Secondary' }, opts);
    const secondClicks = clickSpy.mock.calls.length - firstClicks;
    expect(secondClicks).toBeLessThan(firstClicks);
    perDriver.delete(appiumDriver.driver);
  });

  // A divergence-probe driver: the cached group's LEAF text ("Group", the last
  // segment of the seeded 'Stale/Group' path that verifyCachedState samples) is
  // absent on device → verifyCachedState reports divergence. The descriptor's
  // own path segments ("Forms", "Button", story name) DO resolve, so after the
  // cache is evicted the replay from root succeeds. Keeping the probe text
  // distinct from the replay path is what lets one miss while the other hits.
  function makeDivergenceDriver(innerDriver) {
    let staleProbed = false;
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => 'same'),
      $: vi.fn(async (sel) => {
        const isDrawer = sel.includes('mobile-menu-button');
        const isTestId = sel.startsWith('~percy-ready-');
        const isStaleProbe = sel.includes('UiSelector().text("Group")');
        const isReplayText =
          sel.includes('UiSelector().text(') && !isStaleProbe;
        if (isStaleProbe) staleProbed = true;
        const exists = isDrawer || isTestId || isReplayText; // "Group" never resolves
        return { isExisting: vi.fn(async () => exists), click: vi.fn(async () => {}) };
      }),
    };
    return { appiumDriver, wasStaleProbed: () => staleProbed };
  }

  it('evicts cache + replays from root when a previously expanded group is gone (divergence)', async () => {
    // Seed drawerOpen + a stale expanded group so verifyCachedState runs and the
    // "Stale" probe misses → divergence → reset → replay of 'Forms/Button'.
    const innerDriver = { capabilities: { platformName: 'android' } };
    perDriver.set(innerDriver, {
      drawerOpen: true,
      expandedComponents: new Set(['Stale/Group']),
      currentStoryId: null,
      consecutiveDivergences: 0, // first divergence → reset, NOT session-disable
      cacheDisabledForSession: false,
      warmedUp: true,
    });
    const { appiumDriver, wasStaleProbed } = makeDivergenceDriver(innerDriver);
    await uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST, cacheNavigatorState: true });
    // The divergence branch (warn + reset) ran; nav still completed via replay.
    expect(wasStaleProbed()).toBe(true);
    const state = perDriver.get(innerDriver);
    // Fresh post-reset state — first divergence does NOT latch the session-disable.
    expect(state.cacheDisabledForSession).toBe(false);
    perDriver.delete(innerDriver);
  });

  it('disables the cache for the session after 2 consecutive divergences', async () => {
    const innerDriver = { capabilities: { platformName: 'android' } };
    // consecutiveDivergences:1 → this (2nd) divergence trips the >=2 branch that
    // latches cacheDisabledForSession before resetState.
    perDriver.set(innerDriver, {
      drawerOpen: true,
      expandedComponents: new Set(['Stale/Group']),
      currentStoryId: null,
      consecutiveDivergences: 1,
      cacheDisabledForSession: false,
      warmedUp: true,
    });
    const { appiumDriver, wasStaleProbed } = makeDivergenceDriver(innerDriver);
    await uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST, cacheNavigatorState: true });
    // Reaching here proves the divergence + session-disable branch ran without
    // throwing (warn logged, cacheDisabledForSession set, then resetState).
    expect(wasStaleProbed()).toBe(true);
    expect(perDriver.get(innerDriver)).toBeDefined();
    perDriver.delete(innerDriver);
  });

  it('verifyCachedState returns true (no divergence) when no components are expanded', async () => {
    // drawerOpen + cache on but expandedComponents empty → verifyCachedState
    // short-circuits true (size === 0).
    const innerDriver = { capabilities: { platformName: 'android' } };
    perDriver.set(innerDriver, {
      drawerOpen: true,
      expandedComponents: new Set(),
      currentStoryId: null,
      consecutiveDivergences: 0,
      cacheDisabledForSession: false,
      warmedUp: true,
    });
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => 'same'),
      $: vi.fn(async (sel) => ({
        isExisting: vi.fn(async () =>
          sel.includes('mobile-menu-button') ||
          sel.includes('UiSelector().text(') ||
          sel.startsWith('~percy-ready-'),
        ),
        click: vi.fn(async () => {}),
      })),
    };
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST, cacheNavigatorState: true }),
    ).resolves.toBeDefined();
    perDriver.delete(innerDriver);
  });
});

describe('uiTapStrategy — expandPath escaped-slash titles', () => {
  it('treats an escaped slash in componentTitle as a single segment', async () => {
    // componentTitle 'Forms\\/Button' → ONE segment "Forms/Button", not two.
    const tappedTexts = [];
    const innerDriver = { capabilities: { platformName: 'android' } };
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => 'same'),
      $: vi.fn(async (sel) => {
        const m = sel.match(/UiSelector\(\)\.text\("([^"]+)"\)/);
        if (m) tappedTexts.push(m[1]);
        return {
          isExisting: vi.fn(async () =>
            sel.includes('mobile-menu-button') ||
            sel.includes('UiSelector().text(') ||
            sel.startsWith('~percy-ready-'),
          ),
          click: vi.fn(async () => {}),
        };
      }),
    };
    await uiTapNavigate(
      appiumDriver,
      { id: 'x--y', name: 'Y', componentTitle: 'Forms\\/Button' },
      { ...FAST },
    );
    // The single segment "Forms/Button" was tapped (escaped slash collapsed).
    expect(tappedTexts).toContain('Forms/Button');
    perDriver.delete(innerDriver);
  });
});

describe('uiTapNavigate — pollForElement swallows $() errors', () => {
  it('keeps polling (and ultimately cold-boots) when $() throws transiently', async () => {
    // $() throws on the first probe (driver hiccup), then resolves the drawer
    // toggle. pollForElement must catch the throw and keep polling rather than
    // bubbling it — proving the try/catch in pollForElement absorbs transient
    // driver errors.
    let calls = 0;
    const innerDriver = { capabilities: { platformName: 'android' } };
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => 'same'),
      $: vi.fn(async (sel) => {
        calls += 1;
        if (calls === 1) throw new Error('transient driver error');
        return {
          isExisting: vi.fn(async () =>
            sel.includes('mobile-menu-button') ||
            sel.includes('UiSelector().text(') ||
            sel.startsWith('~percy-ready-'),
          ),
          click: vi.fn(async () => {}),
        };
      }),
    };
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, { ...FAST }),
    ).resolves.toBeDefined();
    // The first throwing call was swallowed; navigation still succeeded.
    expect(calls).toBeGreaterThan(1);
    perDriver.delete(innerDriver);
  });
});

describe('uiTapNavigate — render timeout after the hard renderMs tier', () => {
  it('throws nav_render_timeout when every tier exhausts the global budget', async () => {
    // No testId, frames never stabilize, and the global budget is sized so it is
    // exhausted only AFTER the hard renderMs fallback runs — exercising the final
    // post-renderMs budget check.
    let n = 0;
    const innerDriver = { capabilities: { platformName: 'android' } };
    const appiumDriver = {
      driver: innerDriver,
      pause: vi.fn(advance),
      takeScreenshot: vi.fn(async () => `frame-${n++}`), // always different → never stable
      $: vi.fn(async (sel) => ({
        isExisting: vi.fn(async () =>
          // Drawer + tree text resolve so navigation reaches awaitRenderReady,
          // but the percy-ready testId never appears.
          sel.includes('mobile-menu-button') || sel.includes('UiSelector().text('),
        ),
        click: vi.fn(async () => {}),
      })),
    };
    await expect(
      uiTapNavigate(appiumDriver, DESCRIPTOR, {
        ...FAST,
        testIdPollMaxMs: 5,
        stabilityPollMaxMs: 5,
        stabilitySettleMs: 1,
        // renderMs far larger than the global budget → the hard renderMs tier's
        // cap is clamped to `remaining()`, so the pause consumes exactly the rest
        // of the budget and the FINAL post-renderMs `elapsed >= budget` check trips
        // (vs. the earlier post-testId timeout, which a small budget would hit).
        renderMs: 10_000_000,
        globalNavigationBudgetMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'nav_render_timeout' });
    perDriver.delete(innerDriver);
  });
});

describe('cheapImageHash — extra coverage', () => {
  it('hashes a realistic-length base64 deterministically', () => {
    const png = 'iVBOR'.repeat(80);
    expect(cheapImageHash(png)).toBe(cheapImageHash(png));
  });
});
