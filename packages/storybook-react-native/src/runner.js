import { AppiumClient } from './appium-client.js';
import { StorybookWSClient } from './storybook-ws.js';
import { postSnapshotComparison } from './comparison-poster.js';
import { err } from './errors.js';

/**
 * @typedef {import('./config.js').StorybookRNConfig} StorybookRNConfig
 * @typedef {import('./storybook-ws.js').StoryDescriptor} StoryDescriptor
 *
 * @typedef {Object} RunnerOpts
 * @property {StorybookRNConfig} config
 * @property {(line: string) => void} [onProgress]   live progress callback
 * @property {boolean} [hasAddon]                    if true, awaits addon's percy:ready signal
 * @property {StoryDescriptor[]} [stories]           explicit story list (Week 1: required; Week 2: auto-discover)
 */

/**
 * Main orchestration loop:
 *   for each story → setCurrentStory → wait → screenshot → postComparison
 *
 * @param {RunnerOpts} opts
 */
export async function run(opts) {
  const { config } = opts;
  const log = opts.onProgress ?? (() => {});

  const stories = opts.stories ?? [];
  if (stories.length === 0) {
    throw err(
      'no_stories_found',
      'No stories provided. Story enumeration via WebSocket lands in week 2.',
      'For now, pass stories explicitly via the `stories` option.',
    );
  }

  const filtered = applyFilters(stories, config.include, config.skip);
  if (filtered.length === 0) {
    throw err(
      'include_zero_match',
      `No stories matched include=[${config.include.join(', ')}] skip=[${config.skip.join(', ')}].`,
      'Adjust your `include` / `skip` patterns in .percy.yml.',
    );
  }

  const appium = new AppiumClient({
    server: config.appium.server,
    capabilities: config.appium.capabilities,
  });
  const ws = new StorybookWSClient({
    host: config.storybook.websocketHost,
    port: config.storybook.websocketPort,
  });

  try {
    log(`[percy] Connecting to Appium @ ${config.appium.server}...`);
    await appium.connect();
    const deviceLabel = appium.getDeviceLabel();
    log(`[percy] Appium session ready (device: ${deviceLabel}).`);

    log(`[percy] Connecting to Storybook WS @ ${config.storybook.websocketHost}:${config.storybook.websocketPort}...`);
    await ws.connect();
    log(`[percy] Storybook WebSocket open.`);

    let captured = 0;
    const total = filtered.length;
    for (const story of filtered) {
      log(`[percy] [${++captured}/${total}] ${story.id} on ${deviceLabel}`);

      ws.setCurrentStory(story.id);

      if (opts.hasAddon) {
        await ws.awaitReady(story.id, config.storybook.waitForReadyMs);
      } else {
        await sleep(config.storybook.waitForReadyMs);
      }

      const screenshotBase64 = await appium.takeScreenshot();
      await postSnapshotComparison({
        name: `${story.componentTitle}/${story.name}/${deviceLabel}`,
        tag: deviceLabel,
        screenshotBase64,
      });
    }

    log(`[percy] Done. Captured ${captured} snapshot(s).`);
  } finally {
    ws.close();
    await appium.disconnect();
  }
}

/**
 * @param {StoryDescriptor[]} stories
 * @param {string[]} include
 * @param {string[]} skip
 * @returns {StoryDescriptor[]}
 */
export function applyFilters(stories, include, skip) {
  const includesAll = include.length === 0 || include.includes('**/*');
  return stories.filter((s) => {
    const id = s.id;
    if (skip.some((pat) => globMatch(pat, id))) return false;
    if (includesAll) return true;
    return include.some((pat) => globMatch(pat, id));
  });
}

/**
 * Minimal glob matcher — supports `*` and `**`. No bracket / negation support.
 * Sufficient for story-id patterns like `Button/*` or `Card/**`.
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
