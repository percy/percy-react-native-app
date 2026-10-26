import { describe, expect, it, vi, afterEach } from 'vitest';
import { mergeConfig, DEFAULT_CONFIG, isPlaintextRemoteServer } from '../src/config.js';
import { log } from '../percy/util/log.js';

describe('plaintext appium.server warning (PER-9350)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns once for http:// to a remote host without leaking userinfo', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    mergeConfig({ appium: { server: 'http://user:secretkey@hub.example.com/wd/hub' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('http://hub.example.com');
    expect(warn.mock.calls[0][0]).not.toContain('secretkey');
  });

  it.each([
    'http://localhost:4723',
    'http://127.0.0.1:4723',
    'http://[::1]:4723',
    'https://hub.browserstack.com/wd/hub',
  ])('stays silent for %s', (server) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    mergeConfig({ appium: { server } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('isPlaintextRemoteServer classifies hosts', () => {
    expect(isPlaintextRemoteServer('http://hub.example.com')).toBe(true);
    expect(isPlaintextRemoteServer('https://hub.example.com')).toBe(false);
    expect(isPlaintextRemoteServer('http://localhost:4723')).toBe(false);
  });
});

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

  it('rejects a non-http appium.server URL', () => {
    expect(() => mergeConfig({ appium: { server: 'ftp://nope', capabilities: {} } }))
      .toThrow(/appium\.server must be an http/);
  });

  it('rejects a websocketHost that is not a bare hostname', () => {
    expect(() =>
      mergeConfig({ storybook: { websocketHost: 'evil.com/x#', websocketPort: 7007, waitForReadyMs: 1000 } }),
    ).toThrow(/websocketHost must be a bare hostname/);
  });

  it('rejects an out-of-range websocketPort', () => {
    expect(() =>
      mergeConfig({ storybook: { websocketHost: 'localhost', websocketPort: 70000, waitForReadyMs: 1000 } }),
    ).toThrow(/websocketPort must be an integer/);
  });

  it('accepts a valid IPv4 host and custom port', () => {
    const result = mergeConfig({
      storybook: { websocketHost: '127.0.0.1', websocketPort: 19006, waitForReadyMs: 1000 },
    });
    expect(result.storybook.websocketHost).toBe('127.0.0.1');
    expect(result.storybook.websocketPort).toBe(19006);
  });
});
