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

  // postComparison accepts a `tiles` array — same shape @percy/appium-app uses.
  // Each tile carries the screenshot bytes; Percy CLI persists + uploads.
  await utils.postComparison({
    name: input.name,
    tag: { name: input.tag },
    tiles: [{ content: buffer.toString('base64') }],
    // No status-bar / nav-bar masking yet — week-2 enhancement.
  });
}
