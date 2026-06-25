import { AppiumDriver } from '../driver/driverWrapper.js';
import { MetadataResolver } from '../metadata/metadataResolver.js';

/**
 * GenericProvider — local-Appium / catch-all path.
 *
 * IMPORTANT: this is a thin transport+metadata resolver, NOT a full
 * reimplementation of @percy/percy-appium-js's GenericProvider. It deliberately
 * does NOT implement screenshot()/getTiles()/getTag()/getDebugUrl() — the
 * actual tile capture, tagging, and comparison upload are delegated to the
 * installed @percy/appium-app's percyScreenshot() (see percyStorybookSnapshot.js).
 *
 * It borrows the appium-app provider's class/dispatch shape (static supports()
 * + an AppAutomateProvider subclass) only so transport detection reads the same
 * way across the Percy mobile-SDK family.
 *
 * Responsibilities here are limited to:
 *  - Wrapping the customer's driver
 *  - Resolving per-platform metadata (for snapshot naming)
 *  - Reporting transport + session URL (for logging)
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
    this.rawDriver = driver;
    this.driver = new AppiumDriver(driver);
    // Eager, synchronous metadata from static caps so direct construction
    // (and the resolver tests) work without an await. `initMetadata()`
    // upgrades this with live session caps once a session exists.
    this.metadata = MetadataResolver.resolve(driver);
  }

  /**
   * Upgrade `this.metadata` with the live session capabilities. Under WDIO v9
   * negotiated caps are populated post-session, so the eager static read can
   * be empty. Call after the session is established and before reading device
   * metadata (e.g. for snapshot naming).
   *
   * @returns {Promise<this>}
   */
  async initMetadata() {
    this.metadata = await MetadataResolver.resolveLive(this.rawDriver);
    return this;
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
