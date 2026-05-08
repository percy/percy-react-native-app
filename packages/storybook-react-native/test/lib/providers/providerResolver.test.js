import { describe, expect, it } from 'vitest';
import { ProviderResolver } from '../../../percy/providers/providerResolver.js';
import { GenericProvider } from '../../../percy/providers/genericProvider.js';
import { AppAutomateProvider } from '../../../percy/providers/appAutomateProvider.js';
import { createMockDriver } from '../createMockDriver.js';

describe('ProviderResolver — transport detection cap-shape matrix', () => {
  it('classifies as app-automate when bstack:options has userName + accessKey', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'bstack:options': { userName: 'u', accessKey: 'k' },
      },
    });
    const provider = ProviderResolver.resolve(driver);
    expect(provider).toBeInstanceOf(AppAutomateProvider);
    expect(provider.transport()).toBe('app-automate');
  });

  it('classifies as app-automate when only bstack:options.userName is present', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'bstack:options': { userName: 'u' },
      },
    });
    expect(ProviderResolver.resolve(driver)).toBeInstanceOf(AppAutomateProvider);
  });

  it('classifies as local when bstack:options is empty (correctness fix C1)', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'bstack:options': {},
      },
    });
    const provider = ProviderResolver.resolve(driver);
    expect(provider).toBeInstanceOf(GenericProvider);
    expect(provider).not.toBeInstanceOf(AppAutomateProvider);
    expect(provider.transport()).toBe('local');
  });

  it('classifies as app-automate when flat bstack:userName is present', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'bstack:userName': 'u',
      },
    });
    expect(ProviderResolver.resolve(driver)).toBeInstanceOf(AppAutomateProvider);
  });

  it('classifies as app-automate with legacy browserstack.user', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'browserstack.user': 'u',
      },
    });
    expect(ProviderResolver.resolve(driver)).toBeInstanceOf(AppAutomateProvider);
  });

  it('classifies as local for plain webdriverio caps without BS hints', () => {
    const driver = createMockDriver({
      capabilities: {
        platformName: 'Android',
        'appium:deviceName': 'Pixel_5',
        'appium:app': '/local/path/to/app.apk',
      },
    });
    expect(ProviderResolver.resolve(driver)).toBeInstanceOf(GenericProvider);
  });

  it('returns a GenericProvider as the catch-all (always supports)', () => {
    const driver = createMockDriver({ capabilities: {} });
    expect(ProviderResolver.resolve(driver)).toBeInstanceOf(GenericProvider);
  });
});

describe('AppAutomateProvider — sessionUrl()', () => {
  it('returns BS dashboard URL for the active session', () => {
    const driver = createMockDriver({
      capabilities: { 'bstack:options': { userName: 'u', accessKey: 'k' } },
      sessionId: 'abc123def456',
    });
    const provider = ProviderResolver.resolve(driver);
    expect(provider.sessionUrl()).toBe(
      'https://app-automate.browserstack.com/dashboard/v2/sessions/abc123def456',
    );
  });
});

describe('GenericProvider — sessionUrl()', () => {
  it('returns undefined for local transport', () => {
    const driver = createMockDriver({ capabilities: {} });
    expect(ProviderResolver.resolve(driver).sessionUrl()).toBeUndefined();
  });
});
