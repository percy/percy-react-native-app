import { describe, expect, it } from 'vitest';
import { __forTesting } from '../../../percy/navigator/uiTapStrategy.js';

const { cheapImageHash, DEFAULTS } = __forTesting;

describe('uiTapStrategy DEFAULTS', () => {
  it('has a global navigation budget defined', () => {
    expect(DEFAULTS.globalNavigationBudgetMs).toBeGreaterThan(0);
  });

  it('cold-boot ceiling exceeds global budget', () => {
    expect(DEFAULTS.coldBootMaxMs).toBeGreaterThan(DEFAULTS.globalNavigationBudgetMs);
  });

  it('navigator state caching is opt-in (off by default)', () => {
    expect(DEFAULTS.cacheNavigatorState).toBe(false);
  });

  it('settle delay is non-zero (prevents capturing pre-render frame as stable)', () => {
    expect(DEFAULTS.stabilitySettleMs).toBeGreaterThan(0);
  });
});

describe('cheapImageHash', () => {
  it('produces stable hashes for identical input', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA' + 'A'.repeat(500);
    expect(cheapImageHash(png)).toBe(cheapImageHash(png));
  });

  it('produces different hashes for different input', () => {
    const a = 'iVBORw0KGgoAAAANSUhEUgAA' + 'A'.repeat(500);
    const b = 'iVBORw0KGgoAAAANSUhEUgAA' + 'B'.repeat(500);
    expect(cheapImageHash(a)).not.toBe(cheapImageHash(b));
  });

  it('does not throw on small inputs (post-100-byte stride is safe)', () => {
    expect(() => cheapImageHash('iVBORw0KGgo=')).not.toThrow();
  });
});
