import { describe, expect, it } from 'vitest';
import { MetadataResolver } from '../../percy/metadata/metadataResolver.js';
import { Metadata } from '../../percy/metadata/metadata.js';
import { AndroidMetadata } from '../../percy/metadata/androidMetadata.js';
import { IosMetadata } from '../../percy/metadata/iosMetadata.js';

describe('MetadataResolver.resolve', () => {
  it('returns AndroidMetadata when capabilities[platformName] === "android"', () => {
    const md = MetadataResolver.resolve({
      capabilities: { platformName: 'Android' },
    });
    expect(md).toBeInstanceOf(AndroidMetadata);
  });

  it('returns IosMetadata when capabilities[appium:platformName] === "iOS"', () => {
    const md = MetadataResolver.resolve({
      capabilities: { 'appium:platformName': 'iOS' },
    });
    expect(md).toBeInstanceOf(IosMetadata);
  });

  it('falls back to base Metadata for unknown platforms', () => {
    const md = MetadataResolver.resolve({
      capabilities: { platformName: 'tvOS' },
    });
    expect(md).toBeInstanceOf(Metadata);
    expect(md).not.toBeInstanceOf(AndroidMetadata);
    expect(md).not.toBeInstanceOf(IosMetadata);
  });

  it('tolerates a null driver (defensive fallback)', () => {
    expect(MetadataResolver.resolve(null)).toBeInstanceOf(Metadata);
    expect(MetadataResolver.resolve(undefined)).toBeInstanceOf(Metadata);
  });

  it('tolerates a driver with no capabilities object at all', () => {
    expect(MetadataResolver.resolve({})).toBeInstanceOf(Metadata);
  });
});

describe('MetadataResolver.resolveLive', () => {
  it('merges live getCapabilities() over empty static caps (WDIO v9 post-session)', async () => {
    // Static map is empty pre-session; the negotiated platform/device only
    // appear once getCapabilities() is queried.
    const driver = {
      capabilities: {},
      getCapabilities: async () => ({ platformName: 'Android', 'appium:deviceName': 'Pixel 8' }),
    };
    const md = await MetadataResolver.resolveLive(driver);
    expect(md).toBeInstanceOf(AndroidMetadata);
    expect(md.deviceLabel()).toBe('Android-Pixel 8');
  });

  it('lets live caps win over a stale static platform', async () => {
    const driver = {
      capabilities: { platformName: 'Android' },
      getCapabilities: async () => ({ platformName: 'iOS' }),
    };
    expect(await MetadataResolver.resolveLive(driver)).toBeInstanceOf(IosMetadata);
  });

  it('falls back to static caps when getCapabilities() throws', async () => {
    const driver = {
      capabilities: { platformName: 'iOS' },
      getCapabilities: async () => {
        throw new Error('no session');
      },
    };
    expect(await MetadataResolver.resolveLive(driver)).toBeInstanceOf(IosMetadata);
  });

  it('falls back to static caps when the driver has no getCapabilities()', async () => {
    const md = await MetadataResolver.resolveLive({ capabilities: { platformName: 'Android' } });
    expect(md).toBeInstanceOf(AndroidMetadata);
  });
});

describe('AndroidMetadata', () => {
  it('reads appium:appPackage / appium:appActivity', () => {
    const md = new AndroidMetadata({
      capabilities: {
        'appium:appPackage': 'com.example.app',
        'appium:appActivity': '.MainActivity',
      },
    });
    expect(md.appPackage()).toBe('com.example.app');
    expect(md.appActivity()).toBe('.MainActivity');
  });

  it('returns undefined when the capability is absent', () => {
    const md = new AndroidMetadata({ capabilities: {} });
    expect(md.appPackage()).toBeUndefined();
    expect(md.appActivity()).toBeUndefined();
  });

  it('defaults automationName to UiAutomator2 when unset', () => {
    expect(new AndroidMetadata({ capabilities: {} }).automationName()).toBe('UiAutomator2');
  });

  it('returns the configured automationName when present', () => {
    const md = new AndroidMetadata({
      capabilities: { 'appium:automationName': 'Espresso' },
    });
    expect(md.automationName()).toBe('Espresso');
  });
});

