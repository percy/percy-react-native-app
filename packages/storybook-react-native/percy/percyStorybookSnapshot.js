import { ProviderResolver } from './providers/providerResolver.js';
import { navigateToStory } from './navigator/navigateToStory.js';
import { assertValidStoryDescriptor } from './util/validations.js';
import { TimeIt } from './util/timing.js';
import { log } from './util/log.js';
import { postFailedEvent } from './util/postFailedEvents.js';
import { err } from '../src/errors.js';

/**
 * Navigation-only option keys — destructured out before passing the rest
 * to @percy/appium-app's percyScreenshot. Everything NOT in this set is
 * forwarded so customers can use percy-appium-js's full flat option
 * surface (regions, scroll, sync, testCase, labels, etc.) at the top
 * level of percyStorybookSnapshot's options arg.
 */
const NAVIGATION_OPTS = new Set([
  'navigationStrategy',
  'appScheme',
  'appPackage',
  'renderMs',
  'coldBootMaxMs',
  'globalNavigationBudgetMs',
  'testIdPollMaxMs',
  'stabilityPollMaxMs',
  'stabilityMaxAttempts',
  'stabilitySettleMs',
  'cacheNavigatorState',
  'snapshot', // legacy escape hatch — kept for backwards compat
]);

/**
 * Primary library-mode entry point. Mirrors @percy/percy-appium-js's
 * `percyScreenshot(driver, name, options)` shape — including the FLAT
 * option surface for snapshot configuration.
 *
 *   import percyStorybookSnapshot from '@percy/storybook-react-native';
 *   await percyStorybookSnapshot(driver, story, options);
 *
 * `story` is the descriptor from `discoverStories()`:
 *   { id: 'forms-button--primary', name: 'Primary', componentTitle: 'Forms/Button' }
 *
 * `options` is a flat object. The SDK consumes the navigation-only keys
 * (`navigationStrategy`, `appScheme`, `appPackage`, `renderMs`, ...) and
 * forwards everything else to @percy/appium-app's percyScreenshot. The
 * forwarded set includes the full percy-appium-js option surface:
 *
 *   Region options (the main reason this is flat):
 *     - ignoreRegionXpaths: string[]               XPaths to ignore in the diff
 *     - ignoreRegionAccessibilityIds: string[]     a11y IDs to ignore
 *     - ignoreRegionAppiumElements: Element[]      wdio Element refs to ignore
 *     - customIgnoreRegions: { top, bottom, left, right }[]  coordinate boxes
 *     - considerRegionXpaths / *AccessibilityIds / *AppiumElements / customConsiderRegions
 *
 *   Full-page + scroll:
 *     - fullPage: boolean
 *     - screenLengths: number
 *     - scrollableXpath / scrollableId
 *     - topScrollviewOffset / bottomScrollviewOffset
 *     - androidScrollAreaPercentage / scrollSpeed
 *
 *   Tile / metadata:
 *     - statusBarHeight: number
 *     - navigationBarHeight: number
 *     - orientation: 'portrait' | 'landscape'
 *     - deviceName: string                          override the auto-derived label
 *
 *   Workflow:
 *     - sync: boolean                               wait for diff completion
 *     - testCase: string                            test-case label
 *     - labels: string[]                            arbitrary tags
 *
 *   Animation:
 *     - freezeAnimatedImage: boolean                default true (we flip the
 *                                                   percy-appium-js default to
 *                                                   stabilize the screenshot-
 *                                                   stability render-ready signal)
 *
 * @param {object} driver  webdriverio v9 Browser
 * @param {{ id: string, name: string, componentTitle: string }} story
 * @param {object} [options]  navigation opts + flat percyScreenshot opts
 */
export default async function percyStorybookSnapshot(driver, story, options = {}) {
  assertValidStoryDescriptor(story);

  const provider = ProviderResolver.resolve(driver);
  // Pull live session caps before building the device label — WDIO v9 often
  // only populates negotiated caps post-session, so the eager static read
  // can otherwise yield `unknown` device names.
  await provider.initMetadata();
  const snapshotName = `${story.componentTitle}/${story.name}/${provider.metadata.deviceLabel()}`;

  // Split the flat options into navigation-only keys and forwarded
  // snapshot keys. Everything NOT in NAVIGATION_OPTS is forwarded to
  // @percy/appium-app's percyScreenshot — that's how customers reach
  // region helpers, fullPage, sync, testCase, etc. directly.
  const navOpts = {};
  const forwardedOpts = {};
  for (const [k, v] of Object.entries(options)) {
    if (NAVIGATION_OPTS.has(k)) navOpts[k] = v;
    else forwardedOpts[k] = v;
  }
  const snapshotOpts = {
    // Default-on freezeAnimatedImage to stabilize the render-ready poll.
    // Customer can override at the top level: { freezeAnimatedImage: false }.
    freezeAnimatedImage: true,
    ...forwardedOpts,
    // Legacy `snapshot: { ... }` nested escape hatch wins last for backwards
    // compat with the pre-flat API. New code should use the flat surface.
    ...(options.snapshot ?? {}),
  };

  let percyScreenshot;
  try {
    // Lazy require so the peerDependency is only loaded if actually used.
    const mod = await import('@percy/appium-app');
    percyScreenshot = mod.default ?? mod;
  } catch (cause) {
    throw err(
      'percy_appium_app_missing',
      '@percy/appium-app is not installed. It is a peer dependency of @percy/storybook-react-native (library mode).',
      'Run: npm install --save-dev @percy/appium-app',
      cause,
    );
  }

  const sessionUrl = provider.sessionUrl();
  if (sessionUrl) {
    log.info(`[storybook-rn] BrowserStack session: ${sessionUrl}`);
  }

  const { result, durationMs } = await TimeIt.run(async () => {
    try {
      await navigateToStory(provider.driver, story, navOpts);
      // Thread the percyScreenshot result (snapshot link / comparison body)
      // back to callers — sync, testCase, and library-mode flows rely on it.
      // Mirrors @percy/appium-app returning response?.body?.data.
      return await percyScreenshot(driver, snapshotName, snapshotOpts);
    } catch (cause) {
      // Best-effort telemetry — never let postFailedEvent failure mask the original.
      const code = /** @type {{ code?: string }} */ (cause)?.code ?? 'screenshot_failed';
      // Await so the event isn't dropped if the process exits right after the
      // throw. postFailedEvent never throws, so this can't mask `cause`.
      await postFailedEvent({
        message: cause instanceof Error ? cause.message : String(cause),
        errorCode: code,
        kind: 'storybook_rn_snapshot',
      });
      throw cause;
    }
  });

  log.debug(`[storybook-rn] ${story.id} captured in ${durationMs}ms (${provider.transport()})`);
  return result;
}

export const __forTesting = { NAVIGATION_OPTS };
