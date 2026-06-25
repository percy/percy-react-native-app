import { GenericProvider } from './genericProvider.js';

/**
 * AppAutomateProvider — extends GenericProvider with BrowserStack-specific
 * reporting (session URL surfacing). Like GenericProvider, it does NOT
 * reimplement @percy/percy-appium-js's screenshot/getTiles/percyScreenshotBegin
 * contract — capture is delegated to @percy/appium-app. It only borrows the
 * subclass/dispatch shape so transport detection is familiar.
 *
 * Static `supports(driver)` is the load-bearing dispatch hook — returns
 * true only when the driver has actual BS credentials in its capability
 * map. An empty `'bstack:options': {}` does NOT count (empty objects are
 * truthy in JS).
 */
export class AppAutomateProvider extends GenericProvider {
  /**
   * @param {object} driver
   * @returns {boolean}
   */
  static supports(driver) {
    const caps = (driver && driver.capabilities) || {};
    const bstack = caps['bstack:options'];
    const nestedHasCreds =
      bstack &&
      typeof bstack === 'object' &&
      (bstack.userName || bstack.accessKey);
    const flatHasCreds =
      caps['bstack:userName'] ||
      caps['browserstack.user'] ||
      // Post-WDIO-9 normalization can drop the vendor prefix on some keys.
      // Only treat plain `userName` as a BS signal when paired with a BS
      // hub URL (otherwise it could be local creds for some other grid).
      (caps.userName && /browserstack/i.test(String(caps['hostname'] || caps['bstack:hostname'] || '')));
    return Boolean(nestedHasCreds || flatHasCreds);
  }

  /** @returns {'app-automate'} */
  transport() {
    return 'app-automate';
  }

  /**
   * BS dashboard URL for the live session — surfaced in CLI logs so a
   * failed run is one click away from the BS session video / logs.
   * @returns {string | undefined}
   */
  sessionUrl() {
    const id = this.driver.sessionId();
    return id ? `https://app-automate.browserstack.com/dashboard/v2/sessions/${id}` : undefined;
  }
}
