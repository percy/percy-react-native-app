import { perDriver } from '../util/cache.js';
import { log } from '../util/log.js';
import { err } from '../../src/errors.js';

/**
 * UI-tap navigation strategy for Storybook RN's in-app navigator.
 *
 * Verified for `@storybook/react-native` v10.x via source inspection:
 *  - `mobile-menu-button` testID: drawer toggle (both `react-native-ui-lite`
 *    and `react-native-ui` packages where exposed)
 *  - `storybook-explorer-tree` testID: tree container (lite only)
 *  - Tree leaves and component groups have NO testID and NO accessibilityLabel
 *    — text-match is the only handle for them
 *
 * State machine, scoped per-driver via WeakMap (no cross-driver leakage):
 *   { drawerOpen: bool, expandedComponents: Set<string>, currentStoryId: string|null }
 *
 * Sort stories by componentTitle in the customer's iteration loop to
 * maximize cache hits — saves ~500ms per intra-group story.
 */

const DEFAULTS = {
  coldBootMaxMs: 30000,            // poll-for-ready ceiling (replaces fixed sleep)
  globalNavigationBudgetMs: 8000,  // hard ceiling per snapshotStory call
  testIdPollMaxMs: 3000,
  stabilityPollMaxMs: 1000,
  stabilityMaxAttempts: 4,
  stabilitySettleMs: 200,          // first stability capture deferred by this much
  renderMs: 1500,                  // hard fallback when other signals exhaust
  cacheNavigatorState: false,      // off by default; opt-in for power users
};

/**
 * Hash a base64 PNG screenshot for stability comparison. Uses a cheap
 * non-cryptographic hash over a downsampled byte stride to absorb anti-
 * aliasing noise. Good enough for "did the frame stop changing" — not for
 * diffing (Percy backend handles that).
 *
 * @param {string} base64
 * @returns {string}
 */
function cheapImageHash(base64) {
  // Strip the PNG signature + IHDR + downsample by skipping bytes
  // (we only care about whether two consecutive frames are the same).
  let h = 5381;
  // Sample every 47th char — 47 is prime, avoids striding through any
  // common base64 alignment.
  for (let i = 100; i < base64.length; i += 47) {
    h = ((h << 5) + h + base64.charCodeAt(i)) & 0xffffffff;
  }
  return h.toString(36);
}

/**
 * Initialize / fetch per-driver navigator state.
 */
function getState(driver) {
  let s = perDriver.get(driver);
  if (!s) {
    s = {
      drawerOpen: false,
      expandedComponents: new Set(),
      currentStoryId: null,
      consecutiveDivergences: 0,
      cacheDisabledForSession: false,
    };
    perDriver.set(driver, s);
  }
  return s;
}

/**
 * Drop cached navigator state for this driver — used after a divergence
 * detection or when the customer wants to force a fresh navigation.
 */
function resetState(driver) {
  perDriver.delete(driver);
}

/**
 * Poll for an element matching `selector` until it exists or timeout.
 * Returns the element on success, undefined on timeout.
 */
async function pollForElement(appiumDriver, selector, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const el = await appiumDriver.$(selector);
      // webdriverio returns a lazy element wrapper; check existence before returning.
      const exists = typeof el.isExisting === 'function' ? await el.isExisting() : true;
      if (exists) return el;
    } catch {
      // ignore — element not yet present
    }
    await appiumDriver.pause(250);
  }
  return undefined;
}

/**
 * Cold-boot readiness — polls for the drawer toggle until present or until
 * the cold-boot ceiling. Distinct from `nav_element_not_found` so the
 * circuit breaker classifies correctly.
 */
async function awaitColdBoot(appiumDriver, opts) {
  const started = Date.now();
  // Try testID first (verified stable in v10), fall back to text match.
  while (Date.now() - started < opts.coldBootMaxMs) {
    const byId = await pollForElement(appiumDriver, '~mobile-menu-button', 500);
    if (byId) return byId;
    const byText = await pollForElement(
      appiumDriver,
      'android=new UiSelector().text("Open story list")',
      500,
    );
    if (byText) return byText;
  }
  throw err(
    'app_cold_boot_timeout',
    `Storybook RN navigator did not appear within ${opts.coldBootMaxMs}ms.`,
    'Confirm the host app is a Storybook-RN build (not the production app), and that the device finished cold-booting.',
  );
}

