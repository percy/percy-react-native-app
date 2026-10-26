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
    let failed = 0;
    let index = 0;
    const total = filtered.length;
    for (const story of filtered) {
      log(`[percy] [${++index}/${total}] ${story.id} on ${deviceLabel}`);

      // Render-ack first. A failed ack means the device is likely still
      // showing the PREVIOUS story — capturing anyway would silently upload a
      // wrong snapshot that passes review. Skip this story (no upload) and
      // keep going so one bad story doesn't drop every story after it.
      try {
        await channel.selectAndAwaitRender(story.id, config.storybook.waitForReadyMs);
      } catch (e) {
        failed++;
        log(`[percy] x ${story.id} — render not confirmed; skipping (not uploading a stale frame). (${e instanceof Error ? e.message : e})`);
        continue;
      }

      // Capture + upload. A failure here is also non-fatal to the rest of the
      // run — mark the story failed and continue.
      try {
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
      } catch (e) {
        failed++;
        log(`[percy] x ${story.id} — capture/upload failed; skipping. (${e instanceof Error ? e.message : e})`);
      }
    }

    log(`[percy] Done. Captured ${captured}/${total} snapshot(s)${failed ? `, ${failed} failed.` : '.'}`);

    // Resilient to per-story failures, but a run where nothing was captured
    // is a hard failure — surface it (non-zero exit) so CI doesn't go green.
    if (captured === 0 && failed > 0) {
      throw err(
        'all_snapshots_failed',
        `All ${total} story snapshot(s) failed to capture (render not confirmed or capture/upload errored).`,
        'Check the per-story errors above; re-run with DEBUG=1 for details.',
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
  const toks = compileGlob(pattern);
  const n = toks.length;
  // Zero-width moves: a star or optional atom may match nothing.
  const close = (set) => {
    const stack = [...set];
    while (stack.length) {
      const i = stack.pop();
      if (i < n && (toks[i].k !== 'lit' || toks[i].opt) && !set.has(i + 1)) {
        set.add(i + 1);
        stack.push(i + 1);
      }
    }
    return set;
  };
  let cur = close(new Set([0]));
  for (let p = 0; p < input.length; p++) {
    const ch = input[p];
    const next = new Set();
    for (const i of cur) {
      if (i >= n) continue;
      const t = toks[i];
      if (t.k === 'lit' && t.c === ch) next.add(i + 1);
      else if (t.k === 'star' && ch !== '/') next.add(i);
      else if (t.k === 'dstar' && !LINE_TERMINATOR.test(ch)) next.add(i);
    }
    if (next.size === 0) return false;
    cur = close(next);
  }
  return cur.has(n);
}

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

// Tokenise the legacy glob->regex source so it can run on a linear NFA.
function compileGlob(pattern) {
  const src = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  // Validation only: keeps the legacy SyntaxError for malformed globs (never matched with).
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  new RegExp('^' + src + '$');
  const toks = [];
  for (let i = 0; i < src.length; ) {
    let t;
    if (src.startsWith('[^/]*', i)) {
      t = { k: 'star' };
      i += 5;
    } else if (src.startsWith('.*', i)) {
      t = { k: 'dstar' };
      i += 2;
    } else if (src[i] === '\\') {
      t = { k: 'lit', c: src[i + 1] };
      i += 2;
    } else {
      t = { k: 'lit', c: src[i] };
      i += 1;
    }
    if (src[i] === '?') {
      t.opt = true;
      i++;
      if (src[i] === '?') i++;
    }
    toks.push(t);
  }
  return toks;
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
