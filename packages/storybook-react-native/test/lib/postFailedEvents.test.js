import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock @percy/sdk-utils before importing the module under test.
// Regression guard: the SDK previously called the non-existent
// `postBuildEvent` (singular), so failure telemetry silently never fired.
vi.mock('@percy/sdk-utils', () => ({
  postBuildEvents: vi.fn().mockResolvedValue({}),
}));

const utils = await import('@percy/sdk-utils');
const { postFailedEvent } = await import('../../percy/util/postFailedEvents.js');

describe('postFailedEvent', () => {
  beforeEach(() => {
    utils.postBuildEvents.mockClear();
  });

  it('calls utils.postBuildEvents (plural) with event fields + clientInfo', async () => {
    await postFailedEvent({ message: 'boom', errorCode: 'screenshot_failed', kind: 'sdk_error' });
    expect(utils.postBuildEvents).toHaveBeenCalledOnce();
    const payload = utils.postBuildEvents.mock.calls[0][0];
    expect(payload.message).toBe('boom');
    expect(payload.errorCode).toBe('screenshot_failed');
    expect(payload.errorKind).toBe('sdk_error');
    // clientInfo is required for SDK attribution on the CLI side.
    expect(payload.clientInfo).toMatch(/@percy\/storybook-react-native\/\d/);
  });

  it('defaults errorKind to sdk_error when kind is omitted', async () => {
    await postFailedEvent({ message: 'x' });
    expect(utils.postBuildEvents.mock.calls[0][0].errorKind).toBe('sdk_error');
  });

  it('honors an explicit clientInfo override', async () => {
    await postFailedEvent({ message: 'x', clientInfo: 'custom/1.0' });
    expect(utils.postBuildEvents.mock.calls[0][0].clientInfo).toBe('custom/1.0');
  });

  it('never throws, even when postBuildEvents rejects', async () => {
    utils.postBuildEvents.mockRejectedValueOnce(new Error('cli socket down'));
    await expect(postFailedEvent({ message: 'x' })).resolves.toBeUndefined();
  });
});
