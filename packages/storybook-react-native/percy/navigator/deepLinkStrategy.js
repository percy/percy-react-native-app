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
 * @param {object} appiumDriver  AppiumDriver wrapper
 * @param {{ id: string }} descriptor
 * @param {{ appScheme: string, appPackage: string, renderMs?: number }} opts
 */
export async function deepLinkNavigate(appiumDriver, descriptor, opts) {
  const merged = { ...DEFAULTS, ...opts };
  if (!merged.appScheme || !merged.appPackage) {
    throw err(
      'invalid_descriptor',
      'Deep-link strategy requires appScheme and appPackage options.',
      'Either set both, or drop navigationStrategy to use the default UI-tap path.',
    );
  }

  const url = buildDeepLinkUrl(merged.appScheme, descriptor.id);
  try {
    await appiumDriver.executeScript('mobile: deepLink', {
      url,
      package: merged.appPackage,
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    // iOS < 16.4 surfaces 'unknown command' from XCUITest for mobile: deepLink.
    if (/unknown command/i.test(msg) || /not implemented/i.test(msg)) {
      throw err(
        'deep_link_unsupported_platform',
        'mobile: deepLink is unreliable on iOS < 16.4 and not supported by all Appium drivers.',
        'Drop navigationStrategy to use the default UI-tap path on this platform.',
        cause,
      );
    }
    throw err(
      'nav_element_not_found',
      `Deep link via mobile: deepLink failed for ${descriptor.id}.`,
      'Verify the URL scheme is registered in app.json / AndroidManifest.xml and the appPackage matches.',
      cause,
    );
  }

  await appiumDriver.pause(merged.renderMs);
  return { renderMs: merged.renderMs };
}
