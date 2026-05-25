import { describe, expect, it } from 'vitest';

describe('top-level index.js', () => {
  it('exports a default function (the primary entry)', async () => {
    const mod = await import('../../index.js');
    expect(typeof mod.default).toBe('function');
  });

  it('exports the named helpers', async () => {
    const mod = await import('../../index.js');
    expect(typeof mod.percyStorybookSnapshot).toBe('function');
    expect(typeof mod.discoverStories).toBe('function');
    expect(typeof mod.provisionApp).toBe('function');
    expect(typeof mod.useAppReference).toBe('function');
    expect(typeof mod.runSession).toBe('function');
  });

  it('default export is the same as percyStorybookSnapshot named export', async () => {
    const mod = await import('../../index.js');
    expect(mod.default).toBe(mod.percyStorybookSnapshot);
  });

  it('CLI mode entry (./cli) still resolvable for backwards compat', async () => {
    const cli = await import('../../src/index.js');
    // existing CLI exports should still be reachable
    expect(typeof cli.run).toBe('function');
    expect(typeof cli.applyFilters).toBe('function');
  });
});
