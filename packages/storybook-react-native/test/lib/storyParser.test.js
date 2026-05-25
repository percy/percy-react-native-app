import { describe, expect, it } from 'vitest';
import { parseStoriesAst } from '../../percy/util/storyParser.js';

describe('parseStoriesAst — AST-based CSF parsing (item 2.1)', () => {
  it('parses a standard CSF v3 file', () => {
    const src = `
      export default { title: 'Forms/Button', component: () => null };
      export const Primary = { args: { variant: 'primary' } };
      export const Secondary = { args: { variant: 'secondary' } };
    `;
    const result = parseStoriesAst(src);
    expect(result).toEqual([
      { id: 'forms-button--primary', name: 'Primary', componentTitle: 'Forms/Button' },
      { id: 'forms-button--secondary', name: 'Secondary', componentTitle: 'Forms/Button' },
    ]);
  });

  it('parses indirect meta via const + satisfies (Storybook v8+ TS pattern)', () => {
    const src = `
      import type { Meta, StoryObj } from '@storybook/react';
      const meta = { title: 'Cards/Hero', component: Hero } satisfies Meta<typeof Hero>;
      export default meta;
      export const Default: StoryObj<typeof Hero> = {};
      export const WithImage: StoryObj<typeof Hero> = { args: { image: '/a.png' } };
    `;
    const result = parseStoriesAst(src);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'cards-hero--default', name: 'Default', componentTitle: 'Cards/Hero' });
    expect(result[1]).toEqual({ id: 'cards-hero--with-image', name: 'With Image', componentTitle: 'Cards/Hero' });
  });

  it('resolves title via spread operator from a parent const (regex misses this)', () => {
    const src = `
      const baseMeta = { title: 'Layout/Header', tags: ['autodocs'] };
      export default { ...baseMeta, component: Header };
      export const LoggedIn = {};
      export const LoggedOut = {};
    `;
    const result = parseStoriesAst(src);
    expect(result).toHaveLength(2);
    expect(result[0].componentTitle).toBe('Layout/Header');
    expect(result[1].id).toBe('layout-header--logged-out');
  });

  it('resolves title from identifier reference (regex misses this)', () => {
    const src = `
      const TITLE = 'Forms/Input';
      export default { title: TITLE, component: Input };
      export const Default = {};
    `;
    const result = parseStoriesAst(src);
    expect(result).toEqual([
      { id: 'forms-input--default', name: 'Default', componentTitle: 'Forms/Input' },
    ]);
  });

  it('handles TS `as Meta<…>` annotation', () => {
    const src = `
      export default { title: 'TS/Coerce', component: Foo } as Meta<typeof Foo>;
      export const A = {};
    `;
    const result = parseStoriesAst(src);
    expect(result).toEqual([
      { id: 'ts-coerce--a', name: 'A', componentTitle: 'TS/Coerce' },
    ]);
  });

  it('skips story exports starting with __ (Storybook internal convention)', () => {
    const src = `
      export default { title: 'Foo/Bar' };
      export const Visible = {};
      export const __Internal = {};
    `;
    const result = parseStoriesAst(src);
    expect(result.map((r) => r.name)).toEqual(['Visible']);
  });

  it('returns empty array when no default export with title is found', () => {
    const src = `
      export const Foo = {};
    `;
    expect(parseStoriesAst(src)).toEqual([]);
  });

  it('returns empty array when default export has no title field', () => {
    const src = `
      export default { component: Foo };
      export const A = {};
    `;
    expect(parseStoriesAst(src)).toEqual([]);
  });

  it('matches the regex parser on a realistic Storybook RN fixture story', () => {
    // This mirrors the shape of examples/RNStorybookFixture/stories/Button.stories.tsx
    const src = `
      import { Button } from './Button';
      const meta = {
        title: 'Example/Button',
        component: Button,
        argTypes: { onPress: { action: 'pressed the button' } },
        args: { text: 'Hello world' },
      };
      export default meta;
      export const Primary = { args: { color: 'purple', text: 'Hello world' } };
      export const Secondary = { args: { color: 'orange', text: 'Secondary' } };
      export const Large = { args: { size: 'large', text: 'Large' } };
      export const Small = { args: { size: 'small', text: 'Small' } };
    `;
    const result = parseStoriesAst(src);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.id)).toEqual([
      'example-button--primary',
      'example-button--secondary',
      'example-button--large',
      'example-button--small',
    ]);
    expect(new Set(result.map((r) => r.componentTitle))).toEqual(new Set(['Example/Button']));
  });

  it('survives malformed source via errorRecovery: true (returns empty)', () => {
    const src = `
      export default { title: 'Foo
      const broken;
    `;
    // Should not throw — parser is configured with errorRecovery.
    expect(() => parseStoriesAst(src)).not.toThrow();
  });

  it('filters CSF v3 reserved top-level metadata exports out of the story list', () => {
    // decorators / parameters / argTypes / args / tags / loaders / play /
    // beforeEach / globals / render / component are valid CSF v3 exports that
    // ARE NOT stories — the parser must not emit them as snapshot leaves.
    const src = `
      export default { title: 'Reserved/Exports' };
      export const decorators = [];
      export const parameters = { layout: 'centered' };
      export const argTypes = {};
      export const args = {};
      export const tags = ['autodocs'];
      export const loaders = [];
      export const play = async () => {};
      export const beforeEach = async () => {};
      export const globals = {};
      export const render = () => null;
      export const component = () => null;
      export const ActualStory = {};
    `;
    const result = parseStoriesAst(src);
    expect(result.map((r) => r.name)).toEqual(['Actual Story']);
  });

  it('does not stack-overflow on mutually-recursive const spreads', () => {
    // `...a` references `b`, `...b` references `a`. Without the visited Set
    // + depth guard the resolver would loop forever; with it, we either find
    // the title via one of the cycles or return [] cleanly.
    const src = `
      const a = { ...b, title: 'Cycle/Title' };
      const b = { ...a };
      export default { ...b, component: Foo };
      export const Default = {};
    `;
    expect(() => parseStoriesAst(src)).not.toThrow();
  });

  it('cleanly returns [] when title cannot be resolved through deep spreads', () => {
    // Spread chain with no title anywhere — must not throw and must yield [].
    const src = `
      const inner = { tags: ['a'] };
      const outer = { ...inner };
      export default { ...outer, component: Foo };
      export const A = {};
    `;
    expect(parseStoriesAst(src)).toEqual([]);
  });
});
