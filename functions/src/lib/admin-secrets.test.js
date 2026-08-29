import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_SECRET_LENGTH,
  computeSecretState,
  createAdminSecretHandlers,
  processStartedAt,
  recordSecretVerdict,
  rejectSecretValue,
} from './admin-secrets.js';

const STARTED = Date.parse('2026-08-29T10:00:00.000Z');
const before = (iso) => iso; // readability at call sites

const entry = { setting: 'GEMINI_API_KEY', secret: 'GEMINI-API-KEY' };

function buildStore(initial = {}) {
  let doc = Object.keys(initial).length ? { id: 'secret_state', secrets: initial } : null;
  return {
    readDoc: vi.fn(async () => doc),
    upsertDoc: vi.fn(async (_c, next) => {
      doc = next;
    }),
    current: () => doc,
  };
}

function buildDeps(overrides = {}) {
  const store = overrides.store ?? buildStore();
  return {
    guard: { requireRole: vi.fn(async () => ({ user: { oid: 'admin-1' }, role: 'super_admin', error: null })) },
    store,
    env: { GEMINI_API_KEY: 'live-gemini-value' },
    now: () => '2026-08-29T12:00:00.000Z',
    startedAt: STARTED,
    vault: {
      setVaultSecret: vi.fn(async () => ({ version: 'v2' })),
      refreshKeyVaultReferences: vi.fn(async () => ({ refreshed: true, reason: null })),
    },
    randomSecret: () => 'generated-value-that-is-long-enough',
    log: { error: vi.fn(), warn: vi.fn() },
    ...overrides,
    _store: store,
  };
}

const request = (body) => ({ json: async () => body });

// ---------------------------------------------------------------------------

describe('the value never comes back', () => {
  it('does not appear anywhere in the status response, for any secret', async () => {
    // THE test for this feature. Not "no field called value" — a scan of the
    // whole serialised body, so a field added later that happens to carry the
    // credential fails here rather than in production.
    const secretValues = {
      GEMINI_API_KEY: 'gem-SUPERSECRET-1111111111',
      ANTHROPIC_API_KEY: 'ant-SUPERSECRET-2222222222',
      TELEGRAM_BOT_TOKEN: 'tg-SUPERSECRET-3333333333',
      CLIENT_IP_SALT: 'salt-SUPERSECRET-444444444',
    };
    const deps = buildDeps({ env: secretValues });
    const response = await createAdminSecretHandlers(deps).getSecretStatus(request({}));

    const serialised = JSON.stringify(response.jsonBody);
    for (const value of Object.values(secretValues)) {
      expect(serialised).not.toContain(value);
    }
    expect(serialised).not.toContain('SUPERSECRET');
  });

  it('does not echo the value in the write response', async () => {
    const deps = buildDeps();
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'gem-BRANDNEW-9999999999' })
    );
    expect(JSON.stringify(response.jsonBody)).not.toContain('BRANDNEW');
  });

  it('does not put the value in the Cosmos state document', async () => {
    // The state doc is read by anything with Cosmos access. It records WHEN and
    // WHO, never WHAT.
    const deps = buildDeps();
    await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'gem-BRANDNEW-9999999999' })
    );
    expect(JSON.stringify(deps._store.current())).not.toContain('BRANDNEW');
  });

  it('does not name the value in an error when Key Vault refuses the write', async () => {
    const deps = buildDeps({
      vault: {
        setVaultSecret: vi.fn(async () => {
          throw new Error('Key Vault refused to set GEMINI-API-KEY: HTTP 403');
        }),
        refreshKeyVaultReferences: vi.fn(),
      },
    });
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'gem-BRANDNEW-9999999999' })
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.jsonBody)).not.toContain('BRANDNEW');
    expect(String(deps.log.error.mock.calls)).not.toContain('BRANDNEW');
  });
});

