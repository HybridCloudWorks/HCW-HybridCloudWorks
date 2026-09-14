/**
 * API logs — Resend's record of the calls made with this site's key (#504).
 *
 *   GET cms/mailing-list/logs?limit&after
 *   GET cms/mailing-list/logs/{logId}      publisher
 *
 * The list is for editors. Opening a row asks for the request and response
 * bodies, which the server has already redacted of credentials and addresses;
 * that route is publisher-only, and a 403 is shown in the server's words.
 *
 * The bodies are shown as pretty-printed JSON TEXT inside <pre>, never as
 * HTML: a body is whatever was sent to Resend, and an email's html field is
 * exactly the kind of value that must not be rendered here.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { describeResendError, formatDateTime } from '../resendFormat';
import { Loading, LoadMore, Notice, RESEND_ROUTE, usePagedList } from './resendShared';

const STATUS_CLASSES = {
  '2xx': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  '4xx': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  '5xx': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  other: 'bg-muted text-muted-foreground',
};

/** `2xx`, `4xx`, `5xx`, or `other` for an HTTP status. */
export function statusClass(status) {
  const code = Number(status);
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500 && code < 600) return '5xx';
  return 'other';
}

/** A body as indented JSON text; a string body is shown as it is. */
export function prettyBody(body) {
  if (body === null || body === undefined) return '(empty)';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function HttpStatus({ status }) {
  const group = statusClass(status);
  return (
    <span
      data-status-group={group}
      className={`inline-flex rounded px-2 py-0.5 font-mono text-xs ${STATUS_CLASSES[group]}`}
    >
      {status ?? '—'}
    </span>
  );
}

function BodyPanel({ title, body }) {
  return (
    <details open className="rounded border border-border">
      <summary className="cursor-pointer px-3 py-1 text-xs font-medium">{title}</summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-xs">
        {prettyBody(body)}
      </pre>
    </details>
  );
}

function LogDetail({ id }) {
  const [state, setState] = useState({ loading: true, error: '', log: null });
  useEffect(() => {
    let live = true;
    getJSON(`${RESEND_ROUTE}/logs/${encodeURIComponent(id)}`)
      .then((res) => live && setState({ loading: false, error: '', log: res?.log ?? null }))
      .catch(
        (err) => live && setState({ loading: false, error: describeResendError(err), log: null })
      );
    return () => {
      live = false;
    };
  }, [id]);

  if (state.loading) return <Loading>Loading the log…</Loading>;
  if (state.error) return <Notice>{state.error}</Notice>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Credentials and email addresses are redacted by the server.
      </p>
      <BodyPanel title="Request body" body={state.log?.request_body} />
      <BodyPanel title="Response body" body={state.log?.response_body} />
    </div>
  );
}

function LogRow({ log, open, onToggle }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="whitespace-nowrap py-2 pl-3 pr-3">
          {formatDateTime(log.created_at) || '—'}
        </td>
        <td className="py-2 pr-3 font-mono text-xs">{log.method || '—'}</td>
        <td className="py-2 pr-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left font-mono text-xs hover:underline"
            aria-expanded={open}
            disabled={!log.id}
            onClick={() => onToggle(log.id)}
          >
            <Chevron className="h-3 w-3 shrink-0" />
            {log.endpoint || '—'}
          </button>
        </td>
        <td className="py-2 pr-3">
          <HttpStatus status={log.response_status} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border">
          <td colSpan={4} className="bg-muted/30 px-3 py-3">
            <LogDetail id={log.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResendLogs() {
  const list = usePagedList('logs', 'logs');
  const [openId, setOpenId] = useState(null);
  const toggle = (id) => setOpenId((current) => (current === id ? null : id));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">API logs</CardTitle>
          <CardDescription>
            Calls made to Resend with this site&apos;s key. Open an endpoint to see its request and
            response bodies (publisher).
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={list.reload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.error && <Notice>{list.error}</Notice>}
        {list.loading && <Loading>Loading logs…</Loading>}
        {!list.loading && !list.error && list.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No API calls logged yet.</p>
        )}
        {!list.loading && list.rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pl-3 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 pr-3 font-medium">Endpoint</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((log, index) => (
                  <LogRow
                    key={log.id || `row-${index}`}
                    log={log}
                    open={Boolean(log.id) && openId === log.id}
                    onToggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore list={list} />
      </CardContent>
    </Card>
  );
}
