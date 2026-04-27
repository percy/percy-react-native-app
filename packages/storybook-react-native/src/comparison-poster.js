import * as utils from '@percy/sdk-utils';
import { err } from './errors.js';

/**
 * @typedef {Object} ComparisonInput
 * @property {string} name        Snapshot name, e.g. "Button/Primary/iOS-iPhone-15"
 * @property {string} tag         Device label, used for grouping (e.g. "iOS-iPhone-15")
 * @property {string} screenshotBase64
 *
 * Wraps `@percy/sdk-utils` `postComparison`, which POSTs to the Percy CLI
 * server at localhost:5338 — the same endpoint @percy/appium-app uses.
 * The CLI handles the actual upload to the Percy backend.
 */

/**
 * @returns {Promise<boolean>}
 */
export async function isPercyEnabled() {
  try {
    return await utils.isPercyEnabled();
  } catch {
    return false;
  }
}

/**
 * Reads width and height from a PNG buffer's IHDR chunk.
 * PNG layout: 8-byte signature, then chunk 0 = IHDR, where
 *   bytes 16-19 = width (big-endian uint32)
 *   bytes 20-23 = height (big-endian uint32)
 *
 * @param {Buffer} png
 * @returns {{ width: number, height: number }}
 */
function readPngDimensions(png) {
  if (png.length < 24) {
    throw err('screenshot_failed', 'Screenshot buffer too small to be a PNG.');
  }
  const sig = png.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw err('screenshot_failed', 'Screenshot is not a PNG (unexpected signature).');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * @param {ComparisonInput} input
 * @returns {Promise<void>}
 */
export async function postSnapshotComparison(input) {
  if (!(await isPercyEnabled())) {
    throw err(
      'percy_cli_unreachable',
      'Percy CLI is not running, or this run was not invoked via `percy exec`.',
      'Wrap your command with `percy exec -- <your command>` and ensure PERCY_TOKEN is set.',
    );
  }

  const buffer = Buffer.from(input.screenshotBase64, 'base64');
  const { width, height } = readPngDimensions(buffer);

  // postComparison schema mirrors @percy/appium-app's GenericProvider tile.
  // App Percy requires explicit width/height per tile; status/nav bar offsets
  // can be added later for cropping. fullscreen=false → single-tile snapshot
  // (no full-page stitching needed for component-level visual testing).
  // Per @percy/core comparisonSchema: width/height belong on `tag`, not on tiles.
  // tiles only carry content + crop offsets (statusBar/navBar/header/footer).
  await utils.postComparison({
    name: input.name,
    tag: {
      name: input.tag,
      osName: 'iOS',
      width,
      height,
    },
    tiles: [{
      content: buffer.toString('base64'),
      statusBarHeight: 0,
      navBarHeight: 0,
      headerHeight: 0,
      footerHeight: 0,
      fullscreen: false,
    }],
  });
}
