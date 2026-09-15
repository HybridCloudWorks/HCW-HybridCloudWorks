/**
 * The helpers lib/cloudPricing.js gained in Phase 3 of #613, now that three
 * components share them: a provider's label from its id, and the one
 * browser-only date format every "as of" line uses.
 */
import { describe, it, expect } from 'vitest';
import { formatLocalDateTime, providerLabel } from './cloudPricing.js';

describe('providerLabel', () => {
  it('names the three providers and echoes an unknown id', () => {
    expect(providerLabel('aws')).toBe('AWS');
    expect(providerLabel('azure')).toBe('Azure');
    expect(providerLabel('gcp')).toBe('Google Cloud');
    expect(providerLabel('oracle')).toBe('oracle');
  });
});

describe('formatLocalDateTime', () => {
  it('formats a parseable timestamp and returns anything else as it came', () => {
    const formatted = formatLocalDateTime('2026-09-15T10:30:00.000Z');
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toBe('2026-09-15T10:30:00.000Z');
    expect(formatLocalDateTime('not a date')).toBe('not a date');
    expect(formatLocalDateTime(undefined)).toBe('undefined');
  });
});
