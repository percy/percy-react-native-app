import { describe, expect, it, vi } from 'vitest';

// Stub the two strategy modules so we can verify the dispatch logic in
// navigateToStory.js without dragging in real driver/W3C plumbing.
vi.mock('../../../percy/navigator/uiTapStrategy.js', () => ({
  uiTapNavigate: vi.fn().mockResolvedValue('ui-tap-ok'),
}));
vi.mock('../../../percy/navigator/deepLinkStrategy.js', () => ({
  deepLinkNavigate: vi.fn().mockResolvedValue('deep-link-ok'),
}));

const { navigateToStory } = await import('../../../percy/navigator/navigateToStory.js');
const { uiTapNavigate } = await import('../../../percy/navigator/uiTapStrategy.js');
const { deepLinkNavigate } = await import('../../../percy/navigator/deepLinkStrategy.js');

const driver = { fake: true };
const descriptor = { id: 'ex--p', name: 'P', componentTitle: 'Ex' };

describe('navigateToStory — strategy dispatch', () => {
  it('routes to UI-tap by default', async () => {
    uiTapNavigate.mockClear();
    deepLinkNavigate.mockClear();
    await navigateToStory(driver, descriptor);
    expect(uiTapNavigate).toHaveBeenCalledOnce();
    expect(deepLinkNavigate).not.toHaveBeenCalled();
  });

  it('routes to UI-tap when navigationStrategy is explicitly "ui-tap"', async () => {
    uiTapNavigate.mockClear();
    deepLinkNavigate.mockClear();
    await navigateToStory(driver, descriptor, { navigationStrategy: 'ui-tap' });
    expect(uiTapNavigate).toHaveBeenCalledOnce();
    expect(deepLinkNavigate).not.toHaveBeenCalled();
  });

  it('routes to deep-link when navigationStrategy === "deeplink"', async () => {
    uiTapNavigate.mockClear();
    deepLinkNavigate.mockClear();
    await navigateToStory(driver, descriptor, {
      navigationStrategy: 'deeplink',
      appScheme: 'fixture',
      appPackage: 'com.example.fixture',
    });
    expect(deepLinkNavigate).toHaveBeenCalledOnce();
    expect(uiTapNavigate).not.toHaveBeenCalled();
  });

  it('forwards options + driver + descriptor to the chosen strategy', async () => {
    uiTapNavigate.mockClear();
    const opts = { renderMs: 1234 };
    await navigateToStory(driver, descriptor, opts);
    expect(uiTapNavigate).toHaveBeenCalledWith(driver, descriptor, opts);
  });
});
