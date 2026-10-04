/**
 * One evidence item on the Evidence tab (ADR 0033 §4): what it is, when,
 * from which hub, which programs it counts for, and the actions on it.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { safeUrl } from '@/lib/safeUrl';
import { VERIFICATION_STATUS, sourceLabel } from './ambassadorModel';

/** "every program", or the names of the programs the item counts for. */
function countsFor(item, byId) {
  const ids = item.programIds || [];
  return ids.length === 0 ? 'every program' : ids.map((id) => byId.get(id)?.name || id).join(', ');
}

/** " · 120 attendees · 3,000 views", for the metrics an item carries. */
function metricsText(metrics) {
  const parts = [];
  if (metrics?.attendees) parts.push(`${metrics.attendees} attendees`);
  if (metrics?.views) parts.push(`${metrics.views} views`);
  return parts.map((part) => ` · ${part}`).join('');
}

export default function EvidenceCard({ item, byId, busy, onEdit, onVerify, onDelete }) {
  const url = safeUrl(item.url);
  const verified = item.verificationStatus === 'verified';
  const technology = item.technology?.length ? ` · ${item.technology.join(', ')}` : '';
  return (
    <Card data-testid="evidence-card">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.date || 'undated'} · {sourceLabel(item.sourceModule)}
              {technology}
            </p>
          </div>
          <StatusBadge
            size="xs"
            status={VERIFICATION_STATUS[verified ? 'verified' : 'unverified']}
          />
        </div>
        {item.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Counts for {countsFor(item, byId)}
          {metricsText(item.metrics)}
        </p>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={onEdit}>
            <Pencil className="mr-1 h-3 w-3" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={busy}
            title={verified ? 'Mark unverified' : 'Mark verified'}
            onClick={() => onVerify(verified ? 'unverified' : 'verified')}
          >
            <CheckCircle2 className="mr-1 h-3 w-3" /> {verified ? 'Unverify' : 'Verify'}
          </Button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center rounded-md border border-input px-2 text-xs hover:bg-accent"
            >
              <ExternalLink className="mr-1 h-3 w-3" /> Open
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
            <span className="sr-only">Delete {item.title}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
