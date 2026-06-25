import { Metadata } from './metadata.js';
import { AndroidMetadata } from './androidMetadata.js';
import { IosMetadata } from './iosMetadata.js';

/**
 * Pick the right Metadata subclass for the active driver session.
 * Supports `android` and `ios` platforms; unknown platforms fall back to
 * the permissive base `Metadata` reader so external test rigs don't crash.
 *
 * Mirrors @percy/percy-appium-js's metadata/metadataResolver.js shape.
 */
export class MetadataResolver {
  /**
   * Synchronous resolution from the driver's *static* capability map.
   * Cheap and side-effect-free — used as the eager default at provider
   * construction time. Prefer `resolveLive()` once a session exists.
   *
   * @param {{ capabilities?: Record<string, unknown> }} driver
   * @returns {Metadata}
   */
  static resolve(driver) {
    return MetadataResolver.fromCaps((driver ?? {}).capabilities ?? {});
  }

  /**
   * Async resolution that fetches the *live* session capabilities via
   * `driver.getCapabilities()` and merges them over the static map. Under
   * WebdriverIO v9 the negotiated caps (platformName, deviceName, version)
   * are frequently only populated post-session-create, so a static-only
   * read returns `unknown`/empty. Live caps win on conflict. Falls back to
   * the static map if the driver can't be queried.
   *
   * @param {{ capabilities?: Record<string, unknown>, getCapabilities?: () => Promise<Record<string, unknown>> }} driver
   * @returns {Promise<Metadata>}
   */
  static async resolveLive(driver) {
    const staticCaps = (driver ?? {}).capabilities ?? {};
    let caps = staticCaps;
    if (driver && typeof driver.getCapabilities === 'function') {
      try {
        const live = await driver.getCapabilities();
        if (live && typeof live === 'object') caps = { ...staticCaps, ...live };
      } catch {
        // Session not queryable — fall back to whatever static caps exist.
      }
    }
    return MetadataResolver.fromCaps(caps);
  }

  /**
   * Build the platform-specific Metadata reader from a capability map.
   * @param {Record<string, unknown>} caps
   * @returns {Metadata}
   */
  static fromCaps(caps) {
    const safeCaps = caps ?? {};
    const platform = String(
      safeCaps['appium:platformName'] ?? safeCaps.platformName ?? '',
    ).toLowerCase();
    // Metadata only reads `.capabilities`; wrap the merged caps so the
    // reader sees the live-merged set regardless of which driver it came from.
    const driverView = { capabilities: safeCaps };

    if (platform === 'android') return new AndroidMetadata(driverView);
    if (platform === 'ios') return new IosMetadata(driverView);
    // Permissive fallback — unknown platform still gets the base reader.
    return new Metadata(driverView);
  }
}
