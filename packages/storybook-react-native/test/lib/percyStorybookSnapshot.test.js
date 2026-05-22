import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — vi.mock factory must use vi.hoisted to share state with the
// test body, since vi.mock calls are themselves hoisted above imports.
const mocks = vi.hoisted(() => {
  return {
    percyScreenshotCalls: /** @type {Array<{ name: string, opts: any }>} */ ([]),
    navigateCalls: /** @type {Array<{ id: string, opts: any }>} */ ([]),
    navigateImpl: vi.fn(),
  };
});

vi.mock('@percy/appium-app', () => ({
  default: async (_driver, name, opts) => {
    mocks.percyScreenshotCalls.push({ name, opts });
  },
}));

vi.mock('../../percy/navigator/navigateToStory.js', () => ({
  navigateToStory: async (driver, story, opts) => {
    mocks.navigateCalls.push({ id: story.id, opts });
    return mocks.navigateImpl();
  },
}));

import percyStorybookSnapshot from '../../percy/percyStorybookSnapshot.js';

const STORY = {
  id: 'forms-button--primary',
  name: 'Primary',
  componentTitle: 'Forms/Button',
};

function mockDriver() {
  return {
    capabilities: {
      platformName: 'Android',
      'appium:platformVersion': '14.0',
      'appium:deviceName': 'Google Pixel 8',
    },
  };
}

describe('percyStorybookSnapshot — flat option surface', () => {
  beforeEach(() => {
    mocks.percyScreenshotCalls.length = 0;
    mocks.navigateCalls.length = 0;
    mocks.navigateImpl.mockReset();
    mocks.navigateImpl.mockReturnValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards percy-appium-js region options through to percyScreenshot', async () => {
    await percyStorybookSnapshot(mockDriver(), STORY, {
      // navigation opts (must NOT leak into percyScreenshot)
      renderMs: 1234,
      navigationStrategy: 'deeplink',
      // percyScreenshot opts (must reach percyScreenshot)
      ignoreRegionXpaths: ['//XCUIElementTypeOther[@name="header"]'],
      ignoreRegionAccessibilityIds: ['toast'],
      customIgnoreRegions: [{ top: 0, bottom: 50, left: 0, right: 100 }],
      considerRegionXpaths: ['//*[@id="content"]'],
      fullPage: true,
      screenLengths: 3,
      sync: true,
      testCase: 'forms-button-primary',
      labels: ['nightly', 'a11y'],
    });

    expect(mocks.percyScreenshotCalls).toHaveLength(1);
    const fwd = mocks.percyScreenshotCalls[0].opts;
    expect(fwd.ignoreRegionXpaths).toEqual(['//XCUIElementTypeOther[@name="header"]']);
    expect(fwd.ignoreRegionAccessibilityIds).toEqual(['toast']);
    expect(fwd.customIgnoreRegions).toEqual([{ top: 0, bottom: 50, left: 0, right: 100 }]);
    expect(fwd.considerRegionXpaths).toEqual(['//*[@id="content"]']);
    expect(fwd.fullPage).toBe(true);
    expect(fwd.screenLengths).toBe(3);
    expect(fwd.sync).toBe(true);
    expect(fwd.testCase).toBe('forms-button-primary');
    expect(fwd.labels).toEqual(['nightly', 'a11y']);
    // Navigation opts must NOT be forwarded.
    expect(fwd.renderMs).toBeUndefined();
    expect(fwd.navigationStrategy).toBeUndefined();
  });

  it('routes navigation-only keys to navigateToStory, not percyScreenshot', async () => {
    await percyStorybookSnapshot(mockDriver(), STORY, {
      navigationStrategy: 'deeplink',
      appScheme: 'myapp',
      appPackage: 'com.acme.storybook',
      renderMs: 500,
      coldBootMaxMs: 60_000,
      globalNavigationBudgetMs: 8000,
      stabilitySettleMs: 250,
      cacheNavigatorState: true,
    });

    expect(mocks.navigateCalls).toHaveLength(1);
    const navOpts = mocks.navigateCalls[0].opts;
    expect(navOpts.navigationStrategy).toBe('deeplink');
    expect(navOpts.appScheme).toBe('myapp');
    expect(navOpts.appPackage).toBe('com.acme.storybook');
    expect(navOpts.renderMs).toBe(500);
    expect(navOpts.coldBootMaxMs).toBe(60_000);
    expect(navOpts.globalNavigationBudgetMs).toBe(8000);
    expect(navOpts.stabilitySettleMs).toBe(250);
    expect(navOpts.cacheNavigatorState).toBe(true);

    const fwd = mocks.percyScreenshotCalls[0].opts;
    expect(fwd.navigationStrategy).toBeUndefined();
    expect(fwd.appScheme).toBeUndefined();
    expect(fwd.appPackage).toBeUndefined();
  });

  it('legacy nested `snapshot: {…}` escape hatch wins over flat keys for the same name', async () => {
    await percyStorybookSnapshot(mockDriver(), STORY, {
      fullPage: false, // flat
      snapshot: { fullPage: true, deviceName: 'Override Pixel' },
    });

    const fwd = mocks.percyScreenshotCalls[0].opts;
    expect(fwd.fullPage).toBe(true);
    expect(fwd.deviceName).toBe('Override Pixel');
  });

  it('defaults freezeAnimatedImage to true (overridable at top level)', async () => {
    await percyStorybookSnapshot(mockDriver(), STORY, {});
    expect(mocks.percyScreenshotCalls[0].opts.freezeAnimatedImage).toBe(true);

    mocks.percyScreenshotCalls.length = 0;
    await percyStorybookSnapshot(mockDriver(), STORY, { freezeAnimatedImage: false });
    expect(mocks.percyScreenshotCalls[0].opts.freezeAnimatedImage).toBe(false);
  });

  it('composes snapshot name as componentTitle/name/deviceLabel', async () => {
    await percyStorybookSnapshot(mockDriver(), STORY, {});
    const name = mocks.percyScreenshotCalls[0].name;
    expect(name.startsWith('Forms/Button/Primary/')).toBe(true);
  });

  it('rejects invalid story descriptors before doing any work', async () => {
    await expect(
      percyStorybookSnapshot(mockDriver(), { id: '', name: '', componentTitle: '' }, {}),
    ).rejects.toThrow();
    expect(mocks.navigateCalls).toHaveLength(0);
    expect(mocks.percyScreenshotCalls).toHaveLength(0);
  });
});