describe('IosMetadata', () => {
  it('reads appium:bundleId', () => {
    const md = new IosMetadata({
      capabilities: { 'appium:bundleId': 'com.anonymous.RNStorybookFixture' },
    });
    expect(md.bundleId()).toBe('com.anonymous.RNStorybookFixture');
  });

  it('returns undefined bundleId when capability is absent', () => {
    expect(new IosMetadata({ capabilities: {} }).bundleId()).toBeUndefined();
  });

  it('defaults automationName to XCUITest', () => {
    expect(new IosMetadata({ capabilities: {} }).automationName()).toBe('XCUITest');
  });

  it('parses major + minor from appium:platformVersion', () => {
    const md = new IosMetadata({
      capabilities: { 'appium:platformVersion': '18.4' },
    });
    expect(md.platformVersionMajor()).toBe(18);
    expect(md.platformVersionMinor()).toBe(4);
  });

  it('handles a major-only platformVersion ("17") with minor defaulting to 0', () => {
    const md = new IosMetadata({
      capabilities: { 'appium:platformVersion': '17' },
    });
    expect(md.platformVersionMajor()).toBe(17);
    expect(md.platformVersionMinor()).toBe(0);
  });

  it('returns null/0 when platformVersion is missing', () => {
    const md = new IosMetadata({ capabilities: {} });
    expect(md.platformVersionMajor()).toBeNull();
    expect(md.platformVersionMinor()).toBeNull();
  });

  it('returns null/0 when platformVersion is non-numeric ("garbage")', () => {
    const md = new IosMetadata({
      capabilities: { 'appium:platformVersion': 'garbage' },
    });
    expect(md.platformVersionMajor()).toBeNull();
    expect(md.platformVersionMinor()).toBeNull();
  });
});

describe('Metadata (base) — capability readers', () => {
  it('defaults platformName to "unknown" when capability missing', () => {
    expect(new Metadata({ capabilities: {} }).platformName()).toBe('unknown');
  });

  it('reads platformName from capabilities', () => {
    expect(new Metadata({
      capabilities: { platformName: 'Android' },
    }).platformName()).toBe('Android');
  });

  it('defaults deviceName + platformVersion to empty string', () => {
    const md = new Metadata({ capabilities: {} });
    expect(md.deviceName()).toBe('');
    expect(md.platformVersion()).toBe('');
  });

  it('builds deviceLabel from platform + device when both present', () => {
    const md = new Metadata({
      capabilities: { platformName: 'iOS', 'appium:deviceName': 'iPhone 16' },
    });
    expect(md.deviceLabel()).toBe('iOS-iPhone 16');
  });

  it('falls back deviceLabel to platform-only when deviceName is empty', () => {
    const md = new Metadata({
      capabilities: { platformName: 'iOS' },
    });
    expect(md.deviceLabel()).toBe('iOS');
  });
});

describe('Metadata (base) — bstackSessionId', () => {
  it('returns undefined when bstack:options is absent', () => {
    expect(new Metadata({ capabilities: {} }).bstackSessionId()).toBeUndefined();
  });

  it('returns the sessionId nested under bstack:options', () => {
    const md = new Metadata({
      capabilities: { 'bstack:options': { sessionId: 'sess-123' } },
    });
    expect(md.bstackSessionId()).toBe('sess-123');
  });

  it('returns undefined when bstack:options is present but has no sessionId', () => {
    const md = new Metadata({
      capabilities: { 'bstack:options': { userName: 'u' } },
    });
    expect(md.bstackSessionId()).toBeUndefined();
  });

  it('returns undefined when bstack:options is a non-object scalar', () => {
    const md = new Metadata({
      capabilities: { 'bstack:options': 'oops' },
    });
    expect(md.bstackSessionId()).toBeUndefined();
  });
});
