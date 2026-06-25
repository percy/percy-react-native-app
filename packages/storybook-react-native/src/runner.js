import { createRequire } from 'node:module';
import { AppiumClient } from './appium-client.js';
import { StorybookChannelClient } from './storybook-channel.js';
import { postSnapshotComparison } from './comparison-poster.js';
import { err } from './errors.js';

const require = createRequire(import.meta.url);

/**
 * Best-effort SDK-environment attribution string (the Appium client lib +
 * version), mirroring how @percy/appium-app reports `environmentInfo`.
 * @returns {string | undefined}
 */
function resolveEnvironmentInfo() {
  try {
    const { version } = require('webdriverio/package.json');
    return `webdriverio/${version}`;
  } catch {
    return undefined;
  }
}

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
      'No stories were discovered or provided.',
      'Pass explicit IDs via --stories, or check that your .rnstorybook config and .stories.* files exist.',
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

  const environmentInfo = resolveEnvironmentInfo();

  try {
    log(`[percy] Connecting to Appium @ ${config.appium.server}...`);
    await appium.connect();
    const deviceLabel = appium.getDeviceLabel();
    const device = await appium.getDeviceMetadata();
    log(`[percy] Appium session ready (device: ${deviceLabel}, ${device.osName} ${device.osVersion ?? ''}).`);

    log(`[percy] Verifying Storybook channel @ ${channel.baseUrl()}...`);
    await channel.probe();
    log(`[percy] Channel reachable.`);

    let captured = 0;
    const failures = [];
    const total = filtered.length;
    for (const story of filtered) {
      log(`[percy] [${captured + failures.length + 1}/${total}] ${story.id} on ${deviceLabel}`);

      try {
        // A failed render-ack means the device is likely still showing the
        // PREVIOUS story — capturing anyway would silently upload a wrong
        // snapshot that passes review. Mark this story failed and skip its
        // capture/upload, but keep going so one bad story doesn't drop the
        // baselines for every story after it.
        await channel.selectAndAwaitRender(story.id, config.storybook.waitForReadyMs);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        log(`[percy] ✗ ${story.id} — render not confirmed; skipping (not uploading a stale frame). (${reason})`);
        failures.push({ id: story.id, reason });
        continue;
      }

      // Settle delay for animations / image decoding after render commit.
      await sleep(config.storybook.settleMs);

      const screenshotBase64 = await appium.takeScreenshot();
      await postSnapshotComparison({
        name: `${story.componentTitle}/${story.name}/${deviceLabel}`,
        tag: deviceLabel,
        device,
        environmentInfo,
        screenshotBase64,
      });
      captured++;
    }

    log(`[percy] Done. Captured ${captured}/${total} snapshot(s)${failures.length ? `; ${failures.length} failed to render.` : '.'}`);

    // Surface a non-zero result if any story never rendered — the run is
    // incomplete, so CI should fail even though the good snapshots uploaded.
    if (failures.length > 0) {
      throw err(
        'stories_failed_to_render',
        `${failures.length} of ${total} stories failed to render and were skipped (no snapshot uploaded): ${failures.map((f) => f.id).join(', ')}.`,
        'Increase storybook.waitForReadyMs, confirm the device actually rendered each story, or check the Storybook channel connection.',
      );
    }
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
