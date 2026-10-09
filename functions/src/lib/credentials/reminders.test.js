/**
 * The credential reminders on the owner's sheet (#1026): which rows, how
 * they merge, and that the owner's own rows, the timer's stamps and a
 * concurrent save all survive a sync.
 */
import { describe, it, expect, vi } from 'vitest';

import { memoryStore } from '../../../test/memory-store.js';
import { MAX_REMINDERS, normalizeReminders, readStoredReminders } from '../reminders/settings.js';
import { CREDENTIAL_REGISTER } from './register.js';
import { buildRegisterView } from './status.js';
import {
  CREDENTIALS_TAB_URL,
  CREDENTIAL_REMINDER_PREFIX,
  isCredentialReminder,
  mergeCredentialReminders,
  reminderIdFor,
  syncCredentialReminders,
  wantedReminders,
} from './reminders.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const now = () => NOW;
const noSleep = () => Promise.resolve();

/** Every reminder-bearing credential with a date, as the owner would record them. */
const ALL_RECORDED = Object.fromEntries(
  CREDENTIAL_REGISTER.filter((entry) => entry.renewal === 'hand' && entry.lifetimeDays).map((entry) => [
    entry.id,
    { rotatedOn: '2026-09-29' },
  ])
);

const ownerRow = (id, overrides = {}) => ({
  id,
  title: `Owner reminder ${id}`,
  dueDate: '2026-12-01',
  leadDays: 7,
  notes: '',
  url: '',
  done: false,
  notified: {},
  ...overrides,
});

const view = (records = {}, secrets = {}) =>
  buildRegisterView({ records, secrets, mcp: {}, coder: null }, NOW.getTime()).credentials;

describe('wantedReminders', () => {
  it('wants one row per hand credential with a due date, and none without one', () => {
    expect(wantedReminders(view())).toEqual([]);
    const rows = wantedReminders(view(ALL_RECORDED));
    expect(rows.map((row) => row.id).sort()).toEqual(
      Object.keys(ALL_RECORDED).map(reminderIdFor).sort()
    );
    // Exactly the issue's list: two GitHub App keys among the eight.
    expect(rows).toHaveLength(8);
  });

  it('is due on the expiry’s day, says it first when the tab turns amber, and links to the tab', () => {
    const [swa] = wantedReminders(view({ 'azure-swa-deployment-token': { rotatedOn: '2026-09-29' } }));
    expect(swa).toEqual({
      id: 'credential-azure-swa-deployment-token',
      title: 'Rotate Static Web App deployment token',
      dueDate: '2026-12-28',
      leadDays: 14,
      notes: expect.stringContaining('Static Web App deployment token, in Azure Static Web App.'),
      url: CREDENTIALS_TAB_URL,
      done: false,
      notified: {},
    });
    expect(swa.notes).toContain('Reset it on the Static Web App');
    expect(swa.notes).toContain('record the rotation on Integrations → Credentials');
    const [cert] = wantedReminders(view({ 'lab-agent-certificate': { rotatedOn: '2026-09-29' } }));
    expect(cert).toMatchObject({ dueDate: '2028-09-28', leadDays: 30 });
  });

  it('follows a Keys-tab write, the later of it and the record', () => {
    const [anthropic] = wantedReminders(
      view(
        { 'kv-anthropic-api-key': { rotatedOn: '2026-01-01' } },
        { 'ANTHROPIC-API-KEY': { lastWriteAt: '2026-10-01T09:00:00.000Z' } }
      )
    );
    expect(anthropic.dueDate).toBe('2027-10-01');
  });

  it('writes rows the sheet’s own normalizer accepts', () => {
    expect(() => normalizeReminders({ reminders: wantedReminders(view(ALL_RECORDED)) })).not.toThrow();
  });
});

