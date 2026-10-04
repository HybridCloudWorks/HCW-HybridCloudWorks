/**
 * The Ambassador hub's three reads and every write (ADR 0033 §4), through the
 * shared `useGuardedLoad` and `useWriteGuard` (§2). Programs, applications
 * and evidence are read once, here on the page, because every tab shows a
 * view of them; a write re-reads the list it changed through the generation
 * guard and resolves to the saved item, or null when refused (the toast says
 * why).
 *
 * NOT PROVISIONED. Until `terraform apply` creates the `ambassador`
 * container the API answers 503 `{ code: 'NOT_PROVISIONED' }`; the error
 * code travels on the thrown error (lib/api.js) and through
 * `useGuardedLoad.errorCode`, and the page renders that one state instead of
 * three failed tabs (ADR 0033 §6 item 4).
 */

import { useCallback, useMemo } from 'react';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import useGuardedLoad from '@/components/admin/shared/useGuardedLoad';
import useWriteGuard from '@/components/admin/shared/useWriteGuard';

export const NOT_PROVISIONED = 'NOT_PROVISIONED';
const BASE = 'cms/ambassador';
const NO_ROWS = Object.freeze([]);

const loadPrograms = async () => (await getJSON(`${BASE}/programs`)).items || [];
const loadApplications = async () => (await getJSON(`${BASE}/applications`)).items || [];
const loadEvidence = async () => (await getJSON(`${BASE}/evidence`)).items || [];

// Module-level, not built per render: useGuardedLoad re-arms its effect when
// describeError changes identity, and a fresh closure every render is a read
// loop (the Ambassador page fetched without end until these were hoisted).
const describe = (what) => (err) =>
  err?.code === NOT_PROVISIONED
    ? 'The ambassador container has not been provisioned yet.'
    : `Failed to load ${what}: ${err?.message}`;
const describePrograms = describe('programs');
const describeApplications = describe('applications');
const describeEvidence = describe('evidence');

export default function useAmbassadorData(authReady, { toast } = {}) {
  const programs = useGuardedLoad(loadPrograms, {
    enabled: authReady,
    empty: NO_ROWS,
    describeError: describePrograms,
  });
  const applications = useGuardedLoad(loadApplications, {
    enabled: authReady,
    empty: NO_ROWS,
    describeError: describeApplications,
  });
  const evidence = useGuardedLoad(loadEvidence, {
    enabled: authReady,
    empty: NO_ROWS,
    describeError: describeEvidence,
  });
  const { busyIds, claim, release } = useWriteGuard();

  const notProvisioned = [programs, applications, evidence].some(
    (read) => read.errorCode === NOT_PROVISIONED
  );

  /**
   * One guarded write: claim the row (or the kind, for a create), send, toast
   * the outcome, re-read the list, release. Resolves to the response's item
   * (or the whole body for an import), or null when the write was refused or
   * one to the same row is already out.
   */
  const write = useCallback(
    async (key, send, { refresh, success, failure, pick = (body) => body.item ?? body }) => {
      if (!claim(key)) return null;
      try {
        const body = await send();
        if (success) toast?.({ title: success });
        await refresh();
        return pick(body);
      } catch (err) {
        toast?.({ title: failure, description: err?.message, variant: 'destructive' });
        return null;
      } finally {
        release(key);
      }
    },
    [claim, release, toast]
  );

  const writes = useMemo(
    () => ({
      createProgram: (body) =>
        write('program:new', () => postJSON(`${BASE}/programs`, body), {
          refresh: programs.refresh,
          success: 'Program added',
          failure: 'Could not add the program',
        }),
      patchProgram: (id, body) =>
        write(id, () => sendJSON(`${BASE}/programs/${encodeURIComponent(id)}`, 'PATCH', body), {
          refresh: programs.refresh,
          success: 'Program saved',
          failure: 'Could not save the program',
        }),
      deleteProgram: (id) =>
        write(id, () => sendJSON(`${BASE}/programs/${encodeURIComponent(id)}`, 'DELETE'), {
          refresh: programs.refresh,
          success: 'Program deleted',
          failure: 'Could not delete the program',
        }),
      createApplication: (body) =>
        write('application:new', () => postJSON(`${BASE}/applications`, body), {
          refresh: applications.refresh,
          success: 'Application started',
          failure: 'Could not start the application',
        }),
      patchApplication: (id, body, { quiet = false } = {}) =>
        write(id, () => sendJSON(`${BASE}/applications/${encodeURIComponent(id)}`, 'PATCH', body), {
          refresh: applications.refresh,
          success: quiet ? null : 'Application saved',
          failure: 'Could not save the application',
        }),
      deleteApplication: (id) =>
        write(id, () => sendJSON(`${BASE}/applications/${encodeURIComponent(id)}`, 'DELETE'), {
          refresh: applications.refresh,
          success: 'Application deleted',
          failure: 'Could not delete the application',
        }),
      createEvidence: (body) =>
        write('evidence:new', () => postJSON(`${BASE}/evidence`, body), {
          refresh: evidence.refresh,
          success: 'Evidence added',
          failure: 'Could not add the evidence',
        }),
      patchEvidence: (id, body) =>
        write(id, () => sendJSON(`${BASE}/evidence/${encodeURIComponent(id)}`, 'PATCH', body), {
          refresh: evidence.refresh,
          success: 'Evidence saved',
          failure: 'Could not save the evidence',
        }),
      deleteEvidence: (id) =>
        write(id, () => sendJSON(`${BASE}/evidence/${encodeURIComponent(id)}`, 'DELETE'), {
          refresh: evidence.refresh,
          success: 'Evidence deleted',
          failure: 'Could not delete the evidence',
        }),
      importEvidence: (sourceModule, ids, programIds = []) =>
        write(
          `import:${sourceModule}`,
          () => postJSON(`${BASE}/evidence/import`, { sourceModule, ids, programIds }),
          {
            refresh: evidence.refresh,
            failure: 'Import failed',
            pick: (body) => body,
          }
        ),
    }),
    [write, programs.refresh, applications.refresh, evidence.refresh]
  );

  const refreshPrograms = programs.refresh;
  const refreshApplications = applications.refresh;
  const refreshEvidence = evidence.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshPrograms(), refreshApplications(), refreshEvidence()]),
    [refreshPrograms, refreshApplications, refreshEvidence]
  );

  return { programs, applications, evidence, notProvisioned, busyIds, writes, refreshAll };
}

/** What the import picker lists for one source: `{ id, title, date, url, imported }` rows. */
export async function loadImportSources(sourceModule) {
  return (
    (await getJSON(`${BASE}/evidence/sources/${encodeURIComponent(sourceModule)}`)).items || []
  );
}

/** The server's readiness for one program, optionally bounded to a period. */
export async function loadReadiness(programId, period) {
  const query = period ? `?period=${encodeURIComponent(period)}` : '';
  return (await getJSON(`${BASE}/readiness/${encodeURIComponent(programId)}${query}`)).readiness;
}
