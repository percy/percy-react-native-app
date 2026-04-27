import { describe, expect, it } from 'vitest';
import { mergeConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('mergeConfig', () => {
  it('returns defaults when no partial config is passed', () => {
    expect(mergeConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('overrides appium server while keeping other defaults', () => {
    const result = mergeConfig({
      appium: { server: 'http://my-grid:4723', capabilities: {} },
    });
    expect(result.appium.server).toBe('http://my-grid:4723');
    expect(result.storybook.websocketPort).toBe(7007);
  });

  it('deep-merges appium capabilities', () => {
    const result = mergeConfig({
      appium: {
        server: 'http://localhost:4723',
        capabilities: { platformName: 'iOS', 'appium:deviceName': 'iPhone 15' },
      },
    });
    expect(result.appium.capabilities).toEqual({
      platformName: 'iOS',
      'appium:deviceName': 'iPhone 15',
    });
  });

  it('overrides include/skip patterns', () => {
    const result = mergeConfig({ include: ['Button/*'], skip: ['Button/Broken'] });
    expect(result.include).toEqual(['Button/*']);
    expect(result.skip).toEqual(['Button/Broken']);
  });

  it('applies user waitForReadyMs override', () => {
    const result = mergeConfig({
      storybook: { websocketHost: 'localhost', websocketPort: 7007, waitForReadyMs: 2500 },
    });
    expect(result.storybook.waitForReadyMs).toBe(2500);
  });
});
