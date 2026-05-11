import { Metadata } from './metadata.js';
import { AndroidMetadata } from './androidMetadata.js';
import { err } from '../../src/errors.js';

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
    if (platform === 'ios') {
      throw err(
        'unsupported_platform',
        'iOS support is a Phase 2 deliverable for the App Automate transport.',
        'Use Android for now, or contribute the iOS XCUITest selectors in percy/navigator/uiTapStrategy.js.',
      );
    }
    // Permissive fallback — unknown platform still gets the base reader.
    return new Metadata(driver);
  }
}
