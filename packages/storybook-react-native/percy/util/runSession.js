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
    } catch {
      // Best-effort: ignore teardown errors so the original test failure
      // (if any) is what the customer sees.
    }
  }
}
