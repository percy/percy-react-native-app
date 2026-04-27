/**
 * `.percy.yml` schema under the `storybook-rn:` key.
 * Resolved + defaulted via `mergeConfig()`.
 *
 * @typedef {Object} StorybookRNConfig
 * @property {{ server: string, capabilities: Record<string, unknown> }} appium
 * @property {{ websocketHost: string, websocketPort: number, waitForReadyMs: number }} storybook
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
    waitForReadyMs: 1000,
  },
  include: ['**/*'],
  skip: [],
};

/**
 * Merges a partial user config over defaults.
 * @param {Partial<StorybookRNConfig>} [partial]
 * @returns {StorybookRNConfig}
 */
export function mergeConfig(partial) {
  if (!partial) return DEFAULT_CONFIG;
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
        },
      },
      include: { type: 'array', items: { type: 'string' } },
      skip: { type: 'array', items: { type: 'string' } },
    },
  },
};
