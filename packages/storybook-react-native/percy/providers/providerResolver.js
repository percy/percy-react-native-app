import { GenericProvider } from './genericProvider.js';
import { AppAutomateProvider } from './appAutomateProvider.js';

/**
 * ProviderResolver — picks the provider whose static supports() returns
 * true. Follows @percy/percy-appium-js's providerResolver pattern (first
 * non-falsy supports() wins; GenericProvider is the catch-all and must be
 * last in the list). Selection signal differs from the reference: it inspects
 * BrowserStack credentials in capabilities rather than the driver's
 * remoteHostname (see AppAutomateProvider.supports).
 *
 * Re-resolved on every call (cheap — capability reads). Avoids stale
 * cached state across `driver.deleteSession() → new remote()` reuse.
 */
export class ProviderResolver {
  /**
   * @param {object} driver  webdriverio v9 Browser instance
   */
  static resolve(driver) {
    const Klass = [AppAutomateProvider, GenericProvider].find((P) => P.supports(driver));
    return new Klass(driver);
  }
}
