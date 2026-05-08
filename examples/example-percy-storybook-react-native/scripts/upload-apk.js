#!/usr/bin/env node
/**
 * upload-apk — convenience helper to upload an APK to BrowserStack App Automate.
 *
 * Customers can use this OR the SDK's built-in `provisionApp` helper. This
 * script is provided so the example repo's tutorial mirrors the
 * `example-percy-appium-js` step-by-step flow.
 *
 * Usage:
 *   PERCY_APP_PATH=./resources/PercyStorybookExample.apk \
 *   BROWSERSTACK_USERNAME=... BROWSERSTACK_ACCESS_KEY=... \
 *   node scripts/upload-apk.js
 */
import { provisionApp } from '@percy/storybook-react-native';

async function main() {
  const appPath = process.env.PERCY_APP_PATH;
  if (!appPath) {
    console.error('Set PERCY_APP_PATH to the local .apk path.');
    process.exit(2);
  }
  const ref = await provisionApp(appPath);
  console.log(`\n  export PERCY_APP_URL="${ref}"\n`);
}

main().catch((err) => {
  console.error('[upload-apk]', err.message ?? err);
  process.exit(1);
});
