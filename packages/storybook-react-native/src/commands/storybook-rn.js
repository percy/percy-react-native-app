import command, { PercyConfig } from '@percy/cli-command';
import { mergeConfig, PERCY_CONFIG_SCHEMA } from '../config.js';
import { run } from '../runner.js';
import { PercyStorybookRNError } from '../errors.js';
import { enumerateStories } from '../story-enumerator.js';
import { postFailedEvent } from '../../percy/util/postFailedEvents.js';
import doctor from './doctor.js';
import init from './init.js';

/**
 * Primary command: `percy storybook-rn`
 *
 * Reads `.percy.yml` → `storybookRn:` config, connects to Appium, drives
 * Storybook RN's HTTP channel server (port 7007) to render each story,
 * captures screenshots via Appium, uploads to Percy via the local CLI server.
 *
 * Story selection (in order of precedence):
 *   1. --stories flag (comma-separated explicit list)
 *   2. Auto-enumeration from .rnstorybook/main.{ts,js} + .stories.* files
 *
 * Subcommands:
 *   - `percy storybook-rn:doctor` — local preflight checks
 *   - `percy storybook-rn:init`   — scaffolding
 */
export default command('storybook-rn', {
  commands: [doctor, init],
  description: 'Capture Percy snapshots of React Native Storybook stories.',
  flags: [
    {
      name: 'include',
      description: 'Story-id glob pattern(s) to capture, comma-separated (overrides .percy.yml include).',
      type: 'string',
    },
    {
      name: 'exclude',
      description: 'Story-id glob pattern(s) to skip, comma-separated (merged with .percy.yml skip).',
      type: 'string',
    },
    {
      name: 'stories',
      description: 'Explicit comma-separated story IDs to capture (e.g. "example-button--primary"). Overrides auto-enumeration.',
      type: 'string',
    },
    {
      name: 'config-dir',
      description: 'Path to the Storybook RN config dir (default: .rnstorybook).',
      type: 'string',
      attribute: 'configDir',
    },
    {
      name: 'dry-run',
      description: 'Print the discovered stories without uploading anything.',
      type: 'boolean',
      attribute: 'dryRun',
    },
  ],
  config: {
    schemas: [PERCY_CONFIG_SCHEMA],
  },
}, async ({ flags, log, exit }) => {
  const allConfig = PercyConfig.load({ print: false });
  const userConfig = allConfig?.storybookRn;
  const config = mergeConfig(userConfig);

  if (flags.include) {
    config.include = splitPatterns(flags.include);
  }
  if (flags.exclude) {
    config.skip = [...config.skip, ...splitPatterns(flags.exclude)];
  }

  let stories;
  try {
    if (flags.stories) {
      stories = parseStoriesFlag(flags.stories);
      log.info(`Using ${stories.length} stories from --stories flag.`);
    } else {
      const configDir = flags.configDir || '.rnstorybook';
      log.info(`Auto-enumerating stories from ${configDir}/...`);
      stories = await enumerateStories(process.cwd(), configDir);
      log.info(`Discovered ${stories.length} story/stories.`);
    }
  } catch (e) {
    await reportFailure(e, 'storybook_rn_enumerate');
    if (e instanceof PercyStorybookRNError) {
      log.error(e.toCLIString());
      return exit(1, e.message, false);
    }
    throw e;
  }

  if (flags.dryRun) {
    log.info('Discovered stories (--dry-run; not uploading):');
    for (const s of stories) {
      log.info(`  - ${s.id}  (${s.componentTitle} / ${s.name})`);
    }
    return;
  }

  log.info('Starting Percy Storybook RN run...');

  try {
    await run({
      config,
      stories,
      onProgress: (line) => log.info(line),
    });
  } catch (e) {
    await reportFailure(e, 'storybook_rn_run');
    if (e instanceof PercyStorybookRNError) {
      log.error(e.toCLIString());
      return exit(1, e.message, false);
    }
    throw e;
  }
});

/**
 * Fire best-effort failure telemetry for the CLI capture path. Mirrors the
 * library-mode path in percyStorybookSnapshot — CLI mode previously shipped
 * blind. Awaited so the event isn't dropped on process exit; postFailedEvent
 * never throws.
 *
 * @param {unknown} e
 * @param {string} kind
 */
async function reportFailure(e, kind) {
  const code = e instanceof PercyStorybookRNError ? e.code : 'storybook_rn_cli_failed';
  await postFailedEvent({
    message: e instanceof Error ? e.message : String(e),
    errorCode: code,
    kind,
  });
}

/**
 * Split a comma-separated glob flag into trimmed, non-empty patterns.
 * @param {string} flag
 * @returns {string[]}
 */
function splitPatterns(flag) {
  return flag.split(',').map((p) => p.trim()).filter(Boolean);
}

/**
 * @param {string} flag  comma-separated story IDs
 */
function parseStoriesFlag(flag) {
  return flag
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((id) => {
      const idx = id.lastIndexOf('--');
      const titlePart = idx >= 0 ? id.slice(0, idx) : id;
      const namePart = idx >= 0 ? id.slice(idx + 2) : id;
      return {
        id,
        name: humanize(namePart),
        componentTitle: titlePart.split('-').map(capitalize).join(' '),
      };
    });
}

/** @param {string} s */
function humanize(s) {
  return s.split('-').map(capitalize).join(' ');
}

/** @param {string} s */
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
