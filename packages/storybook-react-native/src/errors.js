/**
 * Error catalog — the acceptance contract from the v2 plan.
 * Every CLI failure path produces one of these.
 *
 * @typedef {'no_stories_found'
 *   | 'appium_unreachable'
 *   | 'storybook_ws_unreachable'
 *   | 'percy_cli_unreachable'
 *   | 'token_missing'
 *   | 'story_render_timeout'
 *   | 'screenshot_failed'
 *   | 'include_zero_match'
 * } ErrorCode
 */

export class PercyStorybookRNError extends Error {
  /**
   * @param {{ code: ErrorCode, message: string, nextStep?: string, cause?: unknown }} opts
   */
  constructor(opts) {
    super(opts.message);
    this.name = 'PercyStorybookRNError';
    this.code = opts.code;
    this.nextStep = opts.nextStep;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  toCLIString() {
    const lines = [`[${this.code}] ${this.message}`];
    if (this.nextStep) lines.push(`  → ${this.nextStep}`);
    return lines.join('\n');
  }
}

/**
 * @param {ErrorCode} code
 * @param {string} message
 * @param {string} [nextStep]
 * @param {unknown} [cause]
 */
export function err(code, message, nextStep, cause) {
  return new PercyStorybookRNError({ code, message, nextStep, cause });
}
