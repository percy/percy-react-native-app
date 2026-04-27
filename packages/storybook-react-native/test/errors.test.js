import { describe, expect, it } from 'vitest';
import { err, PercyStorybookRNError } from '../src/errors.js';

describe('err()', () => {
  it('produces a PercyStorybookRNError with code, message, and nextStep', () => {
    const e = err('appium_unreachable', 'cannot reach Appium', 'Run `appium`.');
    expect(e).toBeInstanceOf(PercyStorybookRNError);
    expect(e.code).toBe('appium_unreachable');
    expect(e.message).toBe('cannot reach Appium');
    expect(e.nextStep).toBe('Run `appium`.');
  });

  it('formats CLI string with code and next-step arrow', () => {
    const e = err('storybook_ws_unreachable', 'WS down', 'Forward port 7007.');
    expect(e.toCLIString()).toBe(
      '[storybook_ws_unreachable] WS down\n  → Forward port 7007.',
    );
  });

  it('formats CLI string without next-step when omitted', () => {
    const e = err('no_stories_found', 'No stories.');
    expect(e.toCLIString()).toBe('[no_stories_found] No stories.');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('original');
    const e = err('screenshot_failed', 'wrapped', undefined, cause);
    expect(e.cause).toBe(cause);
  });
});
