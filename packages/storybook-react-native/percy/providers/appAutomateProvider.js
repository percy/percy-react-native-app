import { GenericProvider } from './genericProvider.js';

/**
 * AppAutomateProvider — extends GenericProvider with BrowserStack-specific
 * behavior. Follows @percy/percy-appium-js's appAutomateProvider.js shape, but
 * (like GenericProvider) does NOT implement the reference's remote tile capture
 * or `percyScreenshotBegin/End` session handshake — that lives inside the
 * `@percy/appium-app` peer dependency. This subclass only adds BS credential-
 * based dispatch and surfaces the live session's dashboard URL.
 *
 * Static `supports(driver)` is the load-bearing dispatch hook — returns
 * true only when the driver has actual BS credentials in its capability
 * map. An empty `'bstack:options': {}` does NOT count (correctness fix
 * from the deepening review — empty objects are truthy in JS).
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
    // In WebdriverIO v9 the hub hostname lives on `driver.options`, not in the
    // capability map — check there too, else the plain-`userName` branch below
    // is effectively dead (caps.hostname is almost always absent).
    const hubHost = String(
      caps['hostname'] ||
      caps['bstack:hostname'] ||
      (driver && driver.options && driver.options.hostname) ||
      '',
    );
    const flatHasCreds =
      caps['bstack:userName'] ||
      caps['browserstack.user'] ||
      // Post-WDIO-9 normalization can drop the vendor prefix on some keys.
      // Only treat plain `userName` as a BS signal when paired with a BS
      // hub URL (otherwise it could be local creds for some other grid).
      (caps.userName && /browserstack/i.test(hubHost));
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
