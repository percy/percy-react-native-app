import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverStories } from '../../percy/discoverStories.js';

/**
 * Library-mode entry into the shared CLI-mode enumerator. We exercise the
 * thin wrapper end-to-end against a synthesised .rnstorybook + stories tree
 * so any regression in the wrapping (cwd default, configDir threading)
 * surfaces here rather than only via the CLI path.
 */
describe('discoverStories', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'percy-discover-'));
    mkdirSync(join(tmp, '.rnstorybook'));
    mkdirSync(join(tmp, '.rnstorybook', 'stories'));
    writeFileSync(
      join(tmp, '.rnstorybook', 'main.ts'),
      `export default { stories: ['./stories/**/*.stories.?(ts|tsx|js|jsx)'] };\n`,
    );
    writeFileSync(
      join(tmp, '.rnstorybook', 'stories', 'Button.stories.tsx'),
      `export default { title: 'UI/Button' };
       export const Primary = {};
       export const Secondary = {};\n`,
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('enumerates stories from a .rnstorybook tree when given { cwd }', async () => {
    const stories = await discoverStories({ cwd: tmp });
    expect(stories.map((s) => s.id).sort()).toEqual([
      'ui-button--primary',
      'ui-button--secondary',
    ]);
  });

  it('passes through configDir to the underlying enumerator', async () => {
    // Replicate the fixture under a different config dir name to verify
    // configDir override threads through.
    mkdirSync(join(tmp, '.storybook'));
    mkdirSync(join(tmp, '.storybook', 'stories'));
    writeFileSync(
      join(tmp, '.storybook', 'main.ts'),
      `export default { stories: ['./stories/**/*.stories.?(ts|tsx|js|jsx)'] };\n`,
    );
    writeFileSync(
      join(tmp, '.storybook', 'stories', 'Alt.stories.tsx'),
      `export default { title: 'Alt' }; export const X = {};\n`,
    );
    const stories = await discoverStories({ cwd: tmp, configDir: '.storybook' });
    expect(stories.length).toBeGreaterThan(0);
    expect(stories[0].componentTitle).toBe('Alt');
  });

  it('defaults cwd to process.cwd() when called with no args', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      const stories = await discoverStories();
      expect(stories.length).toBe(2);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
