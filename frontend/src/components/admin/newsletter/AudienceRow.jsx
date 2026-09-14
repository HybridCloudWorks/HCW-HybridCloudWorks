/**
 * One contact on the Audience tab (#504), with its publisher-only actions.
 *
 * Unsubscribe and Resubscribe are reversible, so they act on one click.
 * Remove deletes the contact from Resend altogether and cannot be undone, so
 * it asks first, inline, rather than in a dialog that hides the row it names.
 * The parent does the calls by `contact.id`; this component never touches an
 * address beyond showing it.
 */
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { formatDate } from './resendFormat';

const fullName = (contact) =>
  [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—';

function RowActions({ contact, busy, onToggle, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs">Remove from Resend? This deletes the contact.</span>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            onRemove(contact);
          }}
        >
          Yes, remove
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-label="Working" />}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onToggle(contact)}>
        {contact.unsubscribed ? 'Resubscribe' : 'Unsubscribe'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
        Remove
      </Button>
    </div>
  );
}

export default function AudienceRow({ contact, busy, onToggle, onRemove }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3">{contact.email || '—'}</td>
      <td className="py-2 pr-3">{fullName(contact)}</td>
      <td className="whitespace-nowrap py-2 pr-3">{formatDate(contact.created_at) || '—'}</td>
      <td className="py-2 pr-3">
        {contact.unsubscribed ? (
          <Badge variant="secondary">Unsubscribed</Badge>
        ) : (
          <Badge>Subscribed</Badge>
        )}
      </td>
      <td className="py-2">
        <RowActions contact={contact} busy={busy} onToggle={onToggle} onRemove={onRemove} />
      </td>
    </tr>
  );
}
