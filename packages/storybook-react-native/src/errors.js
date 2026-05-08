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
 *   | 'invalid_descriptor'
 *   | 'invalid_app_reference'
 *   | 'bs_credentials_missing'
 *   | 'bs_upload_failed'
 *   | 'bs_upload_too_large'
 *   | 'bs_app_not_ready'
 *   | 'bs_app_reference_stale'
 *   | 'bs_quota_exhausted'
 *   | 'nav_navigator_not_detected'
 *   | 'nav_element_not_found'
 *   | 'nav_state_diverged'
 *   | 'nav_render_timeout'
 *   | 'app_cold_boot_timeout'
 *   | 'deep_link_unsupported_platform'
 *   | 'url_scheme_silent_failure'
 *   | 'unsupported_platform'
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
