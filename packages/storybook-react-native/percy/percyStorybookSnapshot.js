import { ProviderResolver } from './providers/providerResolver.js';
import { navigateToStory } from './navigator/navigateToStory.js';
import { assertValidStoryDescriptor } from './util/validations.js';
import { TimeIt } from './util/timing.js';
import { log } from './util/log.js';
import { postFailedEvent } from './util/postFailedEvents.js';
import { err } from '../src/errors.js';

/**
 * Primary library-mode entry point. Mirrors @percy/percy-appium-js's
 * `percyScreenshot(driver, name, options)` shape exactly:
 *
 *   const percyStorybookSnapshot = require('@percy/storybook-react-native');
 *   await percyStorybookSnapshot(driver, story, options);
 *
 * Where `story` is the descriptor from `discoverStories()`:
 *   { id: 'forms-button--primary', name: 'Primary', componentTitle: 'Forms/Button' }
 *
 * Capture is delegated to `@percy/appium-app`'s `percyScreenshot` so we
 * inherit its option surface (freezeAnimatedImage, percyCSS, ignoreRegion
 * helpers, etc.). `@percy/appium-app` is a peerDependency.
 *
 * @param {object} driver  webdriverio v9 Browser
 * @param {{ id: string, name: string, componentTitle: string }} story
 * @param {object} [options]  navigation + snapshot options (snapshot
 *   options pass through to @percy/appium-app's percyScreenshot).
 */
export default async function percyStorybookSnapshot(driver, story, options = {}) {
  assertValidStoryDescriptor(story);

  const provider = ProviderResolver.resolve(driver);
  const snapshotName = `${story.componentTitle}/${story.name}/${provider.metadata.deviceLabel()}`;

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

  const { durationMs } = await TimeIt.run(async () => {
    try {
      // Pass `freezeAnimatedImage: true` by default to mitigate animated
      // content (Lottie, GIF, blinking cursors) breaking the screenshot-
      // stability render-ready signal.
      const snapshotOpts = { freezeAnimatedImage: true, ...options.snapshot };
      await navigateToStory(provider.driver, story, options);
      await percyScreenshot(driver, snapshotName, snapshotOpts);
    } catch (cause) {
      // Best-effort telemetry — never let postFailedEvent failure mask the original.
      const code = /** @type {{ code?: string }} */ (cause)?.code ?? 'screenshot_failed';
      postFailedEvent({
        message: cause instanceof Error ? cause.message : String(cause),
        errorCode: code,
        kind: 'storybook_rn_snapshot',
      });
      throw cause;
    }
  });

  log.debug(`[storybook-rn] ${story.id} captured in ${durationMs}ms (${provider.transport()})`);
}