describe('the response carries exactly these fields', () => {
  it('never more than the page needs, whatever the state record grows', async () => {
    // Defence in depth for the no-readback promise: if a future writer records
    // something sensitive per-secret, a spread of the record would carry it
    // into the response. Naming the fields is the guard; this is what holds it.
    const store = buildStore({
      'GEMINI-API-KEY': { lastWriteAt: '2026-08-29T09:00:00.000Z', someFutureField: 'LEAKED' },
    });
    const response = await createAdminSecretHandlers(buildDeps({ store })).getSecretStatus(
      request({})
    );
    const gemini = response.jsonBody.secrets.find((s) => s.secret === 'GEMINI-API-KEY');
    expect(Object.keys(gemini).sort()).toEqual([
      'generatable',
      'hasLivenessCheck',
      'help',
      'label',
      'lastFailAt',
      'lastFailStatus',
      'lastOkAt',
      'lastWriteAt',
      'lastWriteBy',
      'secret',
      'section',
      'setting',
      'state',
    ]);
    expect(JSON.stringify(response.jsonBody)).not.toContain('LEAKED');
  });
});

describe('who may use it', () => {
  it('refuses anyone below super_admin on read', async () => {
    const error = { status: 403, jsonBody: { error: 'forbidden' } };
    const deps = buildDeps({ guard: { requireRole: vi.fn(async () => ({ error })) } });
    expect(await createAdminSecretHandlers(deps).getSecretStatus(request({}))).toBe(error);
  });

  it('refuses anyone below super_admin on write, before touching the vault', async () => {
    const error = { status: 403, jsonBody: { error: 'forbidden' } };
    const deps = buildDeps({ guard: { requireRole: vi.fn(async () => ({ error })) } });
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'a-perfectly-good-value' })
    );
    expect(response).toBe(error);
    expect(deps.vault.setVaultSecret).not.toHaveBeenCalled();
  });

  it('asks for super_admin specifically, not merely some role', async () => {
    const deps = buildDeps();
    await createAdminSecretHandlers(deps).getSecretStatus(request({}));
    expect(deps.guard.requireRole).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});

describe('the four lights', () => {
  const at = (iso) => Date.parse(iso);

  it('is gray when the reference never resolved', () => {
    const env = { GEMINI_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/secrets/GEMINI-API-KEY)' };
    expect(computeSecretState(entry, { env, startedAt: STARTED })).toBe('never');
  });

  it('is gray when the setting is absent entirely', () => {
    expect(computeSecretState(entry, { env: {}, startedAt: STARTED })).toBe('never');
  });

  it('is green when it resolved and nothing reported it broken', () => {
    expect(computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, startedAt: STARTED })).toBe(
      'live'
    );
  });

  it('is amber when the write landed after this worker started', () => {
    const record = { lastWriteAt: '2026-08-29T10:30:00.000Z' };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('pending');
  });

  it('is amber for a ROTATION over a live key, not green', () => {
    // The dangerous case: env still holds the OLD credential, which is a real
    // string. Reporting green would show the previous key's health as the new
    // one's, and the operator would believe a rotation had taken effect.
    const record = { lastWriteAt: '2026-08-29T10:30:00.000Z', lastOkAt: before('2026-08-29T09:00:00.000Z') };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'the-old-key' }, record, startedAt: STARTED })
    ).toBe('pending');
  });

  it('is amber for a FIRST seed, where the reference has not resolved yet', () => {
    // The case a fresh paste actually hits: env still holds the literal
    // reference. Reading env before the write timestamp would call this gray —
    // "never inserted" — one second after inserting it, and the operator would
    // reasonably conclude the page did nothing and paste it again.
    const env = { GEMINI_API_KEY: '@Microsoft.KeyVault(SecretUri=https://v/secrets/GEMINI-API-KEY)' };
    const record = { lastWriteAt: '2026-08-29T10:30:00.000Z' };
    expect(computeSecretState(entry, { env, record, startedAt: STARTED })).toBe('pending');
  });

  it('is amber for a first seed even when the setting is absent entirely', () => {
    const record = { lastWriteAt: '2026-08-29T10:30:00.000Z' };
    expect(computeSecretState(entry, { env: {}, record, startedAt: STARTED })).toBe('pending');
  });

  it('is green once the worker started after the write', () => {
    const record = { lastWriteAt: '2026-08-29T09:30:00.000Z' };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('live');
  });

  it('is red when the last verdict was a rejection', () => {
    const record = { lastFailAt: '2026-08-29T09:50:00.000Z', lastFailStatus: 401 };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('failing');
  });

  it('goes back to green when a later call succeeded', () => {
    const record = { lastFailAt: '2026-08-29T09:00:00.000Z', lastOkAt: '2026-08-29T09:40:00.000Z' };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('live');
  });

  it('stays red when the failure is the more recent of the two', () => {
    const record = { lastOkAt: '2026-08-29T09:00:00.000Z', lastFailAt: '2026-08-29T09:40:00.000Z' };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('failing');
  });

  it('never reports red for a secret that never resolved', () => {
    // A stale failure from before the key was removed must not outrank "there
    // is nothing here" — red says "fix this key", gray says "add one".
    const record = { lastFailAt: '2026-08-29T09:50:00.000Z' };
    expect(computeSecretState(entry, { env: {}, record, startedAt: STARTED })).toBe('never');
  });

  it('ignores unparseable timestamps rather than throwing', () => {
    const record = { lastWriteAt: 'not-a-date', lastFailAt: 'also-not' };
    expect(
      computeSecretState(entry, { env: { GEMINI_API_KEY: 'real' }, record, startedAt: STARTED })
    ).toBe('live');
    expect(at('2026-08-29T10:00:00.000Z')).toBe(STARTED);
  });
});

