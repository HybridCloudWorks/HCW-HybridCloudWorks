/**
 * /admin/drafts — the Drafts stage (owner request 2026-10-03), the step
 * before the Content Queue.
 *
 * Articles are written and kept here, saved in the site: a save is one API
 * call from any device, with no GitHub credential and no pull request. When
 * one is ready, Send to In Review moves it onto the Content Queue's In Review
 * filter — the same place the old "Import drafts from the repository" panel
 * landed files — where the provider is set and it goes on to the Publish
 * Queue. An article In Review that came from here can come back with Back to
 * Drafts; one that is live is never touched from this page.
 *
 * "Import from docs/content" brings the repository's `blog-*.md` articles in
 * once, as drafts. After that, this page is their source of truth and
 * docs/content is an archive.
 *
 * TWO TABS. Every write carries the etag of the version on screen, and the
 * API refuses it (412, code CONFLICT) when the stored version has moved on.
 * The page keeps the owner's text and offers to reload the latest; it never
 * retries a save over someone else's.
 *
 * Server side: functions/src/lib/cms/drafts-handlers.js and drafts.js.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileInput, Loader2, Plus, RefreshCw } from 'lucide-react';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuthReady } from '@/hooks/useAuthReady';
import { getJSON, postJSON, sendJSON } from '@/lib/api';
import DraftList from './drafts/DraftList';
import DraftEditor from './drafts/DraftEditor';
import {
  DRAFTS_ROUTE,
  EMPTY_FORM,
  IMPORT_ROUTE,
  NEW_DRAFT_ACTIONS,
  describeImportResult,
  describeSaveState,
  draftRoute,
  fromDraft,
  isDirty,
  summarizeImport,
  toPayload,
} from './drafts/draftForm';
import { useUnsavedGuard } from './drafts/useUnsavedGuard';

const NEW_DRAFT = Object.freeze({ id: null, stage: 'draft', actions: NEW_DRAFT_ACTIONS });

const LIVE_DELETE_MESSAGE =
  'This article is live on the site, so deleting it is refused and nothing was changed. A published article is never touched from Drafts.';

async function readDrafts() {
  const result = await getJSON(DRAFTS_ROUTE);
  return Array.isArray(result?.drafts) ? result.drafts : [];
}

/** The list row for a draft view the API just answered. */
const toRow = (draft) => {
  const { fields: _fields, ...row } = draft;
  return row;
};

const IMPORT_TONE_CLASS = {
  ok: 'text-green-700 dark:text-green-300',
  skip: 'text-muted-foreground',
  bad: 'text-destructive',
};

