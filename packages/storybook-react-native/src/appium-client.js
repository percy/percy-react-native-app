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
   * Returns the OS+device label for naming snapshots.
   * @returns {string}
   */
  getDeviceLabel() {
    const caps = this.driver?.capabilities ?? {};
    const platformName = String(caps.platformName ?? 'unknown');
    const deviceName = String(caps.deviceName ?? caps['appium:deviceName'] ?? '');
    return deviceName ? `${platformName}-${deviceName}` : platformName;
  }

  /**
   * Normalized OS name for the Percy comparison tag ('iOS' | 'Android').
   * Falls back to 'iOS' when the platform can't be determined, preserving
   * prior behavior rather than emitting an empty osName.
   * @returns {string}
   */
  getPlatformName() {
    const caps = this.driver?.capabilities ?? {};
    const platformName = String(caps.platformName ?? caps['appium:platformName'] ?? '').toLowerCase();
    if (platformName.includes('android')) return 'Android';
    if (platformName.includes('ios')) return 'iOS';
    return 'iOS';
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
