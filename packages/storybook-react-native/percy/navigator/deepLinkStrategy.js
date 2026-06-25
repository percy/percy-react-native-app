import { err } from '../../src/errors.js';
import { MetadataResolver } from '../metadata/metadataResolver.js';

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
 * via its built-in URL handler — no customer-side URL handler needed.
 * Reference: `STORYBOOK_STORY_ID_PARAM` constant in
 * https://github.com/storybookjs/react-native/blob/main/packages/react-native/src/constants.ts
 */

const DEFAULTS = {
  renderMs: 1500,
  globalNavigationBudgetMs: 8000,
  /**
   * Hard cap on a single `driver.url()` / `mobile: deepLink` call. Below
   * this, the navigation hasn't taken effect — re-tries / fallback paths
   * are the caller's job. Sized to comfortably exceed normal latency
   * (200ms–1s) without leaving a stuck session for tens of seconds.
   */
  deepLinkTimeoutMs: 10_000,
};

/**
 * Race a promise against a timeout, rejecting with a `deep_link_unsupported_platform`
 * error if it doesn't settle in time. Used so a stuck `driver.url()` doesn't
 * hold the whole snapshot run hostage.
 *
 * @template T
 * @param {Promise<T>} p
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(p, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(err(
        'deep_link_unsupported_platform',
        `${label} did not settle within ${timeoutMs}ms.`,
        'The driver may be wedged or the URL scheme may not be registered. Drop navigationStrategy to use the default UI-tap path on this platform.',
      ));
    }, timeoutMs);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

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
 * @param {object} appiumDriver  AppiumDriver wrapper
 * @param {{ id: string }} descriptor
 * @param {{ appScheme: string, appPackage: string, renderMs?: number, deepLinkTimeoutMs?: number }} opts
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

  // Single source of truth for platform + version gating. MetadataResolver
  // wraps the raw caps in IosMetadata / AndroidMetadata so we don't end up
  // with parallel regex extractors drifting from each other.
  const metadata = await MetadataResolver.resolveLive(appiumDriver.driver);
  const isIos = metadata.platformName().toLowerCase() === 'ios';
  const url = buildDeepLinkUrl(merged.appScheme, descriptor.id);

  try {
    if (isIos) {
      // iOS < 16.4 — fail-fast. `driver.url()` and `mobile: deepLink` are both
      // unreliable below 16.4 per parent plan §17.3 and the appium-xcuitest-driver
      // issue tracker (https://github.com/appium/appium-xcuitest-driver/issues/2049).
      if (typeof metadata.supportsDeepLink === 'function' && !metadata.supportsDeepLink()) {
        const major = metadata.platformVersionMajor?.() ?? '?';
        const minor = metadata.platformVersionMinor?.() ?? '?';
        throw err(
          'deep_link_unsupported_platform',
          `mobile: deepLink is unreliable on iOS < 16.4 (got ${major}.${minor}).`,
          'Drop navigationStrategy to use the default UI-tap path on this platform, or bump appium:platformVersion to 16.4+.',
        );
      }
      // iOS 16.4+ — driver.url() reliably routes through the URL scheme handler.
      // XCUITest's mobile: deepLink works similarly but driver.url() is the
      // documented contract.
      const wdioDriver = appiumDriver.driver;
      if (typeof wdioDriver.url === 'function') {
        await withTimeout(wdioDriver.url(url), merged.deepLinkTimeoutMs, 'driver.url()');
      } else {
        await withTimeout(
          appiumDriver.executeScript('mobile: deepLink', { url }),
          merged.deepLinkTimeoutMs,
          'mobile: deepLink',
        );
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
      await withTimeout(
        appiumDriver.executeScript('mobile: deepLink', {
          url,
          package: merged.appPackage,
        }),
        merged.deepLinkTimeoutMs,
        'mobile: deepLink',
      );
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
