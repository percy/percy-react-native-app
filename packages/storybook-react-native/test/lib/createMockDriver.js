/**
 * Shared mock-driver factory for library-mode tests.
 *
 * Returns an object that satisfies the subset of webdriverio v9's Browser
 * interface used by the library SDK. Tests stub method behavior via the
 * `behavior` object — easy to script multi-step navigator state changes.
 *
 * Usage:
 *   const driver = createMockDriver({
 *     capabilities: { 'bstack:options': { userName: 'u', accessKey: 'k' } },
 *     behavior: {
 *       takeScreenshot: () => 'iVBORw0KGgo=...', // base64 PNG
 *       elements: { '~mobile-menu-button': { click: vi.fn() } },
 *     }
 *   });
 */
import { vi } from 'vitest';

export function createMockDriver({
  capabilities = {},
  behavior = {},
  sessionId = 'mock-session-id',
} = {}) {
  const driver = {
    capabilities,
    sessionId,
    pause: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    takeScreenshot: vi.fn(async () => behavior.takeScreenshot?.() ?? 'mock-base64-png'),
    executeScript: vi.fn(async (script, args) => {
      if (behavior.executeScript) return behavior.executeScript(script, args);
      return undefined;
    }),
    $: vi.fn(async (selector) => {
      const elements = behavior.elements ?? {};
      const stub = elements[selector];
      if (stub === undefined) {
        // Default — element not present.
        return {
          isExisting: vi.fn(async () => false),
          click: vi.fn(async () => { throw new Error(`element ${selector} not found`); }),
        };
      }
      return {
        isExisting: vi.fn(async () => stub.isExisting !== false),
        click: stub.click ?? vi.fn(async () => {}),
      };
    }),
  };
  return driver;
}
