import { Metadata } from './metadata.js';

/**
 * iOS-specific metadata. XCUITest driver. Mirrors AndroidMetadata's shape
 * so the rest of the SDK can treat them interchangeably.
 */
export class IosMetadata extends Metadata {
  /** @returns {string | undefined} */
  bundleId() {
    const v = this._readCap('bundleId');
    return v ? String(v) : undefined;
  }

  /** @returns {string} */
  automationName() {
    return String(this._readCap('automationName') ?? 'XCUITest');
  }

  /**
   * iOS deep-link (driver.url()) is unreliable below 16.4. The SDK uses
   * this to short-circuit and fail-fast rather than time out.
   * @returns {number | null}
   */
  platformVersionMajor() {
    const raw = this.platformVersion();
    if (!raw) return null;
    const m = String(raw).match(/^(\d+)/);
    return m ? Number(m[1]) : null;
  }

  platformVersionMinor() {
    const raw = this.platformVersion();
    if (!raw) return null;
    const m = String(raw).match(/^\d+\.(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /**
   * mobile: deepLink / driver.url() URL routing is unreliable on iOS < 16.4
   * per parent plan §17.3 and the appium-xcuitest-driver issue tracker.
   * @returns {boolean}
   */
  supportsDeepLink() {
    const major = this.platformVersionMajor();
    const minor = this.platformVersionMinor() ?? 0;
    if (major === null) return true; // unknown — assume yes, fail fast at runtime if wrong
    if (major > 16) return true;
    if (major === 16 && minor >= 4) return true;
    return false;
  }
}