describe('what it refuses to store', () => {
  it('accepts an ordinary credential', () => {
    expect(rejectSecretValue('sk-ant-api03-abcdefghijklmnop')).toBeNull();
  });

  it('refuses a pasted Key Vault reference', () => {
    expect(
      rejectSecretValue('@Microsoft.KeyVault(SecretUri=https://v/secrets/GEMINI-API-KEY)')
    ).toMatch(/REFERENCE/);
  });

  it('refuses surrounding whitespace instead of silently trimming it', () => {
    // Trimming for the operator would be friendlier and wrong: if their
    // clipboard has a newline, the NEXT thing they paste somewhere else will
    // too, and here we can say so.
    expect(rejectSecretValue('  sk-ant-api03-abcdefghij  ')).toMatch(/whitespace/);
    expect(rejectSecretValue('sk-ant-api03-abcdefghij\n')).toMatch(/whitespace/);
  });

  it('refuses anything too short to be a credential', () => {
    // Not a run of 'x': that trips the placeholder rule instead, which would
    // make this pass for the wrong reason.
    expect(rejectSecretValue('ab3d5f7h9k')).toMatch(/shorter than/);
    expect(rejectSecretValue('ab3d5f7h9k1m')).toBeNull();
    expect('ab3d5f7h9k1m'.length).toBe(MIN_SECRET_LENGTH);
  });

  it('refuses placeholders', () => {
    for (const bad of ['changeme', 'PLACEHOLDER', 'your-key-here', 'xxxxxxxxxxxx', '<paste here>']) {
      expect(rejectSecretValue(bad), bad).toMatch(/placeholder|shorter than/);
    }
  });

  it('refuses an empty or non-string value', () => {
    for (const bad of ['', null, undefined, 42, {}]) {
      expect(rejectSecretValue(bad)).toMatch(/no value/);
    }
  });
});

