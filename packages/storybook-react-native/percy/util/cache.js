/**
 * WeakMap-keyed per-driver state holder. Eliminates cross-driver state
 * leakage that an instance-global cache would create.
 *
 * Used for navigator state (drawer-open, expanded component groups,
 * current story id) and any other ephemeral per-session metadata.
 *
 * Usage:
 *   const state = perDriver.get(driver) ?? perDriver.set(driver, initial());
 */
class PerDriverCache {
  constructor() {
    /** @type {WeakMap<object, any>} */
    this._map = new WeakMap();
  }

  get(driver) {
    return this._map.get(driver);
  }

  set(driver, value) {
    this._map.set(driver, value);
    return value;
  }

  delete(driver) {
    return this._map.delete(driver);
  }
}

export const perDriver = new PerDriverCache();
