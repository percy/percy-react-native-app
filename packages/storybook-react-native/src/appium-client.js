import { remote } from 'webdriverio';
import { err } from './errors.js';

/**
 * @typedef {Object} AppiumClientOptions
 * @property {string} server      e.g. 'http://localhost:4723'
 * @property {Record<string, unknown>} capabilities
 */

/**
 * Thin wrapper around webdriverio's `remote()` for the Appium use case.
 * Owns the session lifecycle; exposes only what the runner needs (screenshot).
 *
 * The session URL (`server`) is the customer's Appium server — typically
 * `http://localhost:4723` for a local emulator/simulator. No BrowserStack
 * coupling; works against any standards-compliant Appium endpoint.
 */
export class AppiumClient {
  /**
   * @param {AppiumClientOptions} opts
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {import('webdriverio').Browser | undefined} */
    this.driver = undefined;
  }

  async connect() {
    const url = new URL(this.opts.server);
    try {
      this.driver = await remote({
        protocol: url.protocol.replace(':', ''),
        hostname: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname === '/' ? '/' : url.pathname,
        capabilities: this.opts.capabilities,
        logLevel: 'warn',
      });
    } catch (cause) {
      throw err(
        'appium_unreachable',
        `Could not connect to Appium server at ${this.opts.server}.`,
        'Verify Appium is running (`appium`) and the capabilities in .percy.yml match your simulator/emulator.',
        cause,
      );
    }
  }

  /**
   * W3C Appium screenshot. Returns base64-encoded PNG.
   * Same primitive @percy/appium-app's GenericProvider uses.
   * @returns {Promise<string>}
   */
  async takeScreenshot() {
    if (!this.driver) {
      throw err('appium_unreachable', 'Appium session not initialized; call connect() first.');
    }
    try {
      return await this.driver.takeScreenshot();
    } catch (cause) {
      throw err(
        'screenshot_failed',
        'Failed to capture screenshot from Appium session.',
        'The device may have lost focus or the session may have expired. Re-run with DEBUG=1 for details.',
        cause,
      );
    }
  }

  /**
   * Reads a capability that may be stored bare or with the W3C `appium:`
   * vendor prefix (WDIO 8/9 normalize these differently).
   * @param {string} key
   * @returns {unknown}
   */
  _cap(key) {
    const caps = this.driver?.capabilities ?? {};
    return caps[key] ?? caps[`appium:${key}`];
  }

  /**
   * Returns the OS+device label for naming snapshots.
   * @returns {string}
   */
  getDeviceLabel() {
    const platformName = String(this._cap('platformName') ?? 'unknown');
    const deviceName = String(this._cap('deviceName') ?? '');
    return deviceName ? `${platformName}-${deviceName}` : platformName;
  }

  /**
   * Resolves the device metadata needed to tag a Percy comparison correctly
   * (osName/osVersion/deviceName/orientation). Sourced from the live session's
   * capabilities — never hard-coded — so Android and iOS are tagged accurately.
   * @returns {Promise<import('./comparison-poster.js').DeviceMetadata>}
   */
  async getDeviceMetadata() {
    const platformName = String(this._cap('platformName') ?? '').trim();
    if (!platformName) {
      throw err(
        'invalid_descriptor',
        'Appium session did not report a platformName capability.',
        'Set `platformName` (iOS or Android) in your .percy.yml appium.capabilities.',
      );
    }
    // Normalize casing: "ios" → "iOS", "android" → "Android".
    const osName = /^ios$/i.test(platformName)
      ? 'iOS'
      : /^android$/i.test(platformName)
        ? 'Android'
        : platformName;

    const osVersion = this._cap('platformVersion');
    const deviceName = this._cap('deviceName');

    let orientation;
    try {
      orientation = await this.driver?.getOrientation?.();
    } catch {
      // Some drivers throw if orientation isn't queryable; default below.
    }

    return {
      osName,
      osVersion: osVersion != null ? String(osVersion) : undefined,
      deviceName: deviceName != null ? String(deviceName) : undefined,
      orientation: orientation ? String(orientation).toLowerCase() : 'portrait',
    };
  }

  async disconnect() {
    if (this.driver) {
      try {
        await this.driver.deleteSession();
      } catch {
        // Best-effort: ignore teardown errors so the CLI can still report results.
      }
      this.driver = undefined;
    }
  }
}
