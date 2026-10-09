/**
 * The register's reads, each standing alone, and its one write under the
 * document's ETag (#1026).
 */
import { describe, it, expect, vi } from 'vitest';

import { memoryStore } from '../../../test/memory-store.js';
import {
  CREDENTIAL_REGISTER_DOC_ID,
  MCP_SERVER_IDS,
  readCredentialSources,
  recordRotation,
  sourceLabel,
} from './sources.js';

const AT = '2026-10-09T12:00:00.000Z';
const noSleep = () => Promise.resolve();
const down = () => Object.assign(new Error('unavailable'), { code: 503 });

describe('readCredentialSources', () => {
  it('reads every source by point id and hands status.js the maps it reads', async () => {
    const store = memoryStore({
      'admin_config/secret_state': { id: 'secret_state', secrets: { 'ANTHROPIC-API-KEY': { lastWriteAt: AT } } },
      'admin_config/coder_automation': { id: 'coder_automation', statusTokenExpiresAt: AT },
      'admin_config/credential_register': {
        id: CREDENTIAL_REGISTER_DOC_ID,
        credentials: { 'lab-agent-certificate': { rotatedOn: '2026-09-29' } },
      },
      'admin_config/reminders': { id: 'reminders', reminders: [{ id: 'a' }] },
      'mcp_servers/plaud': { id: 'plaud', status: 'connected' },
    });
    const { sources, unavailable } = await readCredentialSources(store);
    expect(unavailable).toEqual([]);
    expect(sources.secrets).toEqual({ 'ANTHROPIC-API-KEY': { lastWriteAt: AT } });
    expect(sources.coder.statusTokenExpiresAt).toBe(AT);
    expect(sources.records).toEqual({ 'lab-agent-certificate': { rotatedOn: '2026-09-29' } });
    expect(sources.reminders).toEqual([{ id: 'a' }]);
    // A server with no document is null (not connected), not absent (unread).
    expect(Object.keys(sources.mcp).sort()).toEqual([...MCP_SERVER_IDS].sort());
    expect(sources.mcp['replicate-mcp']).toBeNull();
    expect(store.readDoc).toHaveBeenCalledWith('mcp_servers', 'plaud', 'plaud');
    expect(store.readDoc).toHaveBeenCalledWith('admin_config', 'secret_state', 'admin_config');
  });

  it('names a read that failed and keeps the rest', async () => {
    const store = memoryStore();
    store.fail('admin_config', 'secret_state', 'readDoc', down());
    store.fail('mcp_servers', 'hostinger-mcp', 'readDoc', down());
    store.fail('admin_config', 'reminders', 'readDoc', down());
    const { sources, unavailable } = await readCredentialSources(store);
    expect(unavailable.sort()).toEqual(['mcp:hostinger-mcp', 'reminders', 'secret-state']);
    expect(sources.secrets).toEqual({});
    expect(Object.hasOwn(sources.mcp, 'hostinger-mcp')).toBe(false);
    expect(sources.reminders).toBeNull();
  });

  it('reads an empty estate as empty, not as failed', async () => {
    const { sources, unavailable } = await readCredentialSources(memoryStore());
    expect(unavailable).toEqual([]);
    expect(sources).toMatchObject({ secrets: {}, coder: null, records: {}, reminders: [] });
  });

  it('labels a source in the tab’s words', () => {
    expect(sourceLabel('secret-state')).toMatch(/Key Vault write dates/);
    expect(sourceLabel('mcp:plaud')).toBe('the plaud MCP server record (mcp_servers)');
  });
});

