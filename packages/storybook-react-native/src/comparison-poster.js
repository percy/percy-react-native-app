import { readFileSync } from 'node:fs';
import * as utils from '@percy/sdk-utils';
import { err } from './errors.js';

/**
 * @typedef {Object} DeviceMetadata
 * @property {string} osName        e.g. "iOS" / "Android" (from Appium platformName)
 * @property {string} [osVersion]   e.g. "18.4"
 * @property {string} [deviceName]  e.g. "iPhone 16"
 * @property {string} [orientation] "portrait" | "landscape"
 *
 * @typedef {Object} ComparisonInput
 * @property {string} name        Snapshot name, e.g. "Button/Primary/iOS-iPhone-15"
 * @property {string} tag         Device label, used for grouping (e.g. "iOS-iPhone-15")
 * @property {string} screenshotBase64
 * @property {DeviceMetadata} device  resolved Appium device metadata
 * @property {string} [environmentInfo]  e.g. "webdriverio/9.0.0" — SDK->backend attribution
 *
 * Wraps `@percy/sdk-utils` `postComparison`, which POSTs to the Percy CLI
 * server at localhost:5338 — the same endpoint @percy/appium-app uses.
 * The CLI handles the actual upload to the Percy backend.
 */

/**
 * Self-identifying client string sent on every comparison, mirroring how
 * @percy/appium-app sends `clientInfo`. Read from this package's own
 * package.json so it stays in sync with the published version.
 */
export const CLIENT_INFO = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    return `${pkg.name}/${pkg.version}`;
  } catch {
    return '@percy/storybook-react-native';
  }
})();

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
  const sig = png.subarray(0, 8).toString('hex');
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

  const device = input.device ?? {};
  if (!device.osName) {
    throw err(
      'invalid_descriptor',
      'Device metadata is missing osName; cannot tag the comparison.',
      'This is an internal error — please report it with DEBUG=1 output.',
    );
  }

  const buffer = Buffer.from(input.screenshotBase64, 'base64');
  const { width, height } = readPngDimensions(buffer);

  // Payload mirrors @percy/appium-app's GenericProvider comparison shape:
  // width/height/osName/osVersion/orientation/deviceName live on `tag`; the
  // tile carries content + crop offsets. clientInfo/environmentInfo provide
  // SDK attribution in the Percy dashboard. externalDebugUrl is omitted for
  // local Appium (no remote session to link). fullscreen=false → single tile
  // (component-level testing needs no full-page stitching).
  await utils.postComparison({
    name: input.name,
    clientInfo: CLIENT_INFO,
    environmentInfo: input.environmentInfo,
    tag: {
      name: input.tag,
      osName: device.osName,
      osVersion: device.osVersion,
      deviceName: device.deviceName,
      orientation: device.orientation,
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
