import { describe, expect, it } from 'vitest';
import { IosMetadata } from '../../percy/metadata/iosMetadata.js';
import { MetadataResolver } from '../../percy/metadata/metadataResolver.js';
import { createMockDriver } from './createMockDriver.js';

describe('IosMetadata', () => {
  it('reads platformName and deviceName', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'iOS',
        'appium:deviceName': 'iPhone 15 Pro',
        'appium:platformVersion': '17.4.1',
      },
    });
    const meta = new IosMetadata(driver);
    expect(meta.platformName()).toBe('iOS');
    expect(meta.deviceName()).toBe('iPhone 15 Pro');
    expect(meta.platformVersion()).toBe('17.4.1');
  });

  it('reads bundleId from capabilities', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'iOS',
        'appium:bundleId': 'com.acme.storybook',
      },
    });
    expect(new IosMetadata(driver).bundleId()).toBe('com.acme.storybook');
  });

  it('returns XCUITest as default automationName', () => {
    const driver = createMockDriver({ capabilities: { platformName: 'iOS' } });
    expect(new IosMetadata(driver).automationName()).toBe('XCUITest');
  });

  describe('supportsDeepLink', () => {
    it('returns true for iOS 17.x', () => {
      const driver = createMockDriver({
        capabilities: { platformName: 'iOS', 'appium:platformVersion': '17.4' },
      });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(true);
    });

    it('returns true for iOS 16.4', () => {
      const driver = createMockDriver({
        capabilities: { platformName: 'iOS', 'appium:platformVersion': '16.4' },
      });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(true);
    });

    it('returns true for iOS 16.4.1', () => {
      const driver = createMockDriver({
        capabilities: { platformName: 'iOS', 'appium:platformVersion': '16.4.1' },
      });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(true);
    });

    it('returns false for iOS 16.3', () => {
      const driver = createMockDriver({
        capabilities: { platformName: 'iOS', 'appium:platformVersion': '16.3' },
      });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(false);
    });

    it('returns false for iOS 15.7', () => {
      const driver = createMockDriver({
        capabilities: { platformName: 'iOS', 'appium:platformVersion': '15.7' },
      });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(false);
    });

    it('returns true (fail-open) when platformVersion is missing', () => {
      const driver = createMockDriver({ capabilities: { platformName: 'iOS' } });
      expect(new IosMetadata(driver).supportsDeepLink()).toBe(true);
    });
  });
});

describe('MetadataResolver dispatch (item 2.2 — iOS no longer throws unsupported_platform)', () => {
  it('returns IosMetadata for platformName === "iOS"', () => {
    const driver = createMockDriver({ capabilities: { platformName: 'iOS' } });
    expect(MetadataResolver.resolve(driver)).toBeInstanceOf(IosMetadata);
  });

  it('returns IosMetadata for platformName === "ios" (case-insensitive)', () => {
    const driver = createMockDriver({ capabilities: { platformName: 'ios' } });
    expect(MetadataResolver.resolve(driver)).toBeInstanceOf(IosMetadata);
  });
});
