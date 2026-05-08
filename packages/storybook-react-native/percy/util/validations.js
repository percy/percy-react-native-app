import { err } from '../../src/errors.js';

/**
 * Reject descriptors missing required fields rather than fall back to id —
 * preserves snapshot-name parity with CLI mode's enumerateStories output.
 * @param {{ id?: string, name?: string, componentTitle?: string }} d
 * @returns {asserts d is { id: string, name: string, componentTitle: string }}
 */
export function assertValidStoryDescriptor(d) {
  if (!d || typeof d !== 'object') {
    throw err(
      'invalid_descriptor',
      'Story descriptor must be an object with { id, name, componentTitle }.',
      'Pass an object from discoverStories(), or construct one explicitly.',
    );
  }
  if (!d.id || !d.name || !d.componentTitle) {
    const missing = ['id', 'name', 'componentTitle'].filter((k) => !d[k]);
    throw err(
      'invalid_descriptor',
      `Story descriptor missing required field(s): ${missing.join(', ')}.`,
      'Use discoverStories() to enumerate, or construct a complete descriptor.',
    );
  }
}

/**
 * Validate a BrowserStack app reference string. Lazy validation: just check
 * the prefix; let Appium reject if the rest is malformed.
 * @param {unknown} ref
 * @returns {string}
 */
export function assertValidAppReference(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('bs://')) {
    throw err(
      'invalid_app_reference',
      `Expected a BrowserStack app reference starting with "bs://", got: ${ref}`,
      'Pass the bs:// URL returned by provisionApp() or your own BS upload script.',
    );
  }
  return ref;
}
