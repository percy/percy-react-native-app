/**
 * TimeIt — small helper used to wrap async ops with duration measurement.
 *
 * Intentionally simpler than @percy/percy-appium-js's util/timing.js: this is a
 * single-arg `run(fn)` that returns `{ result, durationMs }`. It does NOT carry
 * the reference's named-store aggregation (min/max/avg) or `PERCY_METRICS`
 * gating — the SDK only needs per-call duration for snapshot timing.
 *
 * Usage:
 *   const { result, durationMs } = await TimeIt.run(async () => doWork());
 */
export class TimeIt {
  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<{ result: T, durationMs: number }>}
   */
  static async run(fn) {
    const start = Date.now();
    const result = await fn();
    return { result, durationMs: Date.now() - start };
  }
}
