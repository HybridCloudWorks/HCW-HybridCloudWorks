/**
 * NewsletterAudience — the Audience tab of the Mailing List page (#504).
 *
 * The Newsletter segment in Resend: counts, then the contacts a page at a
 * time. Reads need editor; the row actions write to Resend and need publisher,
 * and they are shown to everyone so that a 403 can say so in the server's
 * words rather than the page guessing at a role.
 *
 *   GET    cms/mailing-list/audience/summary
 *   GET    cms/mailing-list/audience?limit&after&search
 *   PATCH  cms/mailing-list/audience/{contactId}  { unsubscribed }
 *   DELETE cms/mailing-list/audience/{contactId}
 *
 * A contact is addressed ONLY by its Resend id. A path is recorded in request
 * telemetry, so an address in one would put a subscriber in the logs.
 *
 * Search is server-side and, by default, filters ONE page (`searchScope:
 * 'page'`): Resend has no contact search, so the server matches within the
 * page it read, and Load more continues Resend's paging with the same filter.
 * "Search the whole list" asks the server to page every contact instead
 * (`scope=all`), which is slower and says so (ADR 0033 Amplify slice).
 *
 * Also here (ADR 0033): Export CSV (GET cms/mailing-list/audience/export,
 * publisher — every address in one file) and Add subscriber (POST
 * cms/mailing-list/audience): either a confirmation link, respecting double
 * opt-in, or a confirmed add with the date consent was recorded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Download, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { authedFetch, getJSON, postJSON, sendJSON } from '@/lib/api';
import AudienceRow from './AudienceRow';
import AudienceSummary from './AudienceSummary';
import { describeResendError } from './resendFormat';

export const AUDIENCE_PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 300;

const ROUTE = 'cms/mailing-list/audience';
export const EXPORT_ROUTE = `${ROUTE}/export`;

/** The list route for one page, with the search and cursor when there are any; `scope: 'all'` searches every page. */
export function audienceRoute({ search = '', after = null, scope = 'page' } = {}) {
  const params = new URLSearchParams({ limit: String(AUDIENCE_PAGE_SIZE) });
  if (after) params.set('after', after);
  const needle = search.trim();
  if (needle) params.set('search', needle);
  if (needle && scope === 'all') params.set('scope', 'all');
  return `${ROUTE}?${params.toString()}`;
}

