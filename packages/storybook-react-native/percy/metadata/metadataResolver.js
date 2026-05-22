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
   * @param {{ capabilities?: Record<string, unknown> }} driver
   * @returns {Metadata}
   */
  static resolve(driver) {
    const safeDriver = driver ?? { capabilities: {} };
    const caps = safeDriver.capabilities ?? {};
    const platform = String(
      caps['appium:platformName'] ?? caps.platformName ?? '',
    ).toLowerCase();

    if (platform === 'android') return new AndroidMetadata(safeDriver);
    if (platform === 'ios') return new IosMetadata(safeDriver);
    // Permissive fallback — unknown platform still gets the base reader.
    return new Metadata(safeDriver);
  }
}