/**
 * Open the navigator drawer if not already open. Idempotent.
 */
async function openDrawer(appiumDriver, state) {
  if (state.drawerOpen) return;
  const toggle = await pollForElement(appiumDriver, '~mobile-menu-button', 2000);
  if (!toggle) {
    throw err(
      'nav_element_not_found',
      'Could not locate Storybook RN drawer toggle (mobile-menu-button).',
      'Verify the host app uses @storybook/react-native v10.x and exposes the drawer.',
    );
  }
  await toggle.click();
  state.drawerOpen = true;
  // Small settle — drawer animation + first frame.
  await appiumDriver.pause(300);
}

/**
 * Tap a tree node by visible text. Text-match is the only stable handle
 * for tree leaves and component groups in v10 (no testID, no a11y label
 * exposed by Storybook RN).
 */
async function tapByText(appiumDriver, text) {
  // Sanitize — UiSelector text() literal cannot contain unescaped quotes.
  const safe = String(text).replace(/"/g, '\\"');
  const selector = `android=new UiSelector().text("${safe}")`;
  const el = await pollForElement(appiumDriver, selector, 2000);
  if (!el) {
    throw err(
      'nav_element_not_found',
      `Could not find Storybook navigator entry with text "${text}".`,
      'Confirm the component title and story name match the on-device sidebar exactly.',
    );
  }
  await el.click();
}

/**
 * Walk componentTitle path. Splits on un-escaped slashes (CSF allows
 * escaped slashes in titles, e.g. `Forms\/Button` = single segment).
 * Each segment that hasn't been expanded yet is tapped to expand.
 */
async function expandPath(appiumDriver, componentTitle, state) {
  const segments = componentTitle.split(/(?<!\\)\//).map((s) => s.replace(/\\\//g, '/'));
  let path = '';
  for (const seg of segments) {
    path = path ? `${path}/${seg}` : seg;
    if (!state.expandedComponents.has(path)) {
      await tapByText(appiumDriver, seg);
      state.expandedComponents.add(path);
    }
  }
  return segments;
}

/**
 * Render-ready signal hierarchy under a global per-story budget.
 *
 *   1. Cooperative testID poll (Phase 2 — opt-in addon emits
 *      `percy-ready-<storyId>` after InteractionManager.runAfterInteractions).
 *   2. Bounded screenshot stability — first capture deferred by
 *      stabilitySettleMs (200ms) so we don't accept the pre-render frame
 *      as "stable"; require 3 consecutive matching hashes.
 *   3. Hard renderMs fallback when both above exhaust their caps.
 *
 * If the global budget is exceeded across all signals, throw nav_render_timeout
 * with the per-tier durations attached for telemetry.
 */
async function awaitRenderReady(appiumDriver, descriptor, opts) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const remaining = () => Math.max(0, opts.globalNavigationBudgetMs - elapsed());

  const tierDurations = { testId: 0, stability: 0, renderMs: 0 };

  // Tier 1 — cooperative testID. Phase 2 surface; harmless to probe in Phase 1
  // because the testID will simply not be present.
  const testIdSelector = `~percy-ready-${descriptor.id}`;
  const testIdCap = Math.min(opts.testIdPollMaxMs, remaining());
  if (testIdCap > 0) {
    const t0 = Date.now();
    const el = await pollForElement(appiumDriver, testIdSelector, testIdCap);
    tierDurations.testId = Date.now() - t0;
    if (el) return tierDurations;
  }
  if (elapsed() >= opts.globalNavigationBudgetMs) {
    throw err(
      'nav_render_timeout',
      `Story ${descriptor.id} did not become ready within ${opts.globalNavigationBudgetMs}ms.`,
      'Increase globalNavigationBudgetMs, or check the device for a hung animation / modal.',
      tierDurations,
    );
  }

  // Tier 2 — bounded screenshot stability with a settle delay.
  const stabilityT0 = Date.now();
  await appiumDriver.pause(opts.stabilitySettleMs);
  const hashes = [];
  let attempt = 0;
  while (
    attempt < opts.stabilityMaxAttempts &&
    elapsed() < opts.globalNavigationBudgetMs &&
    Date.now() - stabilityT0 < opts.stabilityPollMaxMs
  ) {
    const png = await appiumDriver.takeScreenshot();
    hashes.push(cheapImageHash(png));
    if (hashes.length >= 3) {
      const last3 = hashes.slice(-3);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        tierDurations.stability = Date.now() - stabilityT0;
        return tierDurations;
      }
    }
    await appiumDriver.pause(150);
    attempt++;
  }
  tierDurations.stability = Date.now() - stabilityT0;

  // Tier 3 — hard renderMs fallback.
  const renderCap = Math.min(opts.renderMs, remaining());
  if (renderCap > 0) {
    const t0 = Date.now();
    await appiumDriver.pause(renderCap);
    tierDurations.renderMs = Date.now() - t0;
  }

  if (elapsed() >= opts.globalNavigationBudgetMs) {
    throw err(
      'nav_render_timeout',
      `Story ${descriptor.id} did not become ready within ${opts.globalNavigationBudgetMs}ms.`,
      'Increase globalNavigationBudgetMs, or check the device for a hung animation / modal.',
      tierDurations,
    );
  }
  return tierDurations;
}

