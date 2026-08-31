import { describe, expect, it } from 'vitest';
import {
  assertKnownShape,
  evaluate,
  formatReport,
  parseReferenceStatuses,
  unresolvedFrom,
} from './check-unresolved-secrets.mjs';

const shapeA = (entries) => ({ properties: { keyToReferenceStatuses: entries } });
const shapeB = (rows) => ({ value: rows });

describe('parseReferenceStatuses', () => {
  it('reads the keyToReferenceStatuses map', () => {
    const got = parseReferenceStatuses(
      shapeA({
        'ANTHROPIC-API-KEY': { status: 'Resolved' },
        'REPLICATE-API-KEY': { status: 'SecretNotFound', details: 'secret not found' },
      }),
    );
    expect(got).toEqual([
      { name: 'ANTHROPIC-API-KEY', status: 'Resolved', details: '' },
      { name: 'REPLICATE-API-KEY', status: 'SecretNotFound', details: 'secret not found' },
    ]);
  });

  it('reads the value[] array', () => {
    const got = parseReferenceStatuses(
      shapeB([{ name: 'PREVIEW_SIGNING_SECRET', properties: { status: 'Resolved' } }]),
    );
    expect(got).toEqual([{ name: 'PREVIEW_SIGNING_SECRET', status: 'Resolved', details: '' }]);
  });

  it('returns null for a shape it does not recognise', () => {
    expect(parseReferenceStatuses({ somethingElse: true })).toBeNull();
  });

  it('names a missing status rather than treating it as healthy', () => {
    const [row] = parseReferenceStatuses(shapeA({ 'A-KEY': {} }));
    expect(row.status).toBe('(no status reported)');
    expect(unresolvedFrom([row])).toHaveLength(1);
  });
});

describe('assertKnownShape', () => {
  it('throws on an unrecognised payload instead of reporting health', () => {
    const raw = { unexpected: 1, alsoUnexpected: 2 };
    expect(() => assertKnownShape(parseReferenceStatuses(raw), raw)).toThrow(
      /neither known Key Vault reference shape/,
    );
  });

  it('says explicitly that this is not a clean bill of health', () => {
    expect(() => assertKnownShape(null, {})).toThrow(/NOT "every reference is healthy"/);
  });

  it('passes a recognised payload straight through', () => {
    const statuses = [{ name: 'A', status: 'Resolved', details: '' }];
    expect(assertKnownShape(statuses, {})).toBe(statuses);
  });
});

describe('unresolvedFrom', () => {
  it('treats Resolved as healthy regardless of case', () => {
    const statuses = [
      { name: 'A', status: 'Resolved', details: '' },
      { name: 'B', status: 'resolved', details: '' },
      { name: 'C', status: 'RESOLVED', details: '' },
    ];
    expect(unresolvedFrom(statuses)).toHaveLength(0);
  });

  it('flags every other status', () => {
    const statuses = [
      { name: 'A', status: 'Resolved', details: '' },
      { name: 'B', status: 'SecretNotFound', details: '' },
      { name: 'C', status: 'AccessToKeyVaultDenied', details: '' },
      { name: 'D', status: 'VaultNotFound', details: '' },
    ];
    expect(unresolvedFrom(statuses).map((s) => s.name)).toEqual(['B', 'C', 'D']);
  });
});

describe('formatReport', () => {
  it('prints names and statuses', () => {
    const out = formatReport([
      { name: 'REPLICATE-API-KEY', status: 'SecretNotFound', details: 'not found' },
    ]);
    expect(out).toContain('REPLICATE-API-KEY');
    expect(out).toContain('SecretNotFound');
  });

  // The standing rule: a missing credential is recorded by name, owner and
  // location — never by value. A vault URI carries the vault name, the secret
  // name and the version, and this output goes into a public CI log.
  it('never prints a vault URI even when the payload carries one', () => {
    const raw = shapeA({
      'A-KEY': {
        status: 'SecretNotFound',
        details: 'not found',
        vaultName: 'kv-site-prod-cus-01',
        secretName: 'A-KEY',
        reference: '@Microsoft.KeyVault(SecretUri=https://kv-site-prod-cus-01.vault.azure.net/secrets/A-KEY/abc123)',
      },
    });
    const out = formatReport(evaluate(raw).unresolved);
    expect(out).not.toContain('vault.azure.net');
    expect(out).not.toContain('SecretUri');
    expect(out).not.toContain('abc123');
  });
});

describe('evaluate', () => {
  it('reports a healthy estate as zero unresolved', () => {
    const got = evaluate(shapeA({ A: { status: 'Resolved' }, B: { status: 'Resolved' } }));
    expect(got).toEqual({ checked: 2, unresolved: [] });
  });

  it('counts what it checked alongside what failed', () => {
    const got = evaluate(
      shapeA({ A: { status: 'Resolved' }, B: { status: 'SecretNotFound' } }),
    );
    expect(got.checked).toBe(2);
    expect(got.unresolved.map((s) => s.name)).toEqual(['B']);
  });

  // An app with no Key Vault references at all is a real state — and it is not
  // an error. It is only alarming if you expected some, which is a different
  // check than this one.
  it('accepts an empty but well-formed collection', () => {
    expect(evaluate(shapeA({}))).toEqual({ checked: 0, unresolved: [] });
  });

  it('throws rather than returning zero for an unrecognised payload', () => {
    expect(() => evaluate({ nope: true })).toThrow(/nothing about the references is known/);
  });
});
