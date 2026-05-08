import { enumerateStories } from '../src/story-enumerator.js';

/**
 * Library-mode story discovery — thin wrapper around CLI mode's
 * `enumerateStories`. Same canonical CSF ID format ({titleId}--{kebab(name)})
 * so library mode and CLI mode produce identical baselines.
 *
 * @param {{ cwd?: string, configDir?: string }} [opts]
 * @returns {Promise<Array<{ id: string, name: string, componentTitle: string }>>}
 */
export async function discoverStories(opts = {}) {
  return enumerateStories(opts.cwd ?? process.cwd(), opts.configDir);
}
