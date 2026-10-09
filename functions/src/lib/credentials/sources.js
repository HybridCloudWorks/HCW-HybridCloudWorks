/**
 * The register's reads, and its one write (#1026).
 *
 * READS. Every live date the register shows comes from a document another
 * feature already keeps; this module reads each one by its point id and
 * hands `status.js` the field maps it needs:
 *
 *   secret-state         admin_config/secret_state      the Keys tab's lastWriteAt per secret
 *   coder-automation     admin_config/coder_automation  the lab host's Coder token dates
 *   credential-register  admin_config/credential_register  the owner's recorded rotations
 *   mcp:<id>             mcp_servers/<id>                an MCP server's connection
 *   reminders            admin_config/reminders          only for the read's "in the sheet" column
 *
 * Each read stands alone: one that fails is named in `unavailable`, and the
 * credentials that depend on it show `unknown` rather than the whole tab
 * failing. Two documents read here sit beside credentials (an mcp_servers
 * record holds its tokens; secret_state holds none, by its own rule), so
 * nothing read here is passed on whole: status.js names every field it
 * uses, and the answer is built field by field (status.js presentCredential).
 *
 * THE WRITE: admin_config/credential_register.
 *
 *   { id: 'credential_register', configScope: 'admin_config',
 *     docType: 'credential_register',
 *     credentials: { <register id>: { rotatedOn: 'YYYY-MM-DD',
 *                                      recordedAt, recordedBy } } }
 *
 * A date per credential and who recorded it: no value, no name of one beyond
 * the register's own ids, which are in the repository. One credential's
 * record changes at a time, read → change → write-if-unchanged under the
 * document's ETag, retried when another write got there first: the
 * updateSecretRecord pattern (admin-secrets.js), so two rotations recorded in
 * the same moment both land.
 */

import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { REMINDERS_CONFIG_ID } from '../reminders/settings.js';
import { CREDENTIAL_REGISTER } from './register.js';

export const CREDENTIAL_REGISTER_DOC_ID = 'credential_register';
export const CREDENTIAL_REGISTER_DOC_TYPE = 'credential_register';
const SECRET_STATE_DOC_ID = 'secret_state';
const CODER_AUTOMATION_DOC_ID = 'coder_automation';
const CONTAINER = 'admin_config';
const PK = { partitionKey: ADMIN_CONFIG_PARTITION };

/** Read → change → write-if-unchanged attempts on the register document. */
export const RECORD_WRITE_ATTEMPTS = 6;

/** What each source is, in the words the tab uses when one cannot be read. */
export const SOURCE_LABELS = Object.freeze({
  'secret-state': 'Key Vault write dates (admin_config/secret_state)',
  'coder-automation': 'the lab host’s Coder report (admin_config/coder_automation)',
  'credential-register': 'the recorded rotations (admin_config/credential_register)',
  reminders: 'the reminders sheet (admin_config/reminders)',
});

/** The mcp_servers ids the register reads, from its own entries. */
export const MCP_SERVER_IDS = Object.freeze([
  ...new Set(CREDENTIAL_REGISTER.map((entry) => entry.source?.mcpServer).filter(Boolean)),
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const mapOf = (value) => (isPlainObject(value) ? value : {});

/** A source's label, for one that could not be read. */
export function sourceLabel(id) {
  if (Object.hasOwn(SOURCE_LABELS, id)) return SOURCE_LABELS[id];
  return id.startsWith('mcp:') ? `the ${id.slice(4)} MCP server record (mcp_servers)` : id;
}

/**
 * Every source, read in parallel. `{ sources, unavailable }`: `sources` as
 * status.js reads them, plus `reminders` (the stored rows, or null when the
 * sheet could not be read); `unavailable` the ids of the reads that failed.
 */
export async function readCredentialSources(store) {
  const reads = {
    'secret-state': () => store.readDoc(CONTAINER, SECRET_STATE_DOC_ID, ADMIN_CONFIG_PARTITION),
    'coder-automation': () => store.readDoc(CONTAINER, CODER_AUTOMATION_DOC_ID, ADMIN_CONFIG_PARTITION),
    'credential-register': () => store.readDoc(CONTAINER, CREDENTIAL_REGISTER_DOC_ID, ADMIN_CONFIG_PARTITION),
    reminders: () => store.readDoc(CONTAINER, REMINDERS_CONFIG_ID, ADMIN_CONFIG_PARTITION),
    ...Object.fromEntries(MCP_SERVER_IDS.map((id) => [`mcp:${id}`, () => store.readDoc('mcp_servers', id, id)])),
  };
  const ids = Object.keys(reads);
  const settled = await Promise.allSettled(ids.map((id) => reads[id]()));
  const result = Object.fromEntries(ids.map((id, index) => [id, settled[index]]));
  const value = (id) => (result[id].status === 'fulfilled' ? (result[id].value ?? null) : null);

  const mcp = {};
  for (const id of MCP_SERVER_IDS) {
    // A failed read stays absent, which status.js tells apart from a server
    // that has no document (null): one is unknown, the other not connected.
    if (result[`mcp:${id}`].status === 'fulfilled') mcp[id] = value(`mcp:${id}`);
  }
  const reminders = value('reminders');
  return {
    sources: {
      secrets: mapOf(value('secret-state')?.secrets),
      coder: value('coder-automation'),
      records: mapOf(value('credential-register')?.credentials),
      mcp,
      reminders:
        result.reminders.status === 'fulfilled'
          ? (Array.isArray(reminders?.reminders) ? reminders.reminders : [])
          : null,
    },
    unavailable: ids.filter((id) => result[id].status === 'rejected'),
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Record, or with `rotatedOn` null clear, when one credential was last
 * rotated. Resolves to the stored record (null when cleared); throws with
 * `code: 'CONFLICT'` when every attempt lost a race, with no id in the
 * message, which a caller may log.
 *
 * @param {{ readDoc: Function, createDoc: Function, replaceDocIfMatch: Function }} store
 * @param {{ credentialId: string, rotatedOn: string|null, actor: string, at: string }} change
 */
export async function recordRotation(
  store,
  { credentialId, rotatedOn, actor, at },
  { attempts = RECORD_WRITE_ATTEMPTS, sleep = defaultSleep } = {}
) {
  const record = rotatedOn ? { rotatedOn, recordedAt: at, recordedBy: actor || 'unknown' } : null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(20 * 2 ** Math.min(attempt, 5) + Math.random() * 20);
    const current = await store.readDoc(CONTAINER, CREDENTIAL_REGISTER_DOC_ID, ADMIN_CONFIG_PARTITION);
    const credentials = { ...mapOf(current?.credentials) };
    if (record) credentials[credentialId] = record;
    else delete credentials[credentialId];
    const next = {
      id: CREDENTIAL_REGISTER_DOC_ID,
      configScope: ADMIN_CONFIG_PARTITION,
      docType: CREDENTIAL_REGISTER_DOC_TYPE,
      credentials,
    };
    try {
      if (current) {
        await store.replaceDocIfMatch(CONTAINER, { ...next, _etag: current._etag }, PK);
      } else {
        await store.createDoc(CONTAINER, next);
      }
      return record;
    } catch (error) {
      // 412: replaced since our read. 409: created since our read found
      // nothing. Either way, read again and change again.
      if (error?.code !== 412 && error?.code !== 409) throw error;
    }
  }
  throw Object.assign(new Error('The credential register kept changing while it was written'), {
    code: 'CONFLICT',
  });
}
