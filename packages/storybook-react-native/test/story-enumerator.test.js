import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  enumerateStories,
  extractStoriesField,
  extractTitle,
} from '../src/story-enumerator.js';

describe('extractStoriesField', () => {
  it('parses a single-quoted glob array', () => {
    expect(extractStoriesField("stories: ['./stories/**/*.stories.tsx']")).toEqual([
      './stories/**/*.stories.tsx',
    ]);
  });

  it('parses multiple globs with mixed quotes', () => {
    expect(
      extractStoriesField('stories: ["./a/*.stories.tsx", \'./b/*.stories.js\']'),
    ).toEqual(['./a/*.stories.tsx', './b/*.stories.js']);
  });

  it('handles multi-line arrays', () => {
    const src = `
      const main = {
        stories: [
          './stories/**/*.stories.?(ts|tsx|js|jsx)',
        ],
      };
    `;
    expect(extractStoriesField(src)).toEqual(['./stories/**/*.stories.?(ts|tsx|js|jsx)']);
  });

  it('returns empty array on no match', () => {
    expect(extractStoriesField('module.exports = {};')).toEqual([]);
  });

  it('ignores stories field inside a comment', () => {
    expect(extractStoriesField('// stories: ["./fake.stories.ts"]\nstories: ["./real.tsx"]')).toEqual([
      './real.tsx',
    ]);
  });
});

describe('extractTitle', () => {
  it('extracts title from inline default export', () => {
    const src = `export default { title: 'Foo/Bar', component: X };`;
    expect(extractTitle(src)).toBe('Foo/Bar');
  });

  it('extracts title from indirect const + export default', () => {
    const src = `
      const meta = { title: 'Example/Button' } satisfies Meta<typeof Button>;
      export default meta;
    `;
    expect(extractTitle(src)).toBe('Example/Button');
  });

  it('returns null when no default export points at meta', () => {
    const src = `const meta = { title: 'X' };`;
    expect(extractTitle(src)).toBeNull();
  });

  it('returns null on no title', () => {
    expect(extractTitle('export default { component: X };')).toBeNull();
  });
});

