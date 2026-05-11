import { describe, expect, it, vi } from 'vitest';
import { runSession } from '../../percy/util/runSession.js';

describe('runSession', () => {
  it('calls deleteSession after fn resolves', async () => {
    const driver = { deleteSession: vi.fn(async () => {}) };
    await runSession(driver, async () => {});
    expect(driver.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('calls deleteSession even when fn throws', async () => {
    const driver = { deleteSession: vi.fn(async () => {}) };
    await expect(
      runSession(driver, async () => {
        throw new Error('test failure');
      }),
    ).rejects.toThrow('test failure');
    expect(driver.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('preserves the original error if deleteSession also throws', async () => {
    const driver = {
      deleteSession: vi.fn(async () => {
        throw new Error('teardown also failed');
      }),
    };
    await expect(
      runSession(driver, async () => {
        throw new Error('original test failure');
      }),
    ).rejects.toThrow('original test failure');
    expect(driver.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('returns the fn result on success', async () => {
    const driver = { deleteSession: vi.fn(async () => {}) };
    const result = await runSession(driver, async () => 42);
    expect(result).toBe(42);
  });
});
