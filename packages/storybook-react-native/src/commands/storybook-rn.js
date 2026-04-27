import command, { PercyConfig } from '@percy/cli-command';
import { mergeConfig, PERCY_CONFIG_SCHEMA } from '../config.js';
import { run } from '../runner.js';
import { PercyStorybookRNError } from '../errors.js';
import doctor from './doctor.js';
import init from './init.js';

/**
 * Primary command: `percy storybook-rn`
 *
 * Reads `.percy.yml` → `storybookRn:` config, connects to Appium,
 * connects to Storybook RN's WebSocket, iterates stories, screenshots,
 * uploads via Percy CLI's local /percy/comparison endpoint.
 *
 * Subcommands:
 *   - `percy storybook-rn:doctor` — local preflight checks
 *   - `percy storybook-rn:init` — scaffolding
 */
export default command('storybook-rn', {
  commands: [doctor, init],
  description: 'Capture Percy snapshots of React Native Storybook stories.',
  flags: [
    {
      name: 'include',
      description: 'Story-id glob pattern to include (overrides .percy.yml).',
      type: 'string',
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
    config.include = [flags.include];
  }

  log.info('Starting Percy Storybook RN run...');

  try {
    await run({
      config,
      onProgress: (line) => log.info(line),
      // Week 1: stories must be supplied explicitly. Week 2: WS-driven enumeration.
      stories: [],
    });
  } catch (e) {
    if (e instanceof PercyStorybookRNError) {
      log.error(e.toCLIString());
      return exit(1, e.message, false);
    }
    throw e;
  }
});
