import command, { PercyConfig } from '@percy/cli-command';
import { mergeConfig, PERCY_CONFIG_SCHEMA } from '../config.js';
import { AppiumClient } from '../appium-client.js';
import { StorybookChannelClient } from '../storybook-channel.js';
import { isPercyEnabled } from '../comparison-poster.js';

/**
 * `percy storybook-rn doctor`
 *
 * Local-only preflight checks. Does NOT upload anything.
 * Verifies the customer's stack is wired up correctly:
 *   - PERCY_TOKEN set
 *   - Percy CLI server reachable (i.e. invoked via `percy exec`)
 *   - Appium server reachable
 *   - Storybook RN WebSocket reachable
 */
export default command('doctor', {
  description: 'Run preflight checks for the Storybook RN integration.',
  config: {
    schemas: [PERCY_CONFIG_SCHEMA],
  },
}, async ({ log, exit }) => {
  const allConfig = PercyConfig.load({ print: false });
  const config = mergeConfig(allConfig?.storybookRn);

  /** @type {Array<[string, () => Promise<string>]>} */
  const checks = [
    ['PERCY_TOKEN', async () => {
      if (!process.env.PERCY_TOKEN) throw new Error('PERCY_TOKEN env var is not set.');
      return 'set';
    }],
    ['Percy CLI server', async () => {
      const ok = await isPercyEnabled();
      if (!ok) throw new Error('Percy CLI not running. Wrap with `percy exec`.');
      return 'reachable';
    }],
    [`Appium @ ${config.appium.server}`, async () => {
      const c = new AppiumClient({
        server: config.appium.server,
        capabilities: config.appium.capabilities,
      });
      await c.connect();
      await c.disconnect();
      return 'reachable';
    }],
    [`Storybook channel @ ${config.storybook.websocketHost}:${config.storybook.websocketPort}`, async () => {
      const ch = new StorybookChannelClient({
        host: config.storybook.websocketHost,
        port: config.storybook.websocketPort,
      });
      await ch.probe();
      return 'reachable';
    }],
  ];

  let failed = 0;
  for (const [name, check] of checks) {
    try {
      const result = await check();
      log.info(`✓ ${name}: ${result}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`✗ ${name}: ${msg}`);
      failed++;
    }
  }

  if (failed > 0) {
    log.error(`${failed} check(s) failed.`);
    return exit(1, `${failed} check(s) failed`, false);
  }
  log.info('All checks passed.');
});
