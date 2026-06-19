import { AppiumDriver } from '../driver/driverWrapper.js';
import { MetadataResolver } from '../metadata/metadataResolver.js';

/**
 * GenericProvider — local-Appium / catch-all path.
 *
 * Follows the App Percy (percy-appium-js) provider *shape* as the always-
 * supported fallback, but NOT its capture pipeline. Unlike the reference's
 * GenericProvider, this class has no `screenshot()`/`getTiles()`/`getTag()`/
 * `findRegions()`/`postComparison`: the actual screenshot, tile assembly,
 * device-geometry metadata, region resolution, and comparison upload are
 * delegated to the `@percy/appium-app` peer dependency (invoked from
 * percyStorybookSnapshot.js). This provider only:
 *  - Wraps the customer's driver (transport identity)
 *  - Resolves per-platform metadata used for snapshot *naming* / version gating
 *  - Surfaces transport-specific helpers (none in the generic case)
 *
 * AppAutomateProvider extends this and overrides only the BrowserStack-specific
 * behaviors (session-URL surfacing, credential-based dispatch).
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
