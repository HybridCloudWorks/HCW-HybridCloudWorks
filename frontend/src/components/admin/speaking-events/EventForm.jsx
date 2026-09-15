/**
 * The override form (#573), moved from SpeakingEventsPage.jsx. A Sessionize
 * event takes only what Sessionize does not provide; a manual entry also
 * takes its name and date. Rendered by whichever tab is open while an edit is.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Check, Loader2, X } from 'lucide-react';
import { formatShortDate } from './eventModel';

const INPUT = 'w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background';

function Field({ id, label, className = 'space-y-1', children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function TextField({ id, label, type = 'text', placeholder, value, onChange }) {
  return (
    <Field id={id} label={label}>
      <input
        type={type}
        className={INPUT}
        placeholder={placeholder}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * An override enriches a Sessionize row, so it says so only when one is attached.
 * A manual entry has none; editing an existing document without its Sessionize
 * row cannot tell which it is, so that heading stays neutral.
 */
export function formTitle(editingId, editingEvent) {
  const isNew = editingId === 'new';
  if (editingEvent) return isNew ? 'New Override' : 'Edit Override';
  return isNew ? 'New Manual Entry' : 'Edit Event';
}

function FormHeading({ editingId, editingEvent, onClose }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h3 className="font-semibold text-sm">{formTitle(editingId, editingEvent)}</h3>
        {editingEvent && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Sessionize #{editingEvent.id} · {editingEvent.name}
            {editingEvent.date && <> · {formatShortDate(editingEvent.date)}</>}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close editor"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function ManualFields({ form, set }) {
  return (
    <>
      <TextField
        id="speaking-event-name"
        label="Event Name *"
        placeholder="Event name as shown on site"
        value={form._manualName || ''}
        onChange={set('_manualName')}
      />
      <TextField
        id="speaking-event-date"
        label="Date"
        type="date"
        value={form._manualDate || ''}
        onChange={set('_manualDate')}
      />
    </>
  );
}

function OverrideFields({ form, set }) {
  return (
    <>
      <Field
        id="speaking-event-description"
        label="Description"
        className="space-y-1 md:col-span-2"
      >
        <textarea
          rows={3}
          className={`${INPUT} resize-none`}
          placeholder="Override the Sessionize description, or add one if missing"
          id="speaking-event-description"
          value={form.description}
          onChange={(e) => set('description')(e.target.value)}
        />
      </Field>
      <TextField
        id="speaking-event-location"
        label="Location override"
        placeholder="e.g. Chicago, IL or Virtual"
        value={form.location}
        onChange={set('location')}
      />
      <TextField
        id="speaking-event-url"
        label="Event URL override"
        type="url"
        placeholder="https://..."
        value={form.eventUrl}
        onChange={set('eventUrl')}
      />
      <TextField
        id="speaking-event-presentation-url"
        label="Presentation URL"
        type="url"
        placeholder="https://..."
        value={form.presentationUrl}
        onChange={set('presentationUrl')}
      />
      <TextField
        id="speaking-event-image-url"
        label="Event Image URL"
        type="url"
        placeholder="https://example.com/event-image.jpg"
        value={form.eventImageUrl}
        onChange={set('eventImageUrl')}
      />
      <div className="flex items-center gap-2 self-end">
        <input
          type="checkbox"
          id="display-toggle"
          checked={form.display}
          onChange={(e) => set('display')(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="display-toggle" className="text-sm">
          Show on site
        </label>
      </div>
    </>
  );
}

export default function EventForm({ editor }) {
  const { editingId, editingEvent, form, setForm, saving, save, close } = editor;
  const isManual = !editingEvent;
  const canSave = isManual ? Boolean((form._manualName || '').trim()) : true;
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Card className="border-2 border-slate-blue/30">
      <CardContent className="pt-5 space-y-4">
        <FormHeading editingId={editingId} editingEvent={editingEvent} onClose={close} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {isManual && <ManualFields form={form} set={set} />}
          <OverrideFields form={form} set={set} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={save} disabled={Boolean(saving) || !canSave}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={close}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
