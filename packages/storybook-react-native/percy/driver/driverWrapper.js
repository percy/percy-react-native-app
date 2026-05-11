/**
 * AppiumDriver — thin wrapper around the customer's Appium driver
 * exposing only what the SDK needs. Mirrors @percy/percy-appium-js's
 * driver/driverWrapper.js shape.
 *
 * Phase 1 supports webdriverio v9. The `wd` driver shape is Phase 2.
 *
 * The wrapper exists so providers and navigation strategies can call a
 * stable interface even if the underlying driver shape evolves
 * (e.g., WDIO 8→9 cap-prefix changes, or new Appium W3C extensions).
 */
export class AppiumDriver {
  /**
   * @param {object} driver  webdriverio v9 Browser instance
   */
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * @returns {Record<string, unknown>}
   */
  capabilities() {
    return this.driver.capabilities ?? {};
  }

  /**
   * W3C take-screenshot. Returns base64 PNG. Same primitive
   * @percy/appium-app's GenericProvider uses internally.
   * @returns {Promise<string>}
   */
  async takeScreenshot() {
    return this.driver.takeScreenshot();
  }

  /**
   * Pause for the given milliseconds. webdriverio's idiomatic sleep.
   * @param {number} ms
   */
  async pause(ms) {
    if (typeof this.driver.pause === 'function') {
      await this.driver.pause(ms);
    } else {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  /**
   * Find an element by webdriverio v9 selector string.
   * Supports `~accessibilityId`, `-android uiautomator ...`,
   * `-ios predicate string ...`, and XPath.
   * @param {string} selector
   */
  async $(selector) {
    return this.driver.$(selector);
  }

  /**
   * Execute a mobile-extension command (e.g., `mobile: deepLink`).
   * @param {string} script
   * @param {object | object[]} args
   */
  async executeScript(script, args) {
    return this.driver.executeScript(script, Array.isArray(args) ? args : [args]);
  }

  /**
   * Underlying session id when present (set by webdriverio after session
   * creation). Used by AppAutomateProvider to surface the session URL.
   */
  sessionId() {
    return this.driver.sessionId;
  }
}
