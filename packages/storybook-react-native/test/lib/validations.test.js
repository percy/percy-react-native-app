import { describe, expect, it } from 'vitest';
import {
  assertValidStoryDescriptor,
  assertValidAppReference,
} from '../../percy/util/validations.js';

describe('assertValidStoryDescriptor', () => {
  it('accepts a complete descriptor', () => {
    expect(() =>
      assertValidStoryDescriptor({
        id: 'forms-button--primary',
        name: 'Primary',
        componentTitle: 'Forms/Button',
      }),
    ).not.toThrow();
  });

  it('rejects null / undefined', () => {
    expect(() => assertValidStoryDescriptor(null)).toThrow(/object/i);
    expect(() => assertValidStoryDescriptor(undefined)).toThrow(/object/i);
    // The error code is invalid_descriptor — assert via the typed error.
    try {
      assertValidStoryDescriptor(null);
    } catch (e) {
      expect(e.code).toBe('invalid_descriptor');
    }
  });

  it('rejects missing id', () => {
    expect(() =>
      assertValidStoryDescriptor({ name: 'Primary', componentTitle: 'Forms/Button' }),
    ).toThrow(/missing required field/i);
  });

  it('rejects missing name', () => {
    expect(() =>
      assertValidStoryDescriptor({ id: 'x', componentTitle: 'Forms/Button' }),
    ).toThrow(/missing required field/i);
  });

  it('rejects missing componentTitle (prevents snapshot-name divergence from CLI)', () => {
    expect(() =>
      assertValidStoryDescriptor({ id: 'x', name: 'Primary' }),
    ).toThrow(/missing required field/i);
  });
});

describe('assertValidAppReference', () => {
  it('accepts bs:// references', () => {
    expect(assertValidAppReference('bs://abc123')).toBe('bs://abc123');
  });

  it('rejects http:// or local paths', () => {
    expect(() => assertValidAppReference('https://example.com/app.apk')).toThrow();
    expect(() => assertValidAppReference('/local/path/to/app.apk')).toThrow();
  });

  it('rejects non-string input', () => {
    expect(() => assertValidAppReference(undefined)).toThrow();
    expect(() => assertValidAppReference(null)).toThrow();
    expect(() => assertValidAppReference(123)).toThrow();
  });
});
