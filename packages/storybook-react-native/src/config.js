import { err } from './errors.js';

/**
 * `.percy.yml` schema under the `storybook-rn:` key.
 * Resolved + defaulted via `mergeConfig()`.
 *
 * @typedef {Object} StorybookRNConfig
 * @property {{ server: string, capabilities: Record<string, unknown> }} appium
 * @property {{ websocketHost: string, websocketPort: number, waitForReadyMs: number, settleMs: number }} storybook
 * @property {string[]} include
 * @property {string[]} skip
 */

/** @type {StorybookRNConfig} */
export const DEFAULT_CONFIG = {
  appium: {
    server: 'http://localhost:4723',
    capabilities: {},
  },
  storybook: {
    websocketHost: 'localhost',
    websocketPort: 7007,
    // Backstop wait for the device render-ack. Kept in sync with the value the
    // init template scaffolds into .percy.yml.
    waitForReadyMs: 4000,
    // Settle delay after render commit (animations / image decode) before the
    // screenshot is taken.
    settleMs: 250,
  },
  include: ['**/*'],
  skip: [],
};

/**
 * Merges a partial user config over defaults. Always returns a fresh object so
 * callers can mutate the result (e.g. applying --include) without corrupting
 * the shared DEFAULT_CONFIG singleton.
 * @param {Partial<StorybookRNConfig>} [partial]
 * @returns {StorybookRNConfig}
 */
export function mergeConfig(partial) {
  // Always build a fresh object (never return the shared DEFAULT_CONFIG
  // singleton) so callers can safely mutate the result (e.g. applying
  // --include). Then validate before handing it back.
  partial ??= {};
  const merged = {
    appium: {
      ...DEFAULT_CONFIG.appium,
      ...partial.appium,
      capabilities: {
        ...DEFAULT_CONFIG.appium.capabilities,
        ...(partial.appium?.capabilities ?? {}),
      },
    },
    storybook: {
      ...DEFAULT_CONFIG.storybook,
      ...partial.storybook,
    },
    include: partial.include ?? DEFAULT_CONFIG.include,
    skip: partial.skip ?? DEFAULT_CONFIG.skip,
  };
  assertValidConfig(merged);
  return merged;
}

/**
 * Validate the externally-supplied connection settings before they get
 * templated into request URLs (the Appium server URL and the Storybook
 * channel `http://host:port/...`). These come from `.percy.yml`, so a
 * malformed value should fail fast with a clear message rather than produce
 * a corrupt URL.
 *
 * @param {StorybookRNConfig} cfg
 */
function assertValidConfig(cfg) {
  let serverOk = false;
  try {
    const u = new URL(cfg.appium.server);
    serverOk = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    serverOk = false;
  }
  if (!serverOk) {
    throw err(
      'invalid_config',
      `storybook-rn.appium.server must be an http(s) URL, got "${cfg.appium.server}".`,
      'Set it to e.g. http://localhost:4723.',
    );
  }

  const host = cfg.storybook.websocketHost;
  // Bare hostname or IPv4 only — no scheme, port, path, or credentials, so it
  // can't break out of the `http://${host}:${port}` template.
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host)) {
    throw err(
      'invalid_config',
      `storybook-rn.storybook.websocketHost must be a bare hostname or IP, got "${host}".`,
      'Use e.g. "localhost" or "127.0.0.1" — no scheme, port, or path.',
    );
  }

  const port = cfg.storybook.websocketPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw err(
      'invalid_config',
      `storybook-rn.storybook.websocketPort must be an integer 1–65535, got ${port}.`,
      'Set it to your Storybook channel port (default 7007).',
    );
  }
}

/**
 * `.percy.yml` schema fragment registered with `@percy/config`.
 * The top-level key (`storybookRn`) is camelCase because Percy's config
 * loader normalizes kebab-case YAML keys (`storybook-rn:`) into camelCase
 * before schema validation. Reads via `allConfig?.storybookRn`.
 */
export const PERCY_CONFIG_SCHEMA = {
  storybookRn: {
    type: 'object',
    additionalProperties: false,
    properties: {
      appium: {
        type: 'object',
        additionalProperties: false,
        properties: {
          server: { type: 'string', default: DEFAULT_CONFIG.appium.server },
          capabilities: { type: 'object' },
        },
      },
      storybook: {
        type: 'object',
        additionalProperties: false,
        properties: {
          websocketHost: { type: 'string', default: DEFAULT_CONFIG.storybook.websocketHost },
          websocketPort: { type: 'integer', default: DEFAULT_CONFIG.storybook.websocketPort },
          waitForReadyMs: { type: 'integer', default: DEFAULT_CONFIG.storybook.waitForReadyMs },
          settleMs: { type: 'integer', default: DEFAULT_CONFIG.storybook.settleMs },
        },
      },
      include: { type: 'array', items: { type: 'string' } },
      skip: { type: 'array', items: { type: 'string' } },
    },
  },
};
