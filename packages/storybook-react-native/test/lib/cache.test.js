import { describe, expect, it } from 'vitest';
import { perDriver } from '../../percy/util/cache.js';

describe('perDriver — PerDriverCache', () => {
  it('returns undefined for a driver that has not been set', () => {
    const driver = {};
    expect(perDriver.get(driver)).toBeUndefined();
  });

  it('stores and retrieves a value keyed by driver identity', () => {
    const driver = {};
    perDriver.set(driver, { drawerOpen: true, currentStoryId: 's--1' });
    expect(perDriver.get(driver)).toEqual({ drawerOpen: true, currentStoryId: 's--1' });
  });

  it('returns the value from set() to enable the get-or-set pattern', () => {
    const driver = {};
    const initial = { count: 1 };
    const returned = perDriver.set(driver, initial);
    expect(returned).toBe(initial);
  });

  it('does not leak state across different driver instances', () => {
    const driverA = {};
    const driverB = {};
    perDriver.set(driverA, 'A');
    perDriver.set(driverB, 'B');
    expect(perDriver.get(driverA)).toBe('A');
    expect(perDriver.get(driverB)).toBe('B');
  });

  it('deletes entries by driver identity', () => {
    const driver = {};
    perDriver.set(driver, 'value');
    expect(perDriver.delete(driver)).toBe(true);
    expect(perDriver.get(driver)).toBeUndefined();
    // Second delete returns false (entry already gone).
    expect(perDriver.delete(driver)).toBe(false);
  });
});
