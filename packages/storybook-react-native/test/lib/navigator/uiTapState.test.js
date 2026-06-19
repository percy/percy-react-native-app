import { describe, expect, it } from 'vitest';
import { __forTesting } from '../../../percy/navigator/uiTapStrategy.js';

const { getState, resetState } = __forTesting;

describe('uiTapStrategy per-driver state', () => {
  it('initializes warmedUp to false', () => {
    const driver = {};
    expect(getState(driver).warmedUp).toBe(false);
  });

  it('resetState preserves session-level flags but clears navigation position', () => {
    const driver = {};
    const s = getState(driver);
    // Simulate a warmed, mid-navigation, twice-diverged session.
    s.warmedUp = true;
    s.drawerOpen = true;
    s.expandedComponents.add('Forms/Button');
    s.currentStoryId = 'forms-button--primary';
    s.consecutiveDivergences = 2;
    s.cacheDisabledForSession = true;

    resetState(driver);
    const after = getState(driver);

    // Same object — reset must NOT delete the entry (that wiped warmedUp +
    // the divergence counter, so cold-boot re-ran and cache never disabled).
    expect(after).toBe(s);
    // Session-level state preserved:
    expect(after.warmedUp).toBe(true);
    expect(after.consecutiveDivergences).toBe(2);
    expect(after.cacheDisabledForSession).toBe(true);
    // Navigation position cleared:
    expect(after.drawerOpen).toBe(false);
    expect(after.expandedComponents.size).toBe(0);
    expect(after.currentStoryId).toBe(null);
  });

  it('resetState on an unknown driver is a no-op (no throw)', () => {
    expect(() => resetState({})).not.toThrow();
  });
});
