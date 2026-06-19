import { AppiumClient } from './appium-client.js';
import { StorybookChannelClient } from './storybook-channel.js';
import { postSnapshotComparison } from './comparison-poster.js';
import { err } from './errors.js';

/**
 * @typedef {import('./config.js').StorybookRNConfig} StorybookRNConfig
 *
 * @typedef {Object} StoryDescriptor
 * @property {string} id              canonical Storybook story ID, e.g. "example-button--primary"
 * @property {string} name            short display name, e.g. "Primary"
 * @property {string} componentTitle  group title, e.g. "Example/Button"
 *
 * @typedef {Object} RunnerOpts
 * @property {StorybookRNConfig} config
 * @property {StoryDescriptor[]} stories
 * @property {(line: string) => void} [onProgress]
 */

/**
 * Main orchestration loop:
 *   for each story → POST /select-story-sync (wait render) → screenshot → postComparison
 *
 * Uses Storybook RN's HTTP `/select-story-sync/<id>` endpoint, which internally
 * broadcasts setCurrentStory over WebSocket and blocks until the device acks.
 *
 * @param {RunnerOpts} opts
 */
export async function run(opts) {
  const { config } = opts;
  const log = opts.onProgress ?? (() => {});

  if (!opts.stories || opts.stories.length === 0) {
    throw err(
      'no_stories_found',
      'No stories provided. Pass via --stories or storybook-rn.stories config.',
      'WebSocket-driven story enumeration is a planned enhancement — for now, list story IDs explicitly.',
    );
  }

  const filtered = applyFilters(opts.stories, config.include, config.skip);
  if (filtered.length === 0) {
    throw err(
      'include_zero_match',
      `No stories matched include=[${config.include.join(', ')}] skip=[${config.skip.join(', ')}].`,
      'Adjust your `include` / `skip` patterns.',
    );
  }

  const appium = new AppiumClient({
    server: config.appium.server,
    capabilities: config.appium.capabilities,
  });
  const channel = new StorybookChannelClient({
    host: config.storybook.websocketHost,
    port: config.storybook.websocketPort,
  });

  try {
    log(`[percy] Connecting to Appium @ ${config.appium.server}...`);
    await appium.connect();
    const deviceLabel = appium.getDeviceLabel();
    const osName = appium.getPlatformName();
    log(`[percy] Appium session ready (device: ${deviceLabel}).`);

    log(`[percy] Verifying Storybook channel @ ${channel.baseUrl()}...`);
    await channel.probe();
    log(`[percy] Channel reachable.`);

    let captured = 0;
    let failed = 0;
    let index = 0;
    const total = filtered.length;
    for (const story of filtered) {
      log(`[percy] [${++index}/${total}] ${story.id} on ${deviceLabel}`);

      // A failure on a single story must not abort the remaining captures.
      try {
        try {
          await channel.selectAndAwaitRender(story.id, config.storybook.waitForReadyMs);
        } catch (e) {
          log(`[percy] ⚠ Could not confirm render for "${story.id}" — capturing anyway. (${e instanceof Error ? e.message : e})`);
        }

        // Small settle delay for animations / image decoding after render commit.
        await sleep(250);

        const screenshotBase64 = await appium.takeScreenshot();
        await postSnapshotComparison({
          name: `${story.componentTitle}/${story.name}/${deviceLabel}`,
          tag: deviceLabel,
          osName,
          screenshotBase64,
        });
        captured++;
      } catch (e) {
        failed++;
        log(`[percy] ✖ Failed to capture "${story.id}" — skipping. (${e instanceof Error ? e.message : e})`);
      }
    }

    // Resilient to per-story failures, but a run where nothing was captured
    // is a hard failure — surface it (non-zero exit) so CI doesn't go green.
    if (captured === 0 && failed > 0) {
      throw err(
        'all_snapshots_failed',
        `All ${total} story snapshot(s) failed to capture.`,
        'Check the per-story errors above; re-run with DEBUG=1 for details.',
      );
    }

    log(`[percy] Done. Captured ${captured}/${total} snapshot(s)${failed ? `, ${failed} failed.` : '.'}`);
  } finally {
    await appium.disconnect();
  }
}

/**
 * @param {StoryDescriptor[]} stories
 * @param {string[]} include
 * @param {string[]} skip
 */
export function applyFilters(stories, include, skip) {
  const includesAll = include.length === 0 || include.includes('**/*') || include.includes('**');
  return stories.filter((s) => {
    if (skip.some((pat) => globMatch(pat, s.id))) return false;
    if (includesAll) return true;
    return include.some((pat) => globMatch(pat, s.id));
  });
}

/**
 * Minimal glob matcher — supports `*` and `**`. Sufficient for story-id patterns.
 * @param {string} pattern
 * @param {string} input
 */
export function globMatch(pattern, input) {
  if (pattern === '**/*' || pattern === '**') return true;
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__DOUBLESTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__DOUBLESTAR__/g, '.*') +
      '$',
  );
  return re.test(input);
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
