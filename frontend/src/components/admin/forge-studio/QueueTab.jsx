/**
 * Queue — the Forge Studio Queue (owner request 2026-10-06): the URL entries
 * Start added, each with the "From a URL" fields to complete. Select one to
 * edit its fields; select several to set the shared fields once. Save
 * applies the values and sends the entries into the forge-from-url job (the
 * brief rides on the job); "Save for later" applies them and stops there.
 */
import React, { useMemo, useState } from 'react';
import { CheckSquare, ExternalLink, Flame, Loader2, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import TaxonomyPicker from '@/components/admin/shared/TaxonomyPicker';
import { READING_LEVELS, TARGET_CHANNELS, TONES } from './brief';
import {
  describeEntry,
  editable,
  fieldsPayload,
  formFromEntry,
  sharedForm,
  statusOf,
  toggleId,
} from './queueModel';
import { shortUrl } from './urlIntake';

const SELECT_CLASS =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';

function Field({ id, label, hint, children }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Select({ id, label, value, onChange, options, emptyLabel }) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const asOptions = (values) => values.map((value) => ({ value, label: value }));
const CHANNEL_OPTIONS = TARGET_CHANNELS.map((channel) => ({
  value: channel.id,
  label: channel.label,
}));

/** The one-entry or shared-fields form; `many` changes the blank-field meaning. */
function QueueFields({ form, setField, many }) {
  const leave = many ? 'Blank leaves each entry as it is.' : undefined;
  return (
    <div className="space-y-4">
      <TaxonomyPicker
        kind={form.kind}
        ideaOrigin="imported-source"
        onChange={({ kind }) => setField('kind', kind)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="queue-objective" label="Objective" hint={leave}>
          <Textarea
            id="queue-objective"
            rows={3}
            value={form.objective}
            onChange={(event) => setField('objective', event.target.value)}
            placeholder="What the reader should be able to do afterwards."
          />
        </Field>
        <Field id="queue-audience" label="Audience" hint={leave}>
          <Textarea
            id="queue-audience"
            rows={3}
            value={form.audience}
            onChange={(event) => setField('audience', event.target.value)}
            placeholder="Who reads this, and what they already know."
          />
        </Field>
      </div>
      <Field id="queue-key-message" label="Key message" hint={leave}>
        <Textarea
          id="queue-key-message"
          rows={2}
          value={form.keyMessage}
          onChange={(event) => setField('keyMessage', event.target.value)}
          placeholder="The one thing the piece must leave behind."
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="queue-tone"
          label="Tone"
          value={form.tone}
          onChange={(value) => setField('tone', value)}
          options={asOptions(TONES)}
          emptyLabel={many ? 'Leave as is' : 'Forge default (direct, practitioner)'}
        />
        <Select
          id="queue-reading"
          label="Reading level"
          value={form.readingLevel}
          onChange={(value) => setField('readingLevel', value)}
          options={asOptions(READING_LEVELS)}
          emptyLabel={many ? 'Leave as is' : 'Not specified'}
        />
        <Field id="queue-length" label="Target length (words)" hint={leave}>
          <Input
            id="queue-length"
            type="number"
            min={100}
            max={20000}
            step={50}
            value={form.targetLength}
            onChange={(event) => setField('targetLength', event.target.value)}
            placeholder="1200"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="queue-required"
          label="Must cover"
          hint={leave || 'One per line or comma-separated.'}
        >
          <Textarea
            id="queue-required"
            rows={3}
            value={form.requiredTopics}
            onChange={(event) => setField('requiredTopics', event.target.value)}
          />
        </Field>
        <Field
          id="queue-prohibited"
          label="Must not cover"
          hint={leave || 'One per line or comma-separated.'}
        >
          <Textarea
            id="queue-prohibited"
            rows={3}
            value={form.prohibitedTopics}
            onChange={(event) => setField('prohibitedTopics', event.target.value)}
          />
        </Field>
        <Field id="queue-cta" label="Calls to action" hint={leave || 'One per line.'}>
          <Textarea
            id="queue-cta"
            rows={2}
            value={form.callsToAction}
            onChange={(event) => setField('callsToAction', event.target.value)}
          />
        </Field>
        <Field
          id="queue-sources"
          label="Sources"
          hint={leave || 'URLs, one per line. Only http(s) links are kept.'}
        >
          <Textarea
            id="queue-sources"
            rows={2}
            value={form.sources}
            onChange={(event) => setField('sources', event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="queue-channel"
          label="Publish to"
          value={form.targetChannel}
          onChange={(value) => setField('targetChannel', value)}
          options={CHANNEL_OPTIONS}
          emptyLabel={many ? 'Leave as is' : 'Blog (default)'}
        />
        <Field id="queue-campaign" label="Related campaign" hint={leave}>
          <Input
            id="queue-campaign"
            value={form.campaign}
            onChange={(event) => setField('campaign', event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field
          id="queue-seo"
          label="SEO keywords"
          hint={leave || 'Comma-separated; the first ten become the draft’s tags.'}
        >
          <Input
            id="queue-seo"
            value={form.seoKeywords}
            onChange={(event) => setField('seoKeywords', event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

/** One row of the queue: its checkbox, URL, fields summary, status and the open link when forged. */
function QueueRow({ entry, selected, onToggle, onOpenDocument }) {
  const status = statusOf(entry);
  const Box = selected ? CheckSquare : Square;
  return (
    <li
      className={`flex items-start gap-3 px-3 py-2 ${selected ? 'bg-primary/5' : ''}`}
      data-testid="queue-row"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${shortUrl(entry.url)}`}
        onClick={() => onToggle(entry.id)}
        className="mt-0.5 text-primary"
      >
        <Box className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium underline-offset-2 hover:underline"
            title={entry.url}
          >
            {entry.title || shortUrl(entry.url)}
          </a>
          <StatusBadge size="xs" status={status} />
        </div>
        <p className="truncate text-xs text-muted-foreground">{describeEntry(entry)}</p>
        {entry.status === 'failed' && entry.error && (
          <p className="text-xs text-destructive">{entry.error}</p>
        )}
      </div>
      {entry.status === 'forged' && entry.contentId && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => onOpenDocument(entry.contentId)}
        >
          Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

/**
 * @param {{
 *   queue: ReturnType<typeof import('./useForgeQueue').useForgeQueue>,
 *   onOpenDocument: (contentId: string) => void,
 *   onStart: () => void,
 * }} props
 */
export default function QueueTab({ queue, onOpenDocument, onStart }) {
  const [selected, setSelected] = useState(() => new Set());
  // The edits, kept under the selection they were made for: a different
  // selection shows its own entries' fields again, with nothing to reset.
  const [draft, setDraft] = useState({ key: '', form: null });

  const { items } = queue;
  const chosen = useMemo(() => items.filter((entry) => selected.has(entry.id)), [items, selected]);
  const many = chosen.length > 1;
  const editableChosen = chosen.filter(editable);
  const selectionKey = chosen.map((entry) => `${entry.id}:${entry.updatedAt}`).join('|');
  const baseForm = useMemo(
    () => (chosen.length === 1 ? formFromEntry(chosen[0]) : sharedForm(chosen)),
    // chosen is summarised by selectionKey; the array identity changes on
    // every list refresh while a job runs and must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectionKey]
  );
  const touched = draft.key === selectionKey && draft.form !== null;
  const form = touched ? draft.form : baseForm;

  const setField = (field, value) =>
    setDraft({ key: selectionKey, form: { ...form, [field]: value } });
  const toggle = (id) => setSelected((current) => toggleId(current, id));
  const selectAll = () => setSelected(new Set(items.filter(editable).map((entry) => entry.id)));
  const clearSelection = () => setSelected(new Set());

  const ids = editableChosen.map((entry) => entry.id);
  const busy = Boolean(queue.busy);

  const saveOnly = async () => {
    if (!ids.length) return;
    await queue.update(ids, fieldsPayload(form, { onlyFilled: many }));
  };
  const saveAndForge = async () => {
    if (!ids.length) return;
    const applied = touched
      ? await queue.update(ids, fieldsPayload(form, { onlyFilled: many }))
      : true;
    if (!applied) return;
    const started = await queue.forge(ids);
    if (started) clearSelection();
  };
  const removeChosen = async () => {
    if (!chosen.length) return;
    const gone = await queue.remove(chosen.map((entry) => entry.id));
    if (gone) clearSelection();
  };

  if (queue.status === 'error' && !items.length) {
    return (
      <EmptyState
        variant="error"
        title="The queue could not be read"
        description={queue.error}
        onRetry={queue.load}
      />
    );
  }
  if (queue.status === 'loading' || queue.status === 'idle') {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
      </div>
    );
  }
  if (!items.length) {
    return (
      <EmptyState
        title="The queue is empty"
        description="Paste several URLs, or import an .html file, under From a URL on Start; each becomes an entry here."
        action={
          <Button size="sm" onClick={onStart}>
            Open Start
          </Button>
        }
      />
    );
  }

  const forgingCount = items.filter((entry) => entry.status === 'forging').length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                Forge Studio Queue · {items.length} of {queue.max}
              </CardTitle>
              <CardDescription>
                Select one entry to complete its fields, or several to set the shared fields once.
                Save sends the selected entries into the forge; the brief rides on the job.
                {forgingCount > 0 && ` ${forgingCount} forging now; the list refreshes on its own.`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={queue.load}
                disabled={busy}
                className="gap-1"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={selectAll} disabled={busy}>
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearSelection}
                disabled={busy || !chosen.length}
              >
                Clear selection
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {queue.error && (
            <p
              role="alert"
              className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {queue.error}
            </p>
          )}
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-md border border-border">
            {items.map((entry) => (
              <QueueRow
                key={entry.id}
                entry={entry}
                selected={selected.has(entry.id)}
                onToggle={toggle}
                onOpenDocument={onOpenDocument}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      {chosen.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {many
                ? `Shared fields for ${chosen.length} entries`
                : `Fields for ${shortUrl(chosen[0].url)}`}
            </CardTitle>
            <CardDescription>
              {many
                ? 'A field shows a value when every selected entry has it. What you set here is applied to every selected entry; blank fields are left as each entry has them.'
                : 'The "From a URL" fields for this entry. Save applies them and starts the forge; the brief lands on the document the job creates.'}
              {editableChosen.length < chosen.length &&
                ` ${chosen.length - editableChosen.length} selected ${chosen.length - editableChosen.length === 1 ? 'entry is' : 'entries are'} forging and will not be changed.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <QueueFields form={form} setField={setField} many={many} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-1 text-destructive"
                onClick={removeChosen}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove{' '}
                {many ? `${chosen.length} entries` : 'entry'}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveOnly}
                  disabled={busy || !ids.length}
                >
                  Save for later
                </Button>
                <Button
                  type="button"
                  onClick={saveAndForge}
                  disabled={busy || !ids.length}
                  className="gap-1"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Flame className="h-4 w-4" aria-hidden="true" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
