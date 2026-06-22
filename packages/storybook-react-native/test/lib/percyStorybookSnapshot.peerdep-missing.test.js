import { afterEach, describe, expect, it, vi } from 'vitest';

// Isolated test file: percyStorybookSnapshot lazy-imports the optional peer
// dependency `@percy/appium-app`. When it is not installed the import rejects
// and the SDK must surface a `percy_appium_app_missing` error with an install
// hint. We mock the module to throw at import time so the catch block runs —
// this lives in its own file because the sibling suite mocks the SAME module to
// SUCCEED, and a per-test mock swap would leak across the shared module graph.
vi.mock('@percy/appium-app', () => {
  throw new Error('Cannot find package @percy/appium-app');
});

// navigateToStory is irrelevant here — the import failure throws before any
// navigation — but stub it so the real (driver-bound) module is never loaded.
vi.mock('../../percy/navigator/navigateToStory.js', () => ({
  navigateToStory: async () => {},
}));

const { default: percyStorybookSnapshot } = await import('../../percy/percyStorybookSnapshot.js');

const STORY = { id: 'forms-button--primary', name: 'Primary', componentTitle: 'Forms/Button' };

function mockDriver() {
  return {
    capabilities: {
      platformName: 'Android',
      'appium:platformVersion': '14.0',
      'appium:deviceName': 'Google Pixel 8',
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('percyStorybookSnapshot — missing @percy/appium-app peer dependency', () => {
  it('throws percy_appium_app_missing with an install hint when the peer dep is absent', async () => {
    await expect(percyStorybookSnapshot(mockDriver(), STORY, {})).rejects.toMatchObject({
      code: 'percy_appium_app_missing',
    });
  });

  it('attaches the underlying import failure as the error cause', async () => {
    let thrown;
    try {
      await percyStorybookSnapshot(mockDriver(), STORY, {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('percy_appium_app_missing');
    // The original import rejection is preserved (not swallowed) as `cause`.
    expect(thrown.cause).toBeInstanceOf(Error);
    // And the actionable install hint is surfaced to the customer.
    expect(String(thrown.nextStep ?? '')).toContain('@percy/appium-app');
  });
});