describe('writing', () => {
  let handlers;
  let deps;
  beforeEach(() => {
    deps = buildDeps();
    handlers = createAdminSecretHandlers(deps);
  });

  it('writes the pasted value under the catalogue name', async () => {
    await handlers.putSecret(request({ secret: 'GEMINI-API-KEY', value: 'a-good-long-value' }));
    expect(deps.vault.setVaultSecret).toHaveBeenCalledWith(
      'GEMINI-API-KEY',
      'a-good-long-value',
      expect.anything()
    );
  });

  it('refuses a name the estate does not declare, without touching the vault', async () => {
    const response = await handlers.putSecret(
      request({ secret: 'SOME-OTHER-SECRET', value: 'a-good-long-value' })
    );
    expect(response.status).toBe(400);
    expect(deps.vault.setVaultSecret).not.toHaveBeenCalled();
  });

  it('records who wrote it and when, and clears any previous verdict', async () => {
    // A rotation makes the old key's 401 meaningless. Carrying it forward
    // would show the new key red before anything had tried it.
    const store = buildStore({
      'GEMINI-API-KEY': {
        lastFailAt: '2026-08-29T09:00:00.000Z',
        lastFailStatus: 401,
        lastOkAt: '2026-08-29T08:00:00.000Z',
      },
    });
    deps = buildDeps({ store });
    await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'a-good-long-value' })
    );
    const record = store.current().secrets['GEMINI-API-KEY'];
    expect(record.lastWriteAt).toBe('2026-08-29T12:00:00.000Z');
    expect(record.lastWriteBy).toBe('admin-1');
    expect(record.lastFailAt).toBeNull();
    expect(record.lastFailStatus).toBeNull();
    // Also the stale SUCCESS. It changes no light, but the page prints it as
    // "last verified", and a freshly rotated key has never been verified.
    expect(record.lastOkAt).toBeNull();
  });

  it('reports the new secret as pending, not live', async () => {
    const response = await handlers.putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'a-good-long-value' })
    );
    expect(response.jsonBody.secret.state).toBe('pending');
  });

  it('does not record a write that Key Vault refused', async () => {
    const store = buildStore();
    deps = buildDeps({
      store,
      vault: {
        setVaultSecret: vi.fn(async () => {
          throw new Error('HTTP 403');
        }),
        refreshKeyVaultReferences: vi.fn(),
      },
    });
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'a-good-long-value' })
    );
    expect(response.status).toBe(502);
    expect(store.current()).toBeNull();
  });

  it('still succeeds when the refresh call fails — the secret is already stored', async () => {
    // The failure mode this prevents: reporting "seeding failed" for a seeding
    // that worked, whereupon the operator pastes the key again.
    deps = buildDeps({
      vault: {
        setVaultSecret: vi.fn(async () => ({ version: 'v2' })),
        refreshKeyVaultReferences: vi.fn(async () => ({ refreshed: false, reason: 'HTTP 403' })),
      },
    });
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', value: 'a-good-long-value' })
    );
    expect(response.status).toBe(200);
    expect(response.jsonBody.refreshed).toBe(false);
    expect(response.jsonBody.message).toMatch(/within 24 hours/);
  });
});

describe('generating', () => {
  it('generates for a value this estate invents', async () => {
    const deps = buildDeps();
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'PREVIEW-SIGNING-SECRET', generate: true })
    );
    expect(response.status).toBe(200);
    expect(deps.vault.setVaultSecret).toHaveBeenCalledWith(
      'PREVIEW-SIGNING-SECRET',
      'generated-value-that-is-long-enough',
      expect.anything()
    );
  });

  it('refuses to generate a credential an upstream service issues', async () => {
    // A generated Gemini key is not weak, it is WRONG — and it would show a
    // green light while every call 401s.
    const deps = buildDeps();
    const response = await createAdminSecretHandlers(deps).putSecret(
      request({ secret: 'GEMINI-API-KEY', generate: true })
    );
    expect(response.status).toBe(400);
    expect(response.jsonBody.error).toMatch(/upstream service/);
    expect(deps.vault.setVaultSecret).not.toHaveBeenCalled();
  });
});

describe('recording verdicts', () => {
  it('records a rejection so the light turns red', async () => {
    const store = buildStore();
    await recordSecretVerdict(store, 'GEMINI-API-KEY', {
      ok: false,
      status: 401,
      now: () => '2026-08-29T12:00:00.000Z',
    });
    expect(store.current().secrets['GEMINI-API-KEY']).toMatchObject({
      lastFailAt: '2026-08-29T12:00:00.000Z',
      lastFailStatus: 401,
    });
  });

  it('records a success so the light goes back to green', async () => {
    const store = buildStore({ 'GEMINI-API-KEY': { lastFailAt: '2026-08-29T09:00:00.000Z' } });
    await recordSecretVerdict(store, 'GEMINI-API-KEY', {
      ok: true,
      now: () => '2026-08-29T12:00:00.000Z',
    });
    const record = store.current().secrets['GEMINI-API-KEY'];
    expect(record.lastOkAt).toBe('2026-08-29T12:00:00.000Z');
    // The failure is KEPT, not erased — the state machine compares the two, and
    // erasing history would hide a key that is flapping.
    expect(record.lastFailAt).toBe('2026-08-29T09:00:00.000Z');
  });

  it('ignores a name outside the catalogue rather than growing the document', async () => {
    const store = buildStore();
    await recordSecretVerdict(store, 'NOT-A-SECRET', { ok: false, status: 401 });
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('does nothing without a store', async () => {
    await expect(recordSecretVerdict(null, 'GEMINI-API-KEY', { ok: true })).resolves.toBeUndefined();
  });
});

describe('processStartedAt', () => {
  it('derives the start from uptime, not from module load', () => {
    expect(processStartedAt(10_000, 4)).toBe(6_000);
  });
});
