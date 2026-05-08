import { AppiumDriver } from '../driver/driverWrapper.js';
import { MetadataResolver } from '../metadata/metadataResolver.js';

/**
 * GenericProvider — local-Appium / catch-all path.
 *
 * Mirrors @percy/percy-appium-js's GenericProvider as the always-supported
 * fallback. AppAutomateProvider extends this and overrides only the
 * BrowserStack-specific behaviors (session URL surfacing, cap shaping).
 *
 * The provider is responsible for:
 *  - Wrapping the customer's driver
 *  - Resolving per-platform metadata
 *  - Surfacing transport-specific helpers (none in the generic case)
 */
export class GenericProvider {
  /**
   * Provider-resolver dispatch — every provider implements this.
   * GenericProvider's supports() always returns true (it is the
   * catch-all and must be tried last).
   *
   * @param {object} _driver
   * @returns {boolean}
   */
  static supports(_driver) {
    return true;
  }

  /**
   * @param {object} driver  webdriverio v9 Browser
   */
  constructor(driver) {
    this.driver = new AppiumDriver(driver);
    this.metadata = MetadataResolver.resolve(driver);
  }

  /** @returns {'local' | 'app-automate'} */
  transport() {
    return 'local';
  }

  /**
   * Optional surface that AppAutomateProvider overrides — returns the
   * BS dashboard URL for the active session, or undefined for local.
   * @returns {string | undefined}
   */
  sessionUrl() {
    return undefined;
  }
}