describe('mergeCredentialReminders', () => {
  const wanted = wantedReminders(view({ 'lab-agent-certificate': { rotatedOn: '2026-09-29' } }));
  const id = 'credential-lab-agent-certificate';

  it('passes the owner’s rows through untouched and in place, and appends a new credential row', () => {
    const stored = [ownerRow('a'), ownerRow('b', { done: true, notified: { ahead: '2026-11-24T13:00:00.000Z' } })];
    const merged = mergeCredentialReminders(stored, wanted);
    expect(merged.slice(0, 2)).toEqual(stored);
    expect(merged[2].id).toBe(id);
  });

  it('keeps done and the timer’s stamps while the due date stands', () => {
    const notified = { ahead: '2028-08-29T13:00:00.000Z' };
    const stored = [{ ...wanted[0], title: 'edited by hand', done: true, notified }];
    const [row] = mergeCredentialReminders(stored, wanted);
    expect(row).toEqual({ ...wanted[0], done: true, notified });
  });

  it('starts a fresh cycle when the due date moves', () => {
    const stored = [{ ...wanted[0], dueDate: '2027-01-01', done: true, notified: { due: '2027-01-01T13:00:00.000Z' } }];
    const [row] = mergeCredentialReminders(stored, wanted);
    expect(row).toEqual(wanted[0]);
  });

  it('replaces a credential row in place, and removes one whose credential has no due date', () => {
    const stored = [
      ownerRow('a'),
      { ...wanted[0], dueDate: '2027-01-01' },
      ownerRow('b'),
      { ...wanted[0], id: 'credential-kv-anthropic-api-key' },
    ];
    expect(mergeCredentialReminders(stored, wanted).map((row) => row.id)).toEqual(['a', id, 'b']);
  });

  it('keeps one row per credential even if the sheet holds two', () => {
    const merged = mergeCredentialReminders([wanted[0], { ...wanted[0] }], wanted);
    expect(merged.filter((row) => row.id === id)).toHaveLength(1);
  });

  it('recognises its own rows by the reserved prefix only', () => {
    expect(isCredentialReminder({ id: `${CREDENTIAL_REMINDER_PREFIX}x` })).toBe(true);
    expect(isCredentialReminder({ id: 'f0e1d2c3-uuid' })).toBe(false);
    expect(isCredentialReminder({})).toBe(false);
  });
});

