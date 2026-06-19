import { describe, expect, it } from 'vitest';
import { __forTesting } from '../../percy/provisionApp.js';

const { scrubSecrets } = __forTesting;

describe('scrubSecrets', () => {
  it('redacts a 20+ char alphanumeric token via the heuristic', () => {
    // Built at runtime so no secret-shaped literal lives in source.
    const token = 'A'.repeat(13) + '1'.repeat(12); // 25 alphanumeric chars
    const out = scrubSecrets(`key=${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain('[redacted]');
  });

  it('redacts an exact known secret even when it contains a hyphen', () => {
    // Hyphenated key the alphanumeric heuristic alone would miss.
    const secret = 'abc-def-ghi';
    const out = scrubSecrets(`{"error":"bad key ${secret}"}`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('does not redact trivially short "secrets"', () => {
    const out = scrubSecrets('hello world', ['a']);
    expect(out).toBe('hello world');
  });

  it('truncates to 200 chars', () => {
    // '. ' has no 20+ alphanumeric run, so it survives to the slice.
    expect(scrubSecrets('. '.repeat(300)).length).toBe(200);
  });
});
