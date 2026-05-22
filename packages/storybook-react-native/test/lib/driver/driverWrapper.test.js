import { describe, expect, it, vi } from 'vitest';
import { AppiumDriver } from '../../../percy/driver/driverWrapper.js';

describe('AppiumDriver wrapper', () => {
  it('exposes capabilities() with empty-object fallback', () => {
    expect(new AppiumDriver({}).capabilities()).toEqual({});
    expect(new AppiumDriver({ capabilities: { platformName: 'iOS' } }).capabilities())
      .toEqual({ platformName: 'iOS' });
  });

  it('delegates takeScreenshot() to the wrapped driver', async () => {
    const inner = { takeScreenshot: vi.fn().mockResolvedValue('base64-png') };
    expect(await new AppiumDriver(inner).takeScreenshot()).toBe('base64-png');
    expect(inner.takeScreenshot).toHaveBeenCalledOnce();
  });

  it('uses driver.pause() when available', async () => {
    const inner = { pause: vi.fn().mockResolvedValue(undefined) };
    await new AppiumDriver(inner).pause(50);
    expect(inner.pause).toHaveBeenCalledWith(50);
  });

  it('falls back to setTimeout when driver.pause is not a function', async () => {
    const start = Date.now();
    await new AppiumDriver({}).pause(25);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it('delegates $(selector) to driver.$()', async () => {
    const stub = { isExisting: vi.fn().mockResolvedValue(true) };
    const inner = { $: vi.fn().mockResolvedValue(stub) };
    expect(await new AppiumDriver(inner).$('~mobile-menu-button')).toBe(stub);
    expect(inner.$).toHaveBeenCalledWith('~mobile-menu-button');
  });

  it('wraps a single-object args param in an array for executeScript', async () => {
    const inner = { executeScript: vi.fn().mockResolvedValue('ok') };
    await new AppiumDriver(inner).executeScript('mobile: deepLink', { url: 'foo:///bar' });
    expect(inner.executeScript).toHaveBeenCalledWith('mobile: deepLink', [{ url: 'foo:///bar' }]);
  });

  it('passes through an args array unchanged for executeScript', async () => {
    const inner = { executeScript: vi.fn().mockResolvedValue('ok') };
    await new AppiumDriver(inner).executeScript('mobile: hideKeyboard', [{ strategy: 'press' }]);
    expect(inner.executeScript).toHaveBeenCalledWith('mobile: hideKeyboard', [{ strategy: 'press' }]);
  });

  it('exposes sessionId from the wrapped driver', () => {
    expect(new AppiumDriver({ sessionId: 'sess-abc' }).sessionId()).toBe('sess-abc');
    expect(new AppiumDriver({}).sessionId()).toBeUndefined();
  });
});
