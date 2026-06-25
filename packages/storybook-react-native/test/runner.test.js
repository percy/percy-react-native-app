import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mock the runner's collaborators so run() can be tested in isolation. ---
const mockAppium = {
  connect: vi.fn().mockResolvedValue(undefined),
  getDeviceLabel: vi.fn().mockReturnValue('iOS-iPhone 15'),
  getDeviceMetadata: vi.fn().mockResolvedValue({
    osName: 'iOS', osVersion: '18.4', deviceName: 'iPhone 15', orientation: 'portrait',
  }),
  takeScreenshot: vi.fn().mockResolvedValue('BASE64PNG'),
  disconnect: vi.fn().mockResolvedValue(undefined),
};
const mockChannel = {
  baseUrl: vi.fn().mockReturnValue('http://localhost:7007'),
  probe: vi.fn().mockResolvedValue(undefined),
  selectAndAwaitRender: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/appium-client.js', () => ({
  AppiumClient: vi.fn(() => mockAppium),
}));
vi.mock('../src/storybook-channel.js', () => ({
  StorybookChannelClient: vi.fn(() => mockChannel),
}));
vi.mock('../src/comparison-poster.js', () => ({
  postSnapshotComparison: vi.fn().mockResolvedValue(undefined),
}));

const { run, applyFilters, globMatch } = await import('../src/runner.js');
const { postSnapshotComparison } = await import('../src/comparison-poster.js');

function makeConfig(overrides = {}) {
  return {
    appium: { server: 'http://localhost:4723', capabilities: {} },
    storybook: { websocketHost: 'localhost', websocketPort: 7007, waitForReadyMs: 10, settleMs: 0 },
    include: ['**/*'],
    skip: [],
    ...overrides,
  };
}

const twoStories = [
  { id: 'example-button--primary', name: 'Primary', componentTitle: 'Example/Button' },
  { id: 'example-card--default', name: 'Default', componentTitle: 'Example/Card' },
];

describe('run', () => {
  beforeEach(() => {
    for (const fn of Object.values(mockAppium)) fn.mockClear();
    for (const fn of Object.values(mockChannel)) fn.mockClear();
    postSnapshotComparison.mockClear();
    mockChannel.selectAndAwaitRender.mockResolvedValue(undefined);
    mockAppium.takeScreenshot.mockResolvedValue('BASE64PNG');
  });

  it('selects, screenshots and posts each story, then disconnects', async () => {
    await run({ config: makeConfig(), stories: twoStories });

    expect(mockAppium.connect).toHaveBeenCalledOnce();
    expect(mockChannel.probe).toHaveBeenCalledOnce();
    expect(mockChannel.selectAndAwaitRender).toHaveBeenCalledTimes(2);
    expect(postSnapshotComparison).toHaveBeenCalledTimes(2);
    expect(mockAppium.disconnect).toHaveBeenCalledOnce();

    const firstPayload = postSnapshotComparison.mock.calls[0][0];
    expect(firstPayload.name).toBe('Example/Button/Primary/iOS-iPhone 15');
    expect(firstPayload.device.osName).toBe('iOS');
    expect(firstPayload.screenshotBase64).toBe('BASE64PNG');
  });

  it('throws no_stories_found when given no stories (without connecting)', async () => {
    await expect(run({ config: makeConfig(), stories: [] }))
      .rejects.toMatchObject({ code: 'no_stories_found' });
    expect(mockAppium.connect).not.toHaveBeenCalled();
  });

  it('throws include_zero_match when filters exclude everything', async () => {
    await expect(run({ config: makeConfig({ include: ['Nope/*'] }), stories: twoStories }))
      .rejects.toMatchObject({ code: 'include_zero_match' });
  });

  it('marks a story failed and continues when its render is not confirmed (no stale upload)', async () => {
    // First story's render never confirms; second renders fine.
    mockChannel.selectAndAwaitRender.mockRejectedValueOnce(
      Object.assign(new Error('render timed out'), { code: 'story_render_timeout' }),
    );

    // The run still surfaces a non-zero result (incomplete), but as a summary
    // error — not by aborting on the first failure.
    await expect(run({ config: makeConfig(), stories: twoStories }))
      .rejects.toMatchObject({ code: 'stories_failed_to_render' });

    // The failed story is skipped entirely; only the second (good) story is
    // captured and uploaded — exactly one upload, never a stale frame.
    expect(mockAppium.takeScreenshot).toHaveBeenCalledTimes(1);
    expect(postSnapshotComparison).toHaveBeenCalledTimes(1);
    expect(postSnapshotComparison.mock.calls[0][0].name).toBe('Example/Card/Default/iOS-iPhone 15');

    // Session is still torn down.
    expect(mockAppium.disconnect).toHaveBeenCalledOnce();
  });

  it('completes normally (no throw) when every story renders', async () => {
    await run({ config: makeConfig(), stories: twoStories });
    expect(postSnapshotComparison).toHaveBeenCalledTimes(2);
  });

  it('always disconnects even if screenshot capture throws', async () => {
    mockAppium.takeScreenshot.mockRejectedValueOnce(new Error('boom'));
    await expect(run({ config: makeConfig(), stories: twoStories })).rejects.toThrow(/boom/);
    expect(mockAppium.disconnect).toHaveBeenCalledOnce();
  });
});

describe('globMatch', () => {
  it('matches everything for `**/*` and `**`', () => {
    expect(globMatch('**/*', 'Button/Primary')).toBe(true);
    expect(globMatch('**', 'Card/Default')).toBe(true);
  });

  it('matches single-segment glob', () => {
    expect(globMatch('Button/*', 'Button/Primary')).toBe(true);
    expect(globMatch('Button/*', 'Card/Default')).toBe(false);
  });

  it('does not cross segment boundary on single `*`', () => {
    expect(globMatch('Button/*', 'Button/Sub/Variant')).toBe(false);
  });

  it('crosses segments on `**`', () => {
    expect(globMatch('Button/**', 'Button/Sub/Variant')).toBe(true);
  });

  it('matches exact strings', () => {
    expect(globMatch('Button/Primary', 'Button/Primary')).toBe(true);
    expect(globMatch('Button/Primary', 'Button/Disabled')).toBe(false);
  });
});

describe('applyFilters', () => {
  const stories = [
    { id: 'Button/Primary', name: 'Primary', componentTitle: 'Button' },
    { id: 'Button/Disabled', name: 'Disabled', componentTitle: 'Button' },
    { id: 'Card/Default', name: 'Default', componentTitle: 'Card' },
    { id: 'Card/WithImage', name: 'WithImage', componentTitle: 'Card' },
  ];

  it('returns all stories when include is `**/*`', () => {
    expect(applyFilters(stories, ['**/*'], [])).toHaveLength(4);
  });

  it('filters by include pattern', () => {
    const result = applyFilters(stories, ['Button/*'], []);
    expect(result.map((s) => s.id)).toEqual(['Button/Primary', 'Button/Disabled']);
  });

  it('skip overrides include', () => {
    const result = applyFilters(stories, ['**/*'], ['Button/Disabled']);
    expect(result.map((s) => s.id)).toEqual(['Button/Primary', 'Card/Default', 'Card/WithImage']);
  });

  it('returns empty when include matches nothing', () => {
    expect(applyFilters(stories, ['Nonexistent/*'], [])).toEqual([]);
  });

  it('combines include and skip', () => {
    const result = applyFilters(stories, ['Card/*'], ['Card/WithImage']);
    expect(result.map((s) => s.id)).toEqual(['Card/Default']);
  });
});
