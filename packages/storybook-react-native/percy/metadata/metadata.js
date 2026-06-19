/**
 * Base metadata extractor. Encapsulates Appium capability shape reads
 * with the WebdriverIO 8 vs 9 cap-prefix gotcha handled in one place: cap
 * keys sometimes have the `appium:` prefix and sometimes don't, depending on
 * WDIO version + whether the cap was set pre- or post-session-create (see
 * `_readCap`, which reads both forms).
 *
 * Per-platform subclasses (androidMetadata, iosMetadata) extend this for
 * platform-specific reads (bundle/package ids, version gating, etc).
 */
export class Metadata {
  /**
   * @param {{ capabilities?: Record<string, unknown> }} driver
   */
  constructor(driver) {
    this._driver = driver;
    this._caps = driver.capabilities ?? {};
  }

  /** @returns {string} */
  platformName() {
    return String(this._readCap('platformName') ?? 'unknown');
  }

  /** @returns {string} */
  deviceName() {
    return String(this._readCap('deviceName') ?? '');
  }

  /** @returns {string} */
  platformVersion() {
    return String(this._readCap('platformVersion') ?? '');
  }

  /**
   * Snapshot device label used for naming (`{platformName}-{deviceName}`).
   * Library mode and CLI mode use the same shape so they emit identical
   * baselines for the same device.
   * @returns {string}
   */
  deviceLabel() {
    const platform = this.platformName();
    const device = this.deviceName();
    return device ? `${platform}-${device}` : platform;
  }

  /**
   * Read a capability handling both `appium:` prefixed and unprefixed
   * forms. WebdriverIO 9 sometimes drops the prefix once a session is
   * created; WDIO 8 may keep it. Read both.
   * @param {string} name
   */
  _readCap(name) {
    return this._caps[`appium:${name}`] ?? this._caps[name];
  }

  /**
   * BrowserStack session id (when present). Used for telemetry +
   * for surfacing the session URL in error messages.
   * @returns {string | undefined}
   */
  bstackSessionId() {
    const opts = this._caps['bstack:options'];
    if (opts && typeof opts === 'object') {
      return /** @type {Record<string, unknown>} */ (opts).sessionId
        ? String(/** @type {Record<string, unknown>} */ (opts).sessionId)
        : undefined;
    }
    return undefined;
  }
}
