import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock @percy/sdk-utils before importing the module under test.
vi.mock('@percy/sdk-utils', () => ({
  isPercyEnabled: vi.fn().mockResolvedValue(true),
  postComparison: vi.fn().mockResolvedValue({}),
}));

const utils = await import('@percy/sdk-utils');
const { postSnapshotComparison } = await import('../src/comparison-poster.js');

/** Build a minimal valid PNG buffer with given dimensions encoded in IHDR. */
function makePng(width, height) {
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdr = Buffer.from('IHDR');
  const w = Buffer.alloc(4);
  w.writeUInt32BE(width, 0);
  const h = Buffer.alloc(4);
  h.writeUInt32BE(height, 0);
  const rest = Buffer.alloc(5); // bit depth, color type, etc. — values don't matter for our reader
  return Buffer.concat([sig, ihdrLen, ihdr, w, h, rest]);
}

describe('postSnapshotComparison', () => {
  beforeEach(() => {
    utils.postComparison.mockClear();
  });

  it('extracts width/height from PNG and places them on tag', async () => {
    const png = makePng(390, 844);
    await postSnapshotComparison({
      name: 'Button/Primary/iOS-iPhone-15',
      tag: 'iOS-iPhone-15',
      screenshotBase64: png.toString('base64'),
    });
    expect(utils.postComparison).toHaveBeenCalledOnce();
    const payload = utils.postComparison.mock.calls[0][0];
    expect(payload.name).toBe('Button/Primary/iOS-iPhone-15');
    expect(payload.tag).toEqual({
      name: 'iOS-iPhone-15',
      osName: 'iOS',
      width: 390,
      height: 844,
    });
    expect(payload.tiles).toHaveLength(1);
    expect(payload.tiles[0].content).toBe(png.toString('base64'));
    expect(payload.tiles[0].fullscreen).toBe(false);
  });

  it('throws when buffer is not a PNG', async () => {
    const notPng = Buffer.from('not a png at all just text padding to be long enough', 'utf8');
    await expect(
      postSnapshotComparison({
        name: 'X',
        tag: 'iOS',
        screenshotBase64: notPng.toString('base64'),
      }),
    ).rejects.toThrow(/not a PNG/);
  });

  it('throws when buffer is too small', async () => {
    await expect(
      postSnapshotComparison({
        name: 'X',
        tag: 'iOS',
        screenshotBase64: Buffer.from('tiny').toString('base64'),
      }),
    ).rejects.toThrow(/too small/);
  });

  it('throws percy_cli_unreachable when Percy is not enabled', async () => {
    utils.isPercyEnabled.mockResolvedValueOnce(false);
    const png = makePng(100, 100);
    await expect(
      postSnapshotComparison({
        name: 'X',
        tag: 'iOS',
        screenshotBase64: png.toString('base64'),
      }),
    ).rejects.toThrow(/Percy CLI is not running/);
  });
});