/** Download the CSV the server builds: a blob from an authenticated GET, saved under the server's file name. */
export async function downloadAudienceCsv() {
  const res = await authedFetch(EXPORT_ROUTE, { method: 'GET' });
  if (!res.ok) {
    let message = `Export failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // the status is the message
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  const text = await res.text();
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  const name = match ? match[1] : 'newsletter-audience.csv';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return name;
}

/** Add one subscriber: a confirmation link (double opt-in), or a confirmed add with recorded consent. */
function AddSubscriberDialog({ onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('invite');
  const [consentRecordedOn, setConsentRecordedOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'confirmed' && !consentRecordedOn) {
      setError('Enter the date consent was given. A confirmed add without it is not allowed.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await postJSON(ROUTE, {
        email: email.trim(),
        mode,
        ...(mode === 'confirmed' ? { consentRecordedOn } : {}),
      });
      onAdded(res?.message || 'Done.');
    } catch (err) {
      setError(describeResendError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a subscriber</DialogTitle>
            <DialogDescription>
              Send a confirmation link, which respects double opt-in, or add the address as
              confirmed when consent was recorded elsewhere.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="audience-add-email">Email</Label>
            <Input
              id="audience-add-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">How</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience-add-mode"
                value="invite"
                checked={mode === 'invite'}
                onChange={() => setMode('invite')}
                className="mt-1"
              />
              <span>
                <strong>Send a confirmation link.</strong> Nothing is added until they open it.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience-add-mode"
                value="confirmed"
                checked={mode === 'confirmed'}
                onChange={() => setMode('confirmed')}
                className="mt-1"
              />
              <span>
                <strong>Add as confirmed.</strong> Consent was recorded elsewhere, on the date
                below.
              </span>
            </label>
          </fieldset>
          {mode === 'confirmed' && (
            <div className="space-y-1.5">
              <Label htmlFor="audience-add-consent">Consent recorded on</Label>
              <Input
                id="audience-add-consent"
                type="date"
                required
                value={consentRecordedOn}
                onChange={(event) => setConsentRecordedOn(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'invite' ? 'Send the link' : 'Add as confirmed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const contactRoute = (id) => `${ROUTE}/${encodeURIComponent(id)}`;

/** The search box's value, settled for SEARCH_DEBOUNCE_MS. */
function useDebounced(value) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

function useAudienceSummary() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const res = await getJSON(`${ROUTE}/summary`);
      setSummary(res);
      setError('');
    } catch (err) {
      setError(describeResendError(err));
    }
  }, []);
  useEffect(() => {
    queueMicrotask(refresh);
  }, [refresh]);
  return { summary, error, refresh };
}

const EMPTY_PAGE = { contacts: [], hasMore: false, nextAfter: null, segmentFound: true };

/** The loaded contacts for a search, and Load more. A newer search wins over a slower older one. */
function useAudienceList(search, scope) {
  const [page, setPage] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (after) => {
      const mine = generation.current;
      const res = await getJSON(audienceRoute({ search, after, scope }));
      if (mine !== generation.current) return;
      setPage((previous) => ({
        contacts: [...(after ? previous.contacts : []), ...(res.contacts || [])],
        hasMore: Boolean(res.has_more && res.next_after),
        nextAfter: res.next_after ?? null,
        segmentFound: res.segmentFound !== false,
        searchScope: res.searchScope || 'page',
        truncated: res.truncated === true,
      }));
      setError('');
    },
    [search, scope]
  );

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setLoading(true);
    try {
      await fetchPage(null);
    } catch (err) {
      if (mine === generation.current) {
        setPage(EMPTY_PAGE);
        setError(describeResendError(err));
      }
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    queueMicrotask(reload);
  }, [reload]);

  const loadMore = async () => {
    if (!page.nextAfter) return;
    setLoadingMore(true);
    try {
      await fetchPage(page.nextAfter);
    } catch (err) {
      setError(describeResendError(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return { page, setPage, loading, loadingMore, error, reload, loadMore };
}

function Notice({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}

function ContactsTable({ contacts, busyIds, onToggle, onRemove }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-2 pl-3 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Joined</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="[&_td:first-child]:pl-3 [&_td:last-child]:pr-3">
          {contacts.map((contact) => (
            <AudienceRow
              key={contact.id}
              contact={contact}
              busy={busyIds.has(contact.id)}
              onToggle={onToggle}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The search box, the whole-list switch and the three actions. */
function AudienceToolbar({
  searchInput,
  onSearch,
  wholeList,
  onWholeList,
  onAdd,
  onExport,
  exporting,
  onReload,
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="w-full max-w-sm space-y-1">
        <label htmlFor="audience-search" className="text-xs font-medium">
          Search by email
        </label>
        <Input
          id="audience-search"
          type="search"
          value={searchInput}
          onChange={(event) => onSearch(event.target.value)}
          maxLength={100}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={wholeList}
            onChange={(event) => onWholeList(event.target.checked)}
          />
          Search the whole list (slower: every page is read)
        </label>
        <p className="text-xs text-muted-foreground">
          {wholeList
            ? 'Every match across the list is shown.'
            : 'Searches the contacts loaded in each page, not the whole list. Use Load more to look further.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={onAdd}>
          <UserPlus className="h-4 w-4" /> Add subscriber
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={onExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}{' '}
          Export CSV
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={onReload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
    </div>
  );
}

/** The list itself: loading, the empty cases, the table and Load more. */
function AudienceBody({ list, search, busyIds, onToggle, onRemove }) {
  const { page } = list;
  const showEmpty = !list.loading && !list.error;
  return (
    <>
      {list.loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscribers…
        </p>
      )}

      {showEmpty && !page.segmentFound && (
        <p className="text-sm text-muted-foreground">
          No subscribers yet. The Newsletter list is created by the first confirmed signup.
        </p>
      )}

      {showEmpty && page.segmentFound && page.contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {search.trim() ? 'No contact on this page matches that search.' : 'No contacts.'}
        </p>
      )}

      {!list.loading && page.contacts.length > 0 && (
        <ContactsTable
          contacts={page.contacts}
          busyIds={busyIds}
          onToggle={onToggle}
          onRemove={onRemove}
        />
      )}

      {!list.loading && page.hasMore && (
        <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </>
  );
}

export default function NewsletterAudience() {
  const [searchInput, setSearchInput] = useState('');
  const [wholeList, setWholeList] = useState(false);
  const search = useDebounced(searchInput);
  const summary = useAudienceSummary();
  const list = useAudienceList(search, wholeList ? 'all' : 'page');
  // One entry per write in flight, so a second row's action cannot re-enable
  // a row whose own write has not finished.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [actionError, setActionError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  const exportCsv = async () => {
    setExporting(true);
    setActionError('');
    try {
      const name = await downloadAudienceCsv();
      setNotice(`Downloaded ${name}.`);
    } catch (err) {
      setActionError(describeResendError(err));
    } finally {
      setExporting(false);
    }
  };

  /** Run a write for one contact, then apply it to the loaded rows and recount. */
  const act = async (contact, write, apply) => {
    setBusyIds((previous) => new Set(previous).add(contact.id));
    setActionError('');
    try {
      await write();
      list.setPage((previous) => ({ ...previous, contacts: apply(previous.contacts) }));
      summary.refresh();
    } catch (err) {
      setActionError(describeResendError(err));
    } finally {
      setBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(contact.id);
        return next;
      });
    }
  };

  const toggle = (contact) => {
    const unsubscribed = !contact.unsubscribed;
    return act(
      contact,
      () => sendJSON(contactRoute(contact.id), 'PATCH', { unsubscribed }),
      (rows) => rows.map((row) => (row.id === contact.id ? { ...row, unsubscribed } : row))
    );
  };

  const remove = (contact) =>
    act(
      contact,
      () => sendJSON(contactRoute(contact.id), 'DELETE'),
      (rows) => rows.filter((row) => row.id !== contact.id)
    );

  return (
    <div className="space-y-4">
      <AudienceSummary summary={summary.summary} error={summary.error} />

      <AudienceToolbar
        searchInput={searchInput}
        onSearch={setSearchInput}
        wholeList={wholeList}
        onWholeList={setWholeList}
        onAdd={() => setAdding(true)}
        onExport={exportCsv}
        exporting={exporting}
        onReload={list.reload}
      />

      {notice && (
        <p role="status" className="text-sm text-emerald-600">
          {notice}
        </p>
      )}
      {actionError && <Notice>{actionError}</Notice>}
      {list.error && <Notice>{list.error}</Notice>}
      {list.page.truncated && (
        <p role="status" className="text-xs text-muted-foreground">
          The list is longer than the server searches in one go, so some matches may be missing.
        </p>
      )}

      <AudienceBody
        list={list}
        search={search}
        busyIds={busyIds}
        onToggle={toggle}
        onRemove={remove}
      />

      {adding && (
        <AddSubscriberDialog
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setAdding(false);
            setNotice(message);
            summary.refresh();
            list.reload();
          }}
        />
      )}
    </div>
  );
}
