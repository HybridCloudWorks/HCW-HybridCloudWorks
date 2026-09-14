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
 * Search is server-side but filters ONE page (`searchScope: 'page'`): Resend
 * has no contact search, so the server matches within the page it read, and
 * Load more continues Resend's paging with the same filter. The box says so.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { getJSON, sendJSON } from '@/lib/api';
import AudienceRow from './AudienceRow';
import AudienceSummary from './AudienceSummary';
import { describeResendError } from './resendFormat';

export const AUDIENCE_PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 300;

const ROUTE = 'cms/mailing-list/audience';

/** The list route for one page, with the search and cursor when there are any. */
export function audienceRoute({ search = '', after = null } = {}) {
  const params = new URLSearchParams({ limit: String(AUDIENCE_PAGE_SIZE) });
  if (after) params.set('after', after);
  const needle = search.trim();
  if (needle) params.set('search', needle);
  return `${ROUTE}?${params.toString()}`;
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
function useAudienceList(search) {
  const [page, setPage] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (after) => {
      const mine = generation.current;
      const res = await getJSON(audienceRoute({ search, after }));
      if (mine !== generation.current) return;
      setPage((previous) => ({
        contacts: [...(after ? previous.contacts : []), ...(res.contacts || [])],
        hasMore: Boolean(res.has_more && res.next_after),
        nextAfter: res.next_after ?? null,
        segmentFound: res.segmentFound !== false,
      }));
      setError('');
    },
    [search]
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

function ContactsTable({ contacts, busyId, onToggle, onRemove }) {
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
              busy={busyId === contact.id}
              onToggle={onToggle}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NewsletterAudience() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const summary = useAudienceSummary();
  const list = useAudienceList(search);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  /** Run a write for one contact, then apply it to the loaded rows and recount. */
  const act = async (contact, write, apply) => {
    setBusyId(contact.id);
    setActionError('');
    try {
      await write();
      list.setPage((previous) => ({ ...previous, contacts: apply(previous.contacts) }));
      summary.refresh();
    } catch (err) {
      setActionError(describeResendError(err));
    } finally {
      setBusyId(null);
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

  const { page } = list;
  const showEmpty = !list.loading && !list.error;

  return (
    <div className="space-y-4">
      <AudienceSummary summary={summary.summary} error={summary.error} />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="w-full max-w-sm space-y-1">
          <label htmlFor="audience-search" className="text-xs font-medium">
            Search by email
          </label>
          <Input
            id="audience-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">
            Searches the contacts loaded in each page, not the whole list. Use Load more to look
            further.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={list.reload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {actionError && <Notice>{actionError}</Notice>}
      {list.error && <Notice>{list.error}</Notice>}

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
          busyId={busyId}
          onToggle={toggle}
          onRemove={remove}
        />
      )}

      {!list.loading && page.hasMore && (
        <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}
