import { err } from '../../src/errors.js';

/**
 * Deep-link navigation strategy — Phase 1.5/2 OPT-IN.
 *
 * Activated by passing `navigationStrategy: 'deeplink'` + `appScheme` +
 * `appPackage` to percyStorybookSnapshot().
 *
 * Tradeoff (documented in the plan): faster (~500ms vs ~2s/story) but
 * requires the customer to register a URL scheme in app.json (Expo) or
 * AndroidManifest.xml (bare RN). The default UI-tap path avoids that
 * onboarding step entirely.
 *
 * Storybook RN reads the `STORYBOOK_STORY_ID` URL parameter natively
 * via its built-in URL handler — no customer-side React code needed.
 * Reference: `STORYBOOK_STORY_ID_PARAM` constant in
 * https://github.com/storybookjs/react-native/blob/main/packages/react-native/src/constants.ts
 */

const DEFAULTS = {
  renderMs: 1500,
  globalNavigationBudgetMs: 8000,
};

/**
 * Build the deep-link URL. The trailing `:///` shape (three slashes
 * before the query string) matches the Expo example pattern documented
 * in storybookjs/react-native/examples/expo-example/README.md.
 *
 * Story IDs come from `enumerateStories()` in canonical CSF kebab-case
 * form (e.g. `forms-button--primary`) — directly compatible with
 * Storybook RN's STORYBOOK_STORY_ID parameter format.
 *
 * @param {string} scheme
 * @param {string} storyId
 */
export function buildDeepLinkUrl(scheme, storyId) {
  return `${scheme}:///?STORYBOOK_STORY_ID=${encodeURIComponent(storyId)}`;
}

/**
 * Detect platform from driver capabilities — cheap, no caching.
 */
function detectPlatform(appiumDriver) {
  const caps = appiumDriver.driver?.capabilities ?? {};
  return String(caps['appium:platformName'] ?? caps.platformName ?? '').toLowerCase();
}

/**
 * Read iOS version from caps to gate `driver.url()` deep-link on iOS < 16.4.
 * @returns {{ major: number, minor: number } | null}
 */
function readIosVersion(appiumDriver) {
  const caps = appiumDriver.driver?.capabilities ?? {};
  const raw = caps['appium:platformVersion'] ?? caps.platformVersion;
  if (!raw) return null;
  const m = String(raw).match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] ?? 0) };
}

/**
 * @param {object} appiumDriver  AppiumDriver wrapper
 * @param {{ id: string }} descriptor
 * @param {{ appScheme: string, appPackage: string, renderMs?: number }} opts
 */
export async function deepLinkNavigate(appiumDriver, descriptor, opts) {
  const merged = { ...DEFAULTS, ...opts };
  if (!merged.appScheme) {
    throw err(
      'invalid_descriptor',
      'Deep-link strategy requires appScheme option.',
      'Either set appScheme (and appPackage for Android), or drop navigationStrategy to use the default UI-tap path.',
    );
  }

  const platform = detectPlatform(appiumDriver);
  const url = buildDeepLinkUrl(merged.appScheme, descriptor.id);

  try {
    if (platform === 'ios') {
      // iOS < 16.4 — fail-fast. `driver.url()` and `mobile: deepLink` are both
      // unreliable below 16.4 per parent plan §17.3 and the appium-xcuitest-driver
      // issue tracker (https://github.com/appium/appium-xcuitest-driver/issues/2049).
      const ver = readIosVersion(appiumDriver);
      if (ver && (ver.major < 16 || (ver.major === 16 && ver.minor < 4))) {
        throw err(
          'deep_link_unsupported_platform',
          `mobile: deepLink is unreliable on iOS < 16.4 (got ${ver.major}.${ver.minor}).`,
          'Drop navigationStrategy to use the default UI-tap path on this platform, or bump appium:platformVersion to 16.4+.',
        );
      }
      // iOS 16.4+ — driver.url() reliably routes through the URL scheme handler.
      // XCUITest's mobile: deepLink works similarly but driver.url() is the
      // documented contract.
      const wdioDriver = appiumDriver.driver;
      if (typeof wdioDriver.url === 'function') {
        await wdioDriver.url(url);
      } else {
        await appiumDriver.executeScript('mobile: deepLink', { url });
      }
    } else {
      // Android — mobile: deepLink with package id.
      if (!merged.appPackage) {
        throw err(
          'invalid_descriptor',
          'Deep-link strategy requires appPackage on Android.',
          'Set appPackage to your Android package id (e.g. com.acme.storybook).',
        );
      }
      await appiumDriver.executeScript('mobile: deepLink', {
        url,
        package: merged.appPackage,
      });
    }
  } catch (cause) {
    // Re-throw typed PercyStorybookRNError as-is (the iOS<16.4 + missing appPackage
    // paths above are already typed).
    if (cause && /** @type {{ code?: string }} */ (cause).code) throw cause;
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (/unknown command/i.test(msg) || /not implemented/i.test(msg)) {
      throw err(
        'deep_link_unsupported_platform',
        'mobile: deepLink / driver.url() is unreliable on this device/driver version.',
        'Drop navigationStrategy to use the default UI-tap path on this platform.',
        cause,
      );
    }
    throw err(
      'nav_element_not_found',
      `Deep link failed for ${descriptor.id}.`,
      'Verify the URL scheme is registered (Expo app.json, AndroidManifest.xml, or iOS Info.plist CFBundleURLTypes) and the appPackage matches.',
      cause,
    );
  }

  await appiumDriver.pause(merged.renderMs);
  return { renderMs: merged.renderMs };
}
