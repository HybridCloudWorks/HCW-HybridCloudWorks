/**
 * The editable metadata in ImageDetailsDialog (ADR 0033), rendered from
 * FIELD_SPECS, and the row of actions under it: save, archive or restore,
 * trash, delete.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FIELD_SPECS, selectClass, selectOptions } from './imageDetailsFields';

function FieldControl({ spec, value, onChange, folders }) {
  if (spec.kind === 'textarea') {
    return <Textarea id={spec.id} value={value} onChange={onChange} rows={spec.rows} />;
  }
  if (spec.kind === 'select') {
    return (
      <select id={spec.id} value={value} onChange={onChange} className={selectClass}>
        {selectOptions(spec, { folders, value }).map((o) => (
          <option key={o.value || 'none'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      id={spec.id}
      value={value}
      onChange={onChange}
      placeholder={spec.placeholder}
      className={spec.className}
    />
  );
}

export function ImageDetailsFields({ fields, setField, folders }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FIELD_SPECS.map((spec) => (
        <div key={spec.key} className={spec.span ? 'sm:col-span-2' : undefined}>
          <label htmlFor={spec.id} className="text-xs font-medium">
            {spec.label}
          </label>
          <FieldControl
            spec={spec}
            value={fields[spec.key]}
            onChange={setField(spec.key)}
            folders={folders}
          />
        </div>
      ))}
    </div>
  );
}

/** Archive and trash for a live image; restore for one that is archived or trashed. */
function StateActions({ state, busy, onRestore, onArchive, onTrash }) {
  if (state) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={onRestore} disabled={busy}>
        Restore
      </Button>
    );
  }
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={onArchive} disabled={busy}>
        Archive
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onTrash} disabled={busy}>
        Move to trash
      </Button>
    </>
  );
}

export function ImageDetailsActions({
  state,
  busy,
  onSave,
  onRestore,
  onArchive,
  onTrash,
  onDeleteRequest,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={onSave} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}{' '}
        Save changes
      </Button>
      <StateActions
        state={state}
        busy={busy}
        onRestore={onRestore}
        onArchive={onArchive}
        onTrash={onTrash}
      />
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={onDeleteRequest}
        disabled={busy}
      >
        Delete permanently
      </Button>
    </div>
  );
}
