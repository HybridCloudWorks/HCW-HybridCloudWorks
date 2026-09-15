/**
 * The two event tables (#573), moved from SpeakingEventsPage.jsx: Sessionize
 * events with their stored override, and manual (stored-only) entries. Each
 * tab passes the rows it owns; Past adds a column of slide and event links.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatShortDate, httpUrl, safeString } from './eventModel';

const TH = 'text-left px-4 py-2.5 font-medium text-muted-foreground';

export function SectionHeading({ children }) {
  return (
    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
      {children}
    </h2>
  );
}

/** `label` names the row, so each delete control has its own accessible name. */
function DeleteButton({ docId, editor, label }) {
  const busy = editor.deleting === docId;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
      onClick={() => editor.remove(docId)}
      disabled={busy}
      aria-label={label}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </Button>
  );
}

/** Slides and event page, as links, for a delivered session. */
export function LinksCell({ fd }) {
  // Only http(s) becomes a link: a stored `javascript:` value must not run.
  const slides = httpUrl(fd?.presentationUrl);
  const event = httpUrl(fd?.eventUrl);
  if (!slides && !event) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {slides && (
        <a href={slides} target="_blank" rel="noopener noreferrer" className="underline">
          Slides
        </a>
      )}
      {event && (
        <a href={event} target="_blank" rel="noopener noreferrer" className="underline">
          Event page
        </a>
      )}
    </div>
  );
}

function OverrideCell({ fd }) {
  if (!fd) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground w-fit">
        API only
      </Badge>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="outline" className="text-xs text-green-600 border-green-300 w-fit gap-1">
        <Check className="h-3 w-3" /> Enriched
      </Badge>
      <div className="flex gap-1.5">
        <ImageIcon
          className={`h-3 w-3 ${fd.eventImageUrl ? 'text-blue-400' : 'text-muted-foreground/25'}`}
          title={fd.eventImageUrl ? 'Has image' : 'No image'}
        />
        {fd.eventUrl && <LinkIcon className="h-3 w-3 text-blue-400" title="Has event URL" />}
        {fd.presentationUrl && (
          <ExternalLink className="h-3 w-3 text-purple-400" title="Has presentation" />
        )}
        {fd.display === false && (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 ml-0.5">
            hidden
          </Badge>
        )}
      </div>
    </div>
  );
}

function SessionizeRow({ ev, editor, showLinks }) {
  const fd = ev._storedDoc;
  const isEditing = editor.editingEvent?.id === ev.id;
  return (
    <tr
      className={`transition-colors ${isEditing ? 'bg-blue-50 dark:bg-blue-950/20' : 'hover:bg-muted/30'}`}
    >
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{ev.id}</td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
        {formatShortDate(ev.date)}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium leading-snug">{ev.name}</div>
        {fd?.description && (
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{fd.description}</div>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs max-w-44 truncate">
        {safeString(fd?.location) || safeString(ev.location) || '—'}
      </td>
      <td className="px-4 py-3">
        <OverrideCell fd={fd} />
      </td>
      {showLinks && (
        <td className="px-4 py-3">
          <LinksCell fd={fd} />
        </td>
      )}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="sm"
            variant={fd ? 'ghost' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={() => editor.openEnrich(ev)}
            disabled={isEditing}
          >
            <Pencil className="h-3 w-3 mr-1" />
            {fd ? 'Edit' : 'Enrich'}
          </Button>
          {fd && (
            <DeleteButton
              docId={fd._docId}
              editor={editor}
              label={`Delete stored override for ${safeString(ev.name) || `Sessionize #${ev.id}`}`}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

export function SessionizeEventsTable({ rows, editor, showLinks = false }) {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className={`${TH} w-16`}>ID</th>
            <th className={`${TH} w-28`}>Date</th>
            <th className={TH}>Event Name</th>
            <th className={`${TH} hidden lg:table-cell w-44`}>Location</th>
            <th className={`${TH} w-28`}>Stored override</th>
            {showLinks && <th className={`${TH} w-28`}>Links</th>}
            <th className="px-4 py-2.5 w-24" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((ev) => (
            <SessionizeRow key={ev.id} ev={ev} editor={editor} showLinks={showLinks} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualRow({ fd, editor, showLinks }) {
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
        {formatShortDate(fd.date)}
      </td>
      <td className="px-4 py-3 font-medium">{fd.eventName || fd.name || '—'}</td>
      <td className="px-4 py-3">
        <Badge
          variant="outline"
          className={`text-xs w-fit ${fd.display ? 'text-green-600 border-green-300' : 'text-muted-foreground'}`}
        >
          {fd.display ? 'Visible' : 'Hidden'}
        </Badge>
      </td>
      {showLinks && (
        <td className="px-4 py-3">
          <LinksCell fd={fd} />
        </td>
      )}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs"
            onClick={() => editor.openEditManual(fd)}
          >
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
          <DeleteButton
            docId={fd._docId}
            editor={editor}
            label={`Delete manual entry ${safeString(fd.eventName) || safeString(fd.name) || fd._docId}`}
          />
        </div>
      </td>
    </tr>
  );
}

export function ManualEntriesTable({ rows, editor, showLinks = false }) {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className={`${TH} w-28`}>Date</th>
            <th className={TH}>Name</th>
            <th className={TH}>Display</th>
            {showLinks && <th className={TH}>Links</th>}
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((fd) => (
            <ManualRow key={fd._docId} fd={fd} editor={editor} showLinks={showLinks} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
