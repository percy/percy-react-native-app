import { describe, expect, it, vi } from 'vitest';
import {
  buildDeepLinkUrl,
  deepLinkNavigate,
} from '../../../percy/navigator/deepLinkStrategy.js';

describe('buildDeepLinkUrl', () => {
  it('round-trips a canonical CSF story id', () => {
    const url = buildDeepLinkUrl('myapp', 'forms-button--primary');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('STORYBOOK_STORY_ID')).toBe('forms-button--primary');
  });

  it('encodes & in story ids', () => {
    const url = buildDeepLinkUrl('myapp', 'a&b--c');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('STORYBOOK_STORY_ID')).toBe('a&b--c');
  });

  it('encodes spaces and unicode', () => {
    const url = buildDeepLinkUrl('myapp', 'a b--c');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('STORYBOOK_STORY_ID')).toBe('a b--c');
  });

  it('uses :/// triple-slash form (matches Storybook RN expo-example pattern)', () => {
    expect(buildDeepLinkUrl('myapp', 'x')).toMatch(/^myapp:\/\/\/\?STORYBOOK_STORY_ID=/);
  });
});

describe('deepLinkNavigate', () => {
  function mockAppium() {
    return {
      executeScript: vi.fn(async () => {}),
      pause: vi.fn(async () => {}),
    };
  }

  it('issues mobile: deepLink with the right shape', async () => {
    const appium = mockAppium();
    await deepLinkNavigate(
      appium,
      { id: 'forms-button--primary' },
      { appScheme: 'myapp', appPackage: 'com.acme.storybook' },
    );
    expect(appium.executeScript).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'myapp:///?STORYBOOK_STORY_ID=forms-button--primary',
      package: 'com.acme.storybook',
    });
  });

  it('throws invalid_descriptor when appScheme/appPackage missing', async () => {
    const appium = mockAppium();
    await expect(
      deepLinkNavigate(appium, { id: 'x' }, {}),
    ).rejects.toMatchObject({ code: 'invalid_descriptor' });
  });

  it('maps "unknown command" to deep_link_unsupported_platform (iOS < 16.4)', async () => {
    const appium = {
      executeScript: vi.fn(async () => {
        throw new Error('unknown command: mobile: deepLink');
      }),
      pause: vi.fn(async () => {}),
    };
    await expect(
      deepLinkNavigate(
        appium,
        { id: 'x' },
        { appScheme: 'myapp', appPackage: 'com.acme.storybook' },
      ),
    ).rejects.toMatchObject({ code: 'deep_link_unsupported_platform' });
  });

  it('maps generic deep-link failures to nav_element_not_found', async () => {
    const appium = {
      executeScript: vi.fn(async () => {
        throw new Error('android intent activity not found');
      }),
      pause: vi.fn(async () => {}),
    };
    await expect(
      deepLinkNavigate(
        appium,
        { id: 'x' },
        { appScheme: 'myapp', appPackage: 'com.acme.storybook' },
      ),
    ).rejects.toMatchObject({ code: 'nav_element_not_found' });
  });
});

import { createMockDriver } from '../createMockDriver.js';

describe('deepLinkNavigate — iOS branch (item 2.2)', () => {
  it('uses driver.url() on iOS 17+', async () => {
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'iOS', 'appium:platformVersion': '17.4' },
    });
    wdioDriver.url = vi.fn(async () => {});
    const appium = { driver: wdioDriver, executeScript: vi.fn(), pause: vi.fn() };
    await deepLinkNavigate(
      appium,
      { id: 'forms-button--primary' },
      { appScheme: 'myapp' }, // iOS doesn't require appPackage
    );
    expect(wdioDriver.url).toHaveBeenCalledWith(
      'myapp:///?STORYBOOK_STORY_ID=forms-button--primary',
    );
    expect(appium.executeScript).not.toHaveBeenCalled();
  });

  it('fails fast on iOS < 16.4 with deep_link_unsupported_platform', async () => {
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'iOS', 'appium:platformVersion': '16.3' },
    });
    wdioDriver.url = vi.fn();
    const appium = { driver: wdioDriver, executeScript: vi.fn(), pause: vi.fn() };
    await expect(
      deepLinkNavigate(appium, { id: 'x' }, { appScheme: 'myapp' }),
    ).rejects.toMatchObject({ code: 'deep_link_unsupported_platform' });
    // Never hits driver.url() since we short-circuit.
    expect(wdioDriver.url).not.toHaveBeenCalled();
  });

  it('iOS deep-link path does not require appPackage', async () => {
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'iOS', 'appium:platformVersion': '17.0' },
    });
    wdioDriver.url = vi.fn(async () => {});
    const appium = { driver: wdioDriver, executeScript: vi.fn(), pause: vi.fn() };
    // No appPackage in opts — should still work on iOS.
    await expect(
      deepLinkNavigate(appium, { id: 'a--b' }, { appScheme: 'myapp' }),
    ).resolves.toBeDefined();
  });

  it('Android branch still requires appPackage', async () => {
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'Android' },
    });
    const appium = { driver: wdioDriver, executeScript: vi.fn(), pause: vi.fn() };
    await expect(
      deepLinkNavigate(appium, { id: 'x' }, { appScheme: 'myapp' /* no appPackage */ }),
    ).rejects.toMatchObject({ code: 'invalid_descriptor' });
  });

  it('falls back to mobile: deepLink on iOS 16.4+ when driver.url is unavailable', async () => {
    // iOS 16.4+ (supportsDeepLink true) but the wdio driver exposes no url()
    // method → the else-branch issues `mobile: deepLink` via executeScript.
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'iOS', 'appium:platformVersion': '17.0' },
    });
    delete wdioDriver.url; // no url() on this driver build
    const execSpy = vi.fn(async () => {});
    const appium = {
      driver: wdioDriver,
      executeScript: execSpy,
      pause: vi.fn(async () => {}),
    };
    await expect(
      deepLinkNavigate(appium, { id: 'forms-button--primary' }, { appScheme: 'myapp' }),
    ).resolves.toBeDefined();
    expect(execSpy).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'myapp:///?STORYBOOK_STORY_ID=forms-button--primary',
    });
  });

  it('rejects with deep_link_unsupported_platform when driver.url() never settles (timeout)', async () => {
    // driver.url() hangs forever → withTimeout's timer fires and rejects with
    // deep_link_unsupported_platform. A tiny deepLinkTimeoutMs keeps it instant.
    const wdioDriver = createMockDriver({
      capabilities: { platformName: 'iOS', 'appium:platformVersion': '17.0' },
    });
    wdioDriver.url = vi.fn(() => new Promise(() => {})); // never resolves
    const appium = {
      driver: wdioDriver,
      executeScript: vi.fn(),
      pause: vi.fn(async () => {}),
    };
    await expect(
      deepLinkNavigate(
        appium,
        { id: 'x' },
        { appScheme: 'myapp', deepLinkTimeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ code: 'deep_link_unsupported_platform' });
  });
});