function ImportResults({ results, onDismiss }) {
  if (!results) return null;
  return (
    <section
      aria-label="Import results"
      className="rounded-md border bg-card px-4 py-3 text-sm shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium">Import from docs/content</p>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <ul className="space-y-1">
        {results.map((result) => {
          const line = describeImportResult(result);
          return (
            <li key={result.path}>
              <span className="font-medium">{line.title}</span>{' '}
              <span className={IMPORT_TONE_CLASS[line.tone]}>{line.text}</span>
              {(result.warnings || []).map((warning) => (
                <span key={warning} className="block text-xs text-muted-foreground">
                  {warning}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function DraftsPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // The open article: the API view (or NEW_DRAFT), the form, and the form as
  // last saved — the baseline "unsaved changes" is measured against.
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [baseline, setBaseline] = useState(EMPTY_FORM);
  const [opening, setOpening] = useState(false);

  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  // A pending switch away from unsaved changes: () => void, run on confirm.
  const [pendingSwitch, setPendingSwitch] = useState(null);

  const dirty = Boolean(current) && isDirty(form, baseline);
  useUnsavedGuard(dirty);

  const saveState = describeSaveState({
    saving: busy === 'save',
    error: Boolean(actionError || conflict) && dirty,
    dirty,
    isNew: Boolean(current) && !current.id,
  });

  /** The list's answer into state; `isCurrent` drops an answer for an unmounted page. */
  const applyList = useCallback(async (isCurrent = () => true) => {
    try {
      const drafts = await readDrafts();
      if (!isCurrent()) return;
      setDrafts(drafts);
      setListError(null);
    } catch (err) {
      if (isCurrent()) setListError(err.message || 'Failed to load drafts.');
    } finally {
      if (isCurrent()) setListLoading(false);
    }
  }, []);

  /** Refresh, and after a write that changes the list: the spinner, then the list. */
  const loadList = useCallback(() => {
    setListLoading(true);
    return applyList();
  }, [applyList]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    (async () => {
      await applyList(() => !cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, applyList]);

  /** Show an API draft view in the editor, as saved. */
  const showDraft = useCallback((draft) => {
    const next = fromDraft(draft);
    setCurrent(draft);
    setForm(next);
    setBaseline(next);
    setConflict(null);
    setActionError(null);
  }, []);

  /** Put a draft view the API answered into the list, newest first. */
  const upsertRow = useCallback((draft) => {
    setDrafts((rows) => [toRow(draft), ...rows.filter((row) => row.id !== draft.id)]);
  }, []);

  const openDraft = useCallback(
    async (id) => {
      setOpening(true);
      setActionError(null);
      try {
        const result = await getJSON(draftRoute(id));
        showDraft(result.draft);
        upsertRow(result.draft);
      } catch (err) {
        setActionError(err.message || 'Failed to open the draft.');
      } finally {
        setOpening(false);
      }
    },
    [showDraft, upsertRow]
  );

  /** Run `next` now, or after the owner agrees to drop unsaved changes. */
  const guardSwitch = (next) => {
    if (dirty) setPendingSwitch(() => next);
    else next();
  };

  const handleSelect = (id) => {
    if (current?.id === id) return;
    guardSwitch(() => openDraft(id));
  };

  const handleNew = () =>
    guardSwitch(() => {
      setCurrent(NEW_DRAFT);
      setForm(EMPTY_FORM);
      setBaseline(EMPTY_FORM);
      setConflict(null);
      setActionError(null);
    });

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * One write. A 412 keeps the owner's text and raises the conflict banner;
   * any other refusal is shown as the API worded it.
   */
  const runWrite = async (name, write, onDone) => {
    setBusy(name);
    setActionError(null);
    try {
      const result = await write();
      setConflict(null);
      await onDone(result);
    } catch (err) {
      if (err.status === 412 || err.code === 'CONFLICT') {
        setConflict(err.message);
      } else {
        setActionError(err.message || 'Something went wrong; nothing was changed.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSave = () => {
    if (!current) return;
    const fields = toPayload(form);
    if (!fields.title) {
      setActionError('Give the draft a title before saving it.');
      return;
    }
    runWrite(
      'save',
      () =>
        current.id
          ? sendJSON(draftRoute(current.id), 'PUT', { fields, etag: current.etag })
          : postJSON(DRAFTS_ROUTE, { fields }),
      ({ draft }) => {
        showDraft(draft);
        upsertRow(draft);
      }
    );
  };

  const handleSendToReview = () => {
    if (!current?.id) return;
    runWrite(
      'send',
      () => postJSON(`${draftRoute(current.id)}/send-to-review`, { etag: current.etag }),
      ({ draft }) => {
        showDraft(draft);
        upsertRow(draft);
        toast({
          title: 'Sent to In Review',
          description: 'It is on the Content Queue under In Review. Nothing was published.',
        });
      }
    );
  };

  /** Back to Drafts, from the editor or from a list row (which carries its own etag). */
  const handleBackToDrafts = (target = current) => {
    if (!target?.id) return;
    const run = () =>
      runWrite(
        'back',
        () => postJSON(`${draftRoute(target.id)}/back-to-drafts`, { etag: target.etag }),
        ({ draft }) => {
          showDraft(draft);
          upsertRow(draft);
          toast({ title: 'Back in Drafts', description: 'It is editable here again.' });
        }
      );
    if (target.id === current?.id) run();
    else guardSwitch(run);
  };

  const handleDeleteClick = () => {
    if (!current) return;
    // The API refuses these too; saying so here spares a confirm that could
    // only end in a refusal.
    if (current.id && !current.actions?.delete) {
      setActionError(
        current.stage === 'live'
          ? LIVE_DELETE_MESSAGE
          : `This article is "${current.contentStatus}", past review, so deleting it here is refused and nothing was changed.`
      );
      return;
    }
    setConfirmDelete(true);
  };

  const handleDeleteConfirmed = () => {
    setConfirmDelete(false);
    if (!current) return;
    if (!current.id) {
      // Never saved: nothing on the server to delete.
      setCurrent(null);
      setForm(EMPTY_FORM);
      setBaseline(EMPTY_FORM);
      return;
    }
    const { id } = current;
    runWrite(
      'delete',
      () => sendJSON(draftRoute(id), 'DELETE', { etag: current.etag }),
      ({ stage }) => {
        setDrafts((rows) => rows.filter((row) => row.id !== id));
        setCurrent(null);
        setForm(EMPTY_FORM);
        setBaseline(EMPTY_FORM);
        toast({
          title: 'Deleted',
          description:
            stage === 'in_review'
              ? 'The draft and its In Review item are gone.'
              : 'The draft is gone.',
        });
      }
    );
  };

  const handleReloadLatest = () => {
    if (current?.id) openDraft(current.id);
    loadList();
  };

  const handleImport = async () => {
    setImporting(true);
    setActionError(null);
    try {
      const result = await postJSON(IMPORT_ROUTE, {});
      setImportResults(result.results || []);
      toast(summarizeImport(result.counts));
      await loadList();
    } catch (err) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const deleteCopy = useMemo(() => {
    if (current?.stage === 'in_review') {
      return {
        title: 'Delete this draft and its In Review item?',
        description:
          'It has been sent to In Review. Deleting it removes it from Drafts and from the Content Queue. This cannot be undone.',
      };
    }
    return {
      title: 'Delete this draft?',
      description: current?.id
        ? 'The draft is removed from the site. This cannot be undone.'
        : 'This draft has never been saved; its text will be discarded.',
    };
  }, [current]);

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Drafts</h1>
          <p className="text-muted-foreground">
            Write articles here and save them from any device. When one is ready, Send to In Review
            puts it on the Content Queue; nothing is published from this page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleNew} className="gap-1">
            <Plus className="h-4 w-4" /> New draft
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleImport}
            disabled={importing}
            className="gap-1"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileInput className="h-4 w-4" />
            )}
            Import from docs/content
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadList}
            disabled={listLoading}
            className="gap-1"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <ImportResults results={importResults} onDismiss={() => setImportResults(null)} />

      {listError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {listError}
        </div>
      )}
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <span>
            {conflict} Your text is still in the editor; copy anything you want to keep before
            reloading.
          </span>
          <Button size="sm" variant="outline" onClick={handleReloadLatest}>
            Reload latest
          </Button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {actionError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <DraftList
          drafts={drafts}
          loading={listLoading}
          selectedId={current?.id || null}
          unsavedNew={Boolean(current) && !current.id}
          busy={Boolean(busy)}
          onSelect={handleSelect}
          onBackToDrafts={handleBackToDrafts}
        />
        <div>
          {opening && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening…
            </p>
          )}
          {!opening && current && (
            <DraftEditor
              draft={current}
              form={form}
              onChange={handleChange}
              saveState={saveState}
              dirty={dirty}
              busy={busy}
              onSave={handleSave}
              onSendToReview={handleSendToReview}
              onDelete={handleDeleteClick}
              onBackToDrafts={() => handleBackToDrafts(current)}
            />
          )}
          {!opening && !current && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Pick a draft on the left, or start one with <strong>New draft</strong>.
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title={deleteCopy.title}
        description={deleteCopy.description}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmModal
        open={Boolean(pendingSwitch)}
        title="Discard unsaved changes?"
        description="This draft has changes that are not saved. Leave it and lose them?"
        confirmLabel="Discard changes"
        onConfirm={() => {
          const next = pendingSwitch;
          setPendingSwitch(null);
          next?.();
        }}
        onCancel={() => setPendingSwitch(null)}
      />
    </div>
  );
}
