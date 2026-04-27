import { describe, expect, it } from 'vitest';
import { applyFilters, globMatch } from '../src/runner.js';

const stories = [
  { id: 'Button/Primary', name: 'Primary', componentTitle: 'Button' },
  { id: 'Button/Disabled', name: 'Disabled', componentTitle: 'Button' },
  { id: 'Card/Default', name: 'Default', componentTitle: 'Card' },
  { id: 'Card/WithImage', name: 'WithImage', componentTitle: 'Card' },
];

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
