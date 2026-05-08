import { Metadata } from './metadata.js';

/**
 * Android-specific metadata. UiAutomator2 driver. App package id is in
 * `appium:appPackage` in modern caps, falls back to legacy `app` parsing
 * if needed.
 */
export class AndroidMetadata extends Metadata {
  /** @returns {string | undefined} */
  appPackage() {
    const v = this._readCap('appPackage');
    return v ? String(v) : undefined;
  }

  /** @returns {string | undefined} */
  appActivity() {
    const v = this._readCap('appActivity');
    return v ? String(v) : undefined;
  }

  /** @returns {string} */
  automationName() {
    return String(this._readCap('automationName') ?? 'UiAutomator2');
  }
}
