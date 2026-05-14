import { Metadata } from './metadata.js';
import { AndroidMetadata } from './androidMetadata.js';
import { IosMetadata } from './iosMetadata.js';

/**
 * Pick the right Metadata subclass for the active driver session.
 * Phase 1 ships Android only; iOS Phase 2.
 *
 * Mirrors @percy/percy-appium-js's metadata/metadataResolver.js shape.
 */
export class MetadataResolver {
  /**
   * @param {{ capabilities?: Record<string, unknown> }} driver
   * @returns {Metadata}
   */
  static resolve(driver) {
    const caps = driver.capabilities ?? {};
    const platform = String(
      caps['appium:platformName'] ?? caps.platformName ?? '',
    ).toLowerCase();

    if (platform === 'android') return new AndroidMetadata(driver);
    if (platform === 'ios') return new IosMetadata(driver);
    // Permissive fallback — unknown platform still gets the base reader.
    return new Metadata(driver);
  }
}
