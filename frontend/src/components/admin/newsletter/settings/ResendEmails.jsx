/**
 * Recent emails — the Settings tab's view of what Resend has sent (#504).
 *
 *   GET cms/mailing-list/emails?limit&after
 *
 * Read-only. The server masks every recipient (`j***@example.com`) before the
 * page sees it, so no full address reaches the browser from this card.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '../resendFormat';
import { Loading, LoadMore, Notice, StatusBadge, usePagedList } from './resendShared';

function EmailRow({ email }) {
  const recipients = Array.isArray(email.to) ? email.to.filter(Boolean) : [];
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pl-3 pr-3">{recipients.join(', ') || '—'}</td>
      <td className="py-2 pr-3">{email.subject || '—'}</td>
      <td className="whitespace-nowrap py-2 pr-3">{formatDateTime(email.created_at) || '—'}</td>
      <td className="py-2 pr-3">
        <StatusBadge status={email.last_event} />
      </td>
    </tr>
  );
}

export default function ResendEmails() {
  const list = usePagedList('emails', 'emails');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Recent emails</CardTitle>
          <CardDescription>
            What Resend sent most recently, newest first. Recipients are masked by the server.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={list.reload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.error && <Notice>{list.error}</Notice>}
        {list.loading && <Loading>Loading emails…</Loading>}
        {!list.loading && !list.error && list.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No emails yet.</p>
        )}
        {!list.loading && list.rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pl-3 pr-3 font-medium">To</th>
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 pr-3 font-medium">Last event</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((email, index) => (
                  <EmailRow key={email.id || `row-${index}`} email={email} />
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