describe('recordRotation', () => {
  const change = (overrides = {}) => ({
    credentialId: 'lab-agent-certificate',
    rotatedOn: '2026-09-29',
    actor: 'oid-1',
    at: AT,
    ...overrides,
  });

  it('creates the document with one record: a date and who recorded it', async () => {
    const store = memoryStore();
    const record = await recordRotation(store, change());
    expect(record).toEqual({ rotatedOn: '2026-09-29', recordedAt: AT, recordedBy: 'oid-1' });
    expect(store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID)).toMatchObject({
      id: CREDENTIAL_REGISTER_DOC_ID,
      configScope: 'admin_config',
      docType: 'credential_register',
      credentials: { 'lab-agent-certificate': record },
    });
  });

  it('changes one record and keeps every other', async () => {
    const store = memoryStore({
      'admin_config/credential_register': {
        id: CREDENTIAL_REGISTER_DOC_ID,
        credentials: { 'kv-anthropic-api-key': { rotatedOn: '2026-01-01', recordedAt: AT, recordedBy: 'x' } },
      },
    });
    await recordRotation(store, change());
    const { credentials } = store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID);
    expect(Object.keys(credentials).sort()).toEqual(['kv-anthropic-api-key', 'lab-agent-certificate']);
    expect(store.replaceDocIfMatch).toHaveBeenCalledWith(
      'admin_config',
      expect.objectContaining({ _etag: expect.any(String) }),
      { partitionKey: 'admin_config' }
    );
  });

  it('clears a record with a null date', async () => {
    const store = memoryStore({
      'admin_config/credential_register': {
        id: CREDENTIAL_REGISTER_DOC_ID,
        credentials: { 'lab-agent-certificate': { rotatedOn: '2026-01-01' } },
      },
    });
    expect(await recordRotation(store, change({ rotatedOn: null }))).toBeNull();
    expect(store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID).credentials).toEqual({});
  });

  it('reads again and re-applies when another write got there first, so both land', async () => {
    const store = memoryStore({
      'admin_config/credential_register': { id: CREDENTIAL_REGISTER_DOC_ID, credentials: {} },
    });
    // Another record lands between this write's read and its replace.
    const realRead = store.readDoc.getMockImplementation();
    let raced = false;
    store.readDoc.mockImplementation(async (...args) => {
      const doc = await realRead(...args);
      if (!raced) {
        raced = true;
        const current = store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID);
        await store.replaceDocIfMatch('admin_config', {
          ...current,
          credentials: { 'kv-anthropic-api-key': { rotatedOn: '2026-02-02' } },
        });
      }
      return doc;
    });
    await recordRotation(store, change(), { sleep: noSleep });
    expect(Object.keys(store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID).credentials).sort()).toEqual([
      'kv-anthropic-api-key',
      'lab-agent-certificate',
    ]);
  });

  it('treats a lost create as a race too', async () => {
    const store = memoryStore();
    store.fail('admin_config', CREDENTIAL_REGISTER_DOC_ID, 'createDoc', Object.assign(new Error('x'), { code: 409 }));
    await recordRotation(store, change(), { sleep: noSleep });
    expect(store.createDoc).toHaveBeenCalledTimes(2);
    expect(store.get('admin_config', CREDENTIAL_REGISTER_DOC_ID).credentials['lab-agent-certificate']).toBeTruthy();
  });

  it('gives up with CONFLICT after every attempt lost, and names no credential', async () => {
    const store = memoryStore({ 'admin_config/credential_register': { id: CREDENTIAL_REGISTER_DOC_ID } });
    store.fail(
      'admin_config',
      CREDENTIAL_REGISTER_DOC_ID,
      'replaceDocIfMatch',
      Object.assign(new Error('x'), { code: 412 }),
      3
    );
    const error = await recordRotation(store, change(), { attempts: 3, sleep: noSleep }).catch((e) => e);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).not.toContain('lab-agent');
  });

  it('throws any other store error at once', async () => {
    const store = memoryStore();
    store.fail('admin_config', CREDENTIAL_REGISTER_DOC_ID, 'createDoc', down());
    const sleep = vi.fn(noSleep);
    await expect(recordRotation(store, change(), { sleep })).rejects.toMatchObject({ code: 503 });
    expect(sleep).not.toHaveBeenCalled();
  });
});
