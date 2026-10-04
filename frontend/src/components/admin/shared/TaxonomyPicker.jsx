/**
 * TaxonomyPicker — the two classification questions every content record can
 * answer (ADR 0033 §4): what will this become (`kind`), and how did it become
 * an idea (`ideaOrigin`).
 *
 * The same control on Submit URLs, the Drafts editor, the Forge-from-URL box
 * and the review page, so the vocabulary is learned once. Native selects:
 * keyboard-operable, labelled, and no portal to fight inside a form. The
 * entry's description is the helper text under each select, and one sentence
 * says why the choice matters — the classification decides which downstream
 * tools fit (an audiobook chapter goes to Listen & Learn, a social post to
 * the Social Hub, a newsletter block to the Newsletter Hub).
 *
 * Loading: the selects are disabled and say so. Error: the defaults are
 * offered and the error is shown; nothing is blocked.
 */
import React, { useId } from 'react';
import { Label } from '@/components/ui/label';
import { enabledEntries } from '@/lib/taxonomy';
import { useTaxonomy } from './useTaxonomy';

export const WHY_IT_MATTERS =
  'The classification decides which tools fit downstream: an audiobook chapter goes to Listen & Learn, a social post to the Social Hub, a newsletter block to the Newsletter Hub.';

const SELECT_CLASS =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';

function Picker({ id, label, value, entries, loading, disabled, onChange, compact }) {
  const current = entries.find((entry) => entry.id === value);
  // A stored id that is disabled (or unknown) is still shown, named, so the
  // owner sees what the record carries rather than a silently changed value.
  const extra = value && !current ? [{ id: value, label: `${value} (disabled)` }] : [];
  return (
    <div className={compact ? 'min-w-40' : ''}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <select
        id={id}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={SELECT_CLASS}
      >
        {loading && <option value={value || ''}>Loading…</option>}
        {!loading &&
          [...extra, ...entries].map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
      </select>
      {!compact && current?.description && (
        <p className="mt-1 text-xs text-muted-foreground">{current.description}</p>
      )}
    </div>
  );
}

/**
 * @param {{
 *   kind: string, ideaOrigin: string,
 *   onChange: (next: { kind: string, ideaOrigin: string }) => void,
 *   disabled?: boolean,
 *   compact?: boolean,          one row, no descriptions (list headers)
 *   showWhy?: boolean,          the one-sentence explanation (default true)
 *   kindLabel?: string, ideaOriginLabel?: string,
 *   className?: string,
 * }} props
 */
export default function TaxonomyPicker({
  kind,
  ideaOrigin,
  onChange,
  disabled = false,
  compact = false,
  showWhy = true,
  kindLabel = 'Kind (what it becomes)',
  ideaOriginLabel = 'Idea origin (how it started)',
  className = '',
}) {
  const baseId = useId();
  const { taxonomy, loading, error } = useTaxonomy();
  const kinds = enabledEntries(taxonomy.kinds);
  const origins = enabledEntries(taxonomy.ideaOrigins);

  return (
    <div className={className}>
      <div className={compact ? 'flex flex-wrap items-end gap-3' : 'grid gap-4 sm:grid-cols-2'}>
        <Picker
          id={`${baseId}-kind`}
          label={kindLabel}
          value={kind}
          entries={kinds}
          loading={loading}
          disabled={disabled}
          compact={compact}
          onChange={(next) => onChange({ kind: next, ideaOrigin })}
        />
        <Picker
          id={`${baseId}-origin`}
          label={ideaOriginLabel}
          value={ideaOrigin}
          entries={origins}
          loading={loading}
          disabled={disabled}
          compact={compact}
          onChange={(next) => onChange({ kind, ideaOrigin: next })}
        />
      </div>
      {showWhy && !compact && (
        <p className="mt-2 text-xs text-muted-foreground">{WHY_IT_MATTERS}</p>
      )}
      {error && (
        <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
