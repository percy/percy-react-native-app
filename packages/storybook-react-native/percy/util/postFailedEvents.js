import { createRequire } from 'module';
import * as utils from '@percy/sdk-utils';
import { log } from './log.js';

const require = createRequire(import.meta.url);
const sdkPkg = require('../../package.json');
// e.g. "@percy/storybook-react-native/0.2.0" — used by the CLI for SDK attribution.
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;

/**
 * Best-effort telemetry for SDK-internal failures. Mirrors
 * @percy/percy-appium-js's util/postFailedEvents.js — the SDK should
 * surface its own internal errors to Percy CLI for analytics, but a
 * failure here must never break the customer's test run.
 *
 * @param {{ clientInfo?: string, message: string, errorCode?: string, kind?: string }} ev
 */
export async function postFailedEvent(ev) {
  try {
    await utils.postBuildEvents({
      clientInfo: ev.clientInfo ?? CLIENT_INFO,
      message: ev.message,
      errorKind: ev.kind ?? 'sdk_error',
      errorCode: ev.errorCode,
    });
  } catch (cause) {
    // Telemetry is best-effort — never throw out of this function.
    log.debug(`postFailedEvent ignored: ${cause instanceof Error ? cause.message : cause}`);
  }
}