/**
 * Verify cached state still matches device reality. If a previously
 * expanded component group is not present, the cache has diverged —
 * evict and let the caller replay the full sequence.
 */
async function verifyCachedState(appiumDriver, state) {
  if (state.expandedComponents.size === 0) return true;
  // Cheap probe: check for any one of the cached component-group texts.
  const sample = state.expandedComponents.values().next().value;
  // Use the leaf-most segment of the sample path.
  const leafText = String(sample).split('/').pop();
  const safe = leafText.replace(/"/g, '\\"');
  const el = await pollForElement(
    appiumDriver,
    `android=new UiSelector().text("${safe}")`,
    500,
  );
  return Boolean(el);
}

/**
 * Public entry point — called by navigateToStory.js.
 *
 * @param {object} appiumDriver  AppiumDriver wrapper instance
 * @param {{ id: string, name: string, componentTitle: string }} descriptor
 * @param {object} opts  merged options (DEFAULTS overlaid by caller)
 */
export async function uiTapNavigate(appiumDriver, descriptor, opts) {
  const merged = { ...DEFAULTS, ...opts };
  const state = getState(appiumDriver.driver);

  // Cold-boot poll — only on first call per driver.
  if (!state.warmedUp) {
    await awaitColdBoot(appiumDriver, merged);
    state.warmedUp = true;
  }

  // Verify cache validity if we're about to use it.
  if (merged.cacheNavigatorState && !state.cacheDisabledForSession && state.drawerOpen) {
    const valid = await verifyCachedState(appiumDriver, state);
    if (!valid) {
      log.warn(`[storybook-rn] navigator state diverged — replaying from root.`);
      state.consecutiveDivergences += 1;
      if (state.consecutiveDivergences >= 2) {
        log.warn(`[storybook-rn] cache disabled for the rest of this session.`);
        state.cacheDisabledForSession = true;
      }
      resetState(appiumDriver.driver);
    }
  }

  // Re-fetch state in case it was reset above.
  const s = getState(appiumDriver.driver);

  // If caching is off, always start from a known state.
  if (!merged.cacheNavigatorState || s.cacheDisabledForSession) {
    s.drawerOpen = false;
    s.expandedComponents.clear();
  }

  await openDrawer(appiumDriver, s);
  await expandPath(appiumDriver, descriptor.componentTitle, s);
  await tapByText(appiumDriver, descriptor.name);
  s.currentStoryId = descriptor.id;

  const tierDurations = await awaitRenderReady(appiumDriver, descriptor, merged);
  return tierDurations;
}

export const __forTesting = {
  cheapImageHash,
  DEFAULTS,
};
