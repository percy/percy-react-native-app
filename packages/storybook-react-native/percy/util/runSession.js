import { log } from './log.js';

/**
 * runSession — try/finally wrapper that guarantees driver.deleteSession()
 * runs even when the customer's test body throws. Reduces the high-frequency
 * "customer forgot finally{}" mistake that leaves dangling BrowserStack
 * sessions burning quota.
 *
 * Usage:
 *   await runSession(driver, async () => {
 *     for (const story of await discoverStories()) {
 *       await percyStorybookSnapshot(driver, story);
 *     }
 *   });
 */
export async function runSession(driver, fn) {
  try {
    return await fn();
  } finally {
    try {
      await driver.deleteSession();
    } catch (cause) {
      // Best-effort: don't let a teardown failure mask the original test
      // failure, but surface it at debug level so a leaked session is
      // diagnosable rather than invisible.
      log.debug(`[storybook-rn] deleteSession() failed during teardown: ${cause instanceof Error ? cause.message : cause}`);
    }
  }
}
