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
  partial ??= {};
  return {
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