describe('enumerateStories', () => {
  /** @type {string} */
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'percy-rn-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  /**
   * Lay out a synthetic .rnstorybook + stories tree mirroring what
   * `npx storybook init --type react_native` produces.
   */
  async function setupFixture() {
    const rb = path.join(tmp, '.rnstorybook');
    const stories = path.join(rb, 'stories');
    await fs.mkdir(stories, { recursive: true });
    await fs.writeFile(
      path.join(rb, 'main.ts'),
      `
        import type { StorybookConfig } from '@storybook/react-native';
        const main: StorybookConfig = {
          stories: ['./stories/**/*.stories.?(ts|tsx|js|jsx)'],
          addons: [],
        };
        export default main;
      `,
    );
    await fs.writeFile(
      path.join(stories, 'Button.stories.tsx'),
      `
        import type { Meta, StoryObj } from '@storybook/react-native';
        const meta = {
          title: 'Example/Button',
          component: Button,
        } satisfies Meta<typeof Button>;
        export default meta;
        export const Primary: StoryObj<typeof Button> = { args: {} };
        export const Secondary: StoryObj<typeof Button> = { args: {} };
        export const Large: StoryObj<typeof Button> = { args: {} };
      `,
    );
    await fs.writeFile(
      path.join(stories, 'Header.stories.tsx'),
      `
        export default { title: 'Example/Header' };
        export const LoggedIn = { args: {} };
        export const LoggedOut = { args: {} };
      `,
    );
  }

  it('discovers all stories from a default scaffold', async () => {
    await setupFixture();
    const stories = await enumerateStories(tmp);
    const ids = stories.map((s) => s.id).sort();
    expect(ids).toEqual([
      'example-button--large',
      'example-button--primary',
      'example-button--secondary',
      'example-header--logged-in',
      'example-header--logged-out',
    ]);
  });

  it('produces human-readable names + componentTitle', async () => {
    await setupFixture();
    const stories = await enumerateStories(tmp);
    const loggedIn = stories.find((s) => s.id === 'example-header--logged-in');
    expect(loggedIn).toMatchObject({
      id: 'example-header--logged-in',
      name: 'Logged In',
      componentTitle: 'Example/Header',
    });
  });

  it('throws no_stories_found when configDir is missing', async () => {
    await expect(enumerateStories(tmp)).rejects.toThrow(/Storybook config dir not found/);
  });

  it('throws no_stories_found when glob matches no files', async () => {
    const rb = path.join(tmp, '.rnstorybook');
    await fs.mkdir(rb, { recursive: true });
    await fs.writeFile(
      path.join(rb, 'main.ts'),
      `const main = { stories: ['./stories/**/*.stories.tsx'] }; export default main;`,
    );
    await expect(enumerateStories(tmp)).rejects.toThrow(/no .stories files matched/);
  });

  it('discovers stories outside the config dir via ../ globs (default RN scaffold)', async () => {
    // `npx storybook init --type react_native` writes main.ts with
    // stories: ['../components/**/*.stories.?(ts|tsx|js|jsx)'] — the story
    // sources live *next to* .rnstorybook, not inside it.
    const rb = path.join(tmp, '.rnstorybook');
    const components = path.join(tmp, 'components');
    await fs.mkdir(rb, { recursive: true });
    await fs.mkdir(components, { recursive: true });
    await fs.writeFile(
      path.join(rb, 'main.ts'),
      `
        import type { StorybookConfig } from '@storybook/react-native';
        const main: StorybookConfig = {
          stories: ['../components/**/*.stories.?(ts|tsx|js|jsx)'],
          addons: [],
        };
        export default main;
      `,
    );
    await fs.writeFile(
      path.join(components, 'Button.stories.tsx'),
      `
        export default { title: 'Example/Button' };
        export const Primary = { args: {} };
      `,
    );
    const stories = await enumerateStories(tmp);
    expect(stories.map((s) => s.id)).toEqual(['example-button--primary']);
  });

  it('treats a leading ./ segment list equivalently after ../ consumption', async () => {
    // `../.rnstorybook/stories/**` style — ../ back into the config dir.
    const rb = path.join(tmp, '.rnstorybook');
    const stories = path.join(rb, 'stories');
    await fs.mkdir(stories, { recursive: true });
    await fs.writeFile(
      path.join(rb, 'main.ts'),
      `const main = { stories: ['../.rnstorybook/stories/**/*.stories.tsx'] }; export default main;`,
    );
    await fs.writeFile(
      path.join(stories, 'Card.stories.tsx'),
      `export default { title: 'Example/Card' };
       export const Basic = { args: {} };`,
    );
    const found = await enumerateStories(tmp);
    expect(found.map((s) => s.id)).toEqual(['example-card--basic']);
  });

  it('skips node_modules during walk', async () => {
    await setupFixture();
    // Plant a decoy story under node_modules — should NOT be picked up
    const nm = path.join(tmp, '.rnstorybook', 'stories', 'node_modules', 'lib');
    await fs.mkdir(nm, { recursive: true });
    await fs.writeFile(
      path.join(nm, 'Bogus.stories.tsx'),
      `export default { title: 'NotMine/Bogus' };
       export const Default = {};`,
    );
    const stories = await enumerateStories(tmp);
    expect(stories.find((s) => s.id.startsWith('notmine-'))).toBeUndefined();
  });

  it('falls back to the default glob when main.ts has no stories field', async () => {
    const rb = path.join(tmp, '.rnstorybook');
    const storiesDir = path.join(rb, 'stories');
    await fs.mkdir(storiesDir, { recursive: true });
    await fs.writeFile(path.join(rb, 'main.ts'), 'export default {};');
    await fs.writeFile(
      path.join(storiesDir, 'X.stories.tsx'),
      `export default { title: 'X' }; export const Y = {};`,
    );
    const stories = await enumerateStories(tmp);
    expect(stories.map((s) => s.id)).toEqual(['x--y']);
  });
});
