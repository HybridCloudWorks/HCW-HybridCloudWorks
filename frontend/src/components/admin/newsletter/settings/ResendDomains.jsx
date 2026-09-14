/**
 * Sending domains — the domains Resend sends the newsletter from (#504).
 *
 *   GET  cms/mailing-list/domains
 *   POST cms/mailing-list/domains  { name, region }   publisher
 *
 * Each domain expands into DomainDetail (records, Verify, tracking). The list
 * route carries no tracking fields, so a domain's open and click tracking are
 * shown once its detail has been loaded, rather than reading every domain's
 * detail up front against Resend's rate limit.
 *
 * There is deliberately no delete: the API has none, because removing a
 * sending domain stops the newsletter. That stays in Resend's dashboard.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { describeResendError } from '../resendFormat';
import DomainAddForm from './DomainAddForm';
import DomainDetail from './DomainDetail';
import { Loading, Notice, RESEND_ROUTE, StatusBadge } from './resendShared';

const SUMMARY_FIELDS = ['id', 'name', 'status', 'region', 'created_at'];
const summaryOf = (domain) =>
  Object.fromEntries(
    SUMMARY_FIELDS.filter((key) => key in domain).map((key) => [key, domain[key]])
  );

const ON_OFF = new Map([
  [true, 'on'],
  [false, 'off'],
]);
const onOff = (value) => ON_OFF.get(value) ?? '?';

function TrackingSummary({ detail }) {
  if (!detail) return <span className="text-xs text-muted-foreground">Tracking: open to see</span>;
  return (
    <span className="text-xs text-muted-foreground">
      Open tracking {onOff(detail.open_tracking)} · Click tracking {onOff(detail.click_tracking)}
    </span>
  );
}

function DomainItem({ domain, detail, open, onToggle, onDetail }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const setDetail = useCallback((value) => onDetail(domain.id, value), [domain.id, onDetail]);
  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => onToggle(domain.id)}
      >
        <Chevron className="h-4 w-4 shrink-0" />
        <span className="font-medium">{domain.name || domain.id}</span>
        <StatusBadge status={detail?.status ?? domain.status} />
        <span className="text-xs text-muted-foreground">{domain.region || '—'}</span>
        <TrackingSummary detail={detail} />
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <DomainDetail id={domain.id} domain={detail} onLoaded={setDetail} />
        </div>
      )}
    </li>
  );
}

function useDomains() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getJSON(`${RESEND_ROUTE}/domains`);
      setDomains(Array.isArray(res?.domains) ? res.domains : []);
      setError('');
    } catch (err) {
      // A failed refresh must not leave the last list looking current.
      setDomains([]);
      setError(describeResendError(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(reload);
  }, [reload]);
  return { domains, setDomains, loading, error, reload };
}

export default function ResendDomains() {
  const list = useDomains();
  const [details, setDetails] = useState({});
  const [openId, setOpenId] = useState(null);

  /** Store a detail, or apply an updater to the one held. */
  const putDetail = useCallback((id, value) => {
    setDetails((previous) => ({
      ...previous,
      [id]: typeof value === 'function' ? value(previous[id]) : value,
    }));
  }, []);

  const toggle = (id) => setOpenId((current) => (current === id ? null : id));

  /**
   * Re-read the list and drop every held detail, so no cached status or record
   * outlives a refresh; an open domain loads its detail again.
   */
  const refresh = () => {
    setDetails({});
    return list.reload();
  };

  const added = (domain) => {
    if (!domain?.id) {
      refresh();
      return;
    }
    list.setDomains((previous) => [
      ...previous.filter((row) => row.id !== domain.id),
      summaryOf(domain),
    ]);
    putDetail(domain.id, domain);
    setOpenId(domain.id);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Sending domains</CardTitle>
          <CardDescription>
            The domains Resend sends from. Open one for its DNS records, verification and tracking.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={refresh}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.error && <Notice>{list.error}</Notice>}
        {list.loading && <Loading>Loading domains…</Loading>}
        {!list.loading && !list.error && list.domains.length === 0 && (
          <p className="text-sm text-muted-foreground">No sending domain has been added yet.</p>
        )}
        {list.domains.length > 0 && (
          <ul className="space-y-2">
            {list.domains.map((domain) => (
              <DomainItem
                key={domain.id}
                domain={domain}
                detail={details[domain.id]}
                open={openId === domain.id}
                onToggle={toggle}
                onDetail={putDetail}
              />
            ))}
          </ul>
        )}
        <DomainAddForm onAdded={added} />
        <p className="text-xs text-muted-foreground">
          Deleting a domain is done in Resend, because it stops the newsletter sending:{' '}
          <a
            href="https://resend.com/domains"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            resend.com/domains <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