describe('syncCredentialReminders', () => {
  const seeded = (reminders, records = ALL_RECORDED) =>
    memoryStore({
      'admin_config/credential_register': { id: 'credential_register', credentials: records },
      ...(reminders ? { 'admin_config/reminders': { id: 'reminders', configScope: 'admin_config', reminders } } : {}),
    });
  const sheet = (store) => store.get('admin_config', 'reminders');

  it('creates the sheet when there is none, with a row per reminder-bearing credential', async () => {
    const store = seeded(null);
    expect(await syncCredentialReminders({ store, now })).toEqual({ synced: true, changed: true, reminders: 8 });
    expect(sheet(store)).toMatchObject({ id: 'reminders', configScope: 'admin_config' });
    expect(readStoredReminders(sheet(store)).reminders).toHaveLength(8);
  });

  it('never touches the owner’s rows, and keeps the document’s other fields', async () => {
    const owners = [ownerRow('a'), ownerRow('b', { done: true })];
    const store = memoryStore({
      'admin_config/credential_register': { id: 'credential_register', credentials: ALL_RECORDED },
      'admin_config/reminders': { id: 'reminders', configScope: 'admin_config', updatedBy: 'oid-9', reminders: owners },
    });
    await syncCredentialReminders({ store, now });
    const stored = sheet(store);
    expect(stored.updatedBy).toBe('oid-9');
    expect(stored.reminders.slice(0, 2)).toEqual(owners);
    expect(stored.reminders).toHaveLength(10);
    expect(store.replaceDocIfMatch).toHaveBeenCalledWith(
      'admin_config',
      expect.objectContaining({ _etag: expect.any(String) }),
      { partitionKey: 'admin_config' }
    );
  });

  it('writes nothing when the sheet is already in step', async () => {
    const store = seeded(null);
    await syncCredentialReminders({ store, now });
    store.replaceDocIfMatch.mockClear();
    store.createDoc.mockClear();
    expect(await syncCredentialReminders({ store, now })).toEqual({ synced: true, changed: false, reminders: 8 });
    expect(store.replaceDocIfMatch).not.toHaveBeenCalled();
    expect(store.createDoc).not.toHaveBeenCalled();
  });

  it('re-reads and re-merges when the sheet was saved in between, losing neither write', async () => {
    const store = seeded([ownerRow('a')]);
    const realRead = store.readDoc.getMockImplementation();
    let raced = false;
    store.readDoc.mockImplementation(async (container, id, pk) => {
      const doc = await realRead(container, id, pk);
      if (id === 'reminders' && !raced && store.readDoc.mock.calls.filter((c) => c[1] === 'reminders').length === 2) {
        raced = true;
        // The owner adds a row between the sync's read and its write.
        const current = store.get('admin_config', 'reminders');
        await store.replaceDocIfMatch('admin_config', { ...current, reminders: [...current.reminders, ownerRow('c')] });
      }
      return doc;
    });
    const result = await syncCredentialReminders({ store, now, sleep: noSleep });
    expect(result).toMatchObject({ synced: true, changed: true });
    const ids = sheet(store).reminders.map((row) => row.id);
    expect(ids.slice(0, 2)).toEqual(['a', 'c']);
    expect(ids).toHaveLength(10);
  });

  it('leaves a sheet that does not validate alone, and says so', async () => {
    const store = seeded([{ id: 'broken', title: '' }]);
    const log = { warn: vi.fn() };
    expect(await syncCredentialReminders({ store, now, log })).toEqual({ synced: false, reason: 'invalid' });
    expect(sheet(store).reminders).toEqual([{ id: 'broken', title: '' }]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('leaves the sheet alone when the credential rows would pass its limit', async () => {
    const full = Array.from({ length: MAX_REMINDERS - 2 }, (_, i) => ownerRow(`r${i}`));
    const store = seeded(full);
    expect(await syncCredentialReminders({ store, now, log: {} })).toEqual({ synced: false, reason: 'invalid' });
    expect(sheet(store).reminders).toHaveLength(MAX_REMINDERS - 2);
  });

  it('waits while a source its dates depend on cannot be read', async () => {
    const store = seeded(null);
    store.fail('admin_config', 'secret_state', 'readDoc', Object.assign(new Error('x'), { code: 503 }));
    const log = { warn: vi.fn() };
    expect(await syncCredentialReminders({ store, now, log })).toEqual({ synced: false, reason: 'unreadable' });
    expect(sheet(store)).toBeNull();
    // Counts only: no source id, no credential name in the line.
    expect(log.warn.mock.calls[0][0]).toBe(
      '[credentialReminders] 1 source(s) could not be read; reminders left as they are'
    );
  });

  it('still syncs when only an MCP record or the Coder report is unreadable', async () => {
    const store = seeded(null);
    store.fail('mcp_servers', 'plaud', 'readDoc', Object.assign(new Error('x'), { code: 503 }));
    store.fail('admin_config', 'coder_automation', 'readDoc', Object.assign(new Error('x'), { code: 503 }));
    expect(await syncCredentialReminders({ store, now })).toMatchObject({ synced: true, reminders: 8 });
  });

  it('gives up after its attempts when the sheet keeps changing', async () => {
    const store = seeded([ownerRow('a')]);
    store.fail('admin_config', 'reminders', 'replaceDocIfMatch', Object.assign(new Error('x'), { code: 412 }), 2);
    const log = { warn: vi.fn() };
    expect(await syncCredentialReminders({ store, now, log, attempts: 2, sleep: noSleep })).toEqual({
      synced: false,
      reason: 'conflict',
    });
  });

  it('throws a store error that is not a lost race', async () => {
    const store = seeded([ownerRow('a')]);
    store.fail('admin_config', 'reminders', 'replaceDocIfMatch', Object.assign(new Error('x'), { code: 500 }));
    await expect(syncCredentialReminders({ store, now, sleep: noSleep })).rejects.toMatchObject({ code: 500 });
  });
});
