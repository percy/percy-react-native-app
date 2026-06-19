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
   * Parse `platformVersion` into { major, minor }, memoized on the instance.
   * platformVersion is a read-only Appium capability, so the parse is stable
   * for the lifetime of this metadata object.
   *
   * @returns {{ major: number | null, minor: number }}
   */
  _parsedVersion() {
    if (this.__parsedVersion) return this.__parsedVersion;
    const raw = this.platformVersion();
    let parsed;
    if (!raw) {
      parsed = { major: null, minor: 0 };
    } else {
      const m = String(raw).match(/^(\d+)(?:\.(\d+))?/);
      parsed = m
        ? { major: Number(m[1]), minor: m[2] !== undefined ? Number(m[2]) : 0 }
        : { major: null, minor: 0 };
    }
    this.__parsedVersion = parsed;
    return parsed;
  }

  /**
   * iOS deep-link (driver.url()) is unreliable below 16.4. The SDK uses
   * this to short-circuit and fail-fast rather than time out.
   * @returns {number | null}
   */
  platformVersionMajor() {
    return this._parsedVersion().major;
  }

  /** @returns {number | null} */
  platformVersionMinor() {
    const { major, minor } = this._parsedVersion();
    return major === null ? null : minor;
  }

  /**
   * mobile: deepLink / driver.url() URL routing is unreliable on iOS < 16.4
   * per parent plan §17.3 and the appium-xcuitest-driver issue tracker.
   * @returns {boolean}
   */
  supportsDeepLink() {
    const { major, minor } = this._parsedVersion();
    if (major === null) return true; // unknown — assume yes, fail fast at runtime if wrong
    if (major > 16) return true;
    if (major === 16 && minor >= 4) return true;
    return false;
  }
}
