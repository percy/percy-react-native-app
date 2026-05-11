/**
 * TimeIt — small helper used to wrap async ops with duration measurement.
 * Mirrors @percy/percy-appium-js's util/timing.js shape.
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
