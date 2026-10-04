/**
 * ReviewBoardShell — the chrome the Architecture and Framework review boards
 * share (ADR 0033 §2): a left column of cards, a right column with the
 * editable title and summary, the Save / Publish (/ Delete) buttons, and a
 * tab strip over the board's own fields.
 *
 * The two boards were near clones of each other — the same two-column
 * layout, the same action row, the same tab machinery — differing only in
 * their fields. The fields stay with the boards; the layout lives here once.
 *
 * `saving` disables every action and shows which one is running, so a save
 * cannot be fired twice and a failed one does not read as a success.
 */
import React, { useState } from 'react';
import { CheckCircle, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const GRID_COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

/**
 * The first field of `record` that holds a truthy value, else `fallback`.
 *
 * Both boards read every legacy spelling of a field (`title` or `Title`,
 * `cloudProvider` or `'Cloud Provider'`); this is that `a || b || default`
 * chain written once (PR #841).
 */
export function firstFilled(record, keys, fallback) {
  const hit = keys.find((key) => Boolean(record?.[key]));
  return hit === undefined ? fallback : record[hit];
}

/**
 * Build a board's initial form from a record and a field table.
 *
 * `spec` maps each form field to `[keys, fallback]`: the record keys to read
 * in order of preference, and the value when none of them is set. Fallbacks
 * that are objects or arrays are used as given, so the caller builds the
 * table inside its initializer when a fresh one per form matters.
 */
export function initialFormFrom(record, spec) {
  const form = {};
  for (const [field, [keys, fallback]] of Object.entries(spec)) {
    form[field] = firstFilled(record, keys, fallback);
  }
  return form;
}

/** A labelled `<select>` for one metadata field; `options` are the values. */
export function MetadataSelect({ id, label, value, onChange, options }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A card holding one textarea: a list typed one item per line, or a block of
 * code or prose. `help` is the one-line note under the field, when there is
 * one.
 */
export function TextareaCard({
  title,
  value,
  onChange,
  ariaLabel,
  className,
  placeholder,
  help,
  spellCheck,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel}
          className={className}
          placeholder={placeholder}
          spellCheck={spellCheck}
        />
        {help && <p className="text-xs text-muted-foreground mt-2">{help}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * @param {{
 *   title: string, summary: string,
 *   onTitleChange: (value: string) => void, onSummaryChange: (value: string) => void,
 *   titlePlaceholder?: string, summaryPlaceholder?: string,
 *   saving?: false | 'save' | 'publish' | 'delete' | boolean,
 *   onSave: () => void, onPublish: () => void, onDelete?: () => void,
 *   publishLabel?: string,
 *   error?: string | null,
 *   aside: React.ReactNode,
 *   tabs: Array<{ value: string, label: string, icon?: React.ComponentType, content: React.ReactNode }>,
 *   defaultTab?: string,
 * }} props
 */
export default function ReviewBoardShell({
  title,
  summary,
  onTitleChange,
  onSummaryChange,
  titlePlaceholder = 'Title',
  summaryPlaceholder = 'Summary…',
  saving = false,
  onSave,
  onPublish,
  onDelete,
  publishLabel = 'Publish',
  error = null,
  aside,
  tabs,
  defaultTab,
}) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.value);
  const busy = Boolean(saving);
  const spinner = <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />;

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-6">
      <div className="w-1/3 flex flex-col gap-4 overflow-y-auto pr-2">{aside}</div>

      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex-1 mr-4">
            <label htmlFor="review-board-title" className="sr-only">
              Title
            </label>
            <Input
              id="review-board-title"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="text-xl font-bold border-none px-0 h-auto focus-visible:ring-0"
              placeholder={titlePlaceholder}
            />
            <label htmlFor="review-board-summary" className="sr-only">
              Summary
            </label>
            <Input
              id="review-board-summary"
              value={summary}
              onChange={(event) => onSummaryChange(event.target.value)}
              className="text-sm text-muted-foreground border-none px-0 h-auto focus-visible:ring-0 mt-1"
              placeholder={summaryPlaceholder}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            {onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
                {saving === 'delete' ? spinner : <Trash2 className="h-4 w-4 mr-2" />}
                Delete
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onSave} disabled={busy}>
              {saving === 'save' ? spinner : <Save className="h-4 w-4 mr-2" />}
              Save Draft
            </Button>
            <Button size="sm" onClick={onPublish} disabled={busy}>
              {saving === 'publish' ? spinner : <CheckCircle className="h-4 w-4 mr-2" />}
              {publishLabel}
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Separator />

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className={`grid w-full ${GRID_COLS[tabs.length] || 'grid-cols-4'}`}>
            {tabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                {Icon && <Icon className="h-3 w-3 mr-2" aria-hidden="true" />}
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 pr-2">
            {tabs.map(({ value, content, className }) => (
              <TabsContent key={value} value={value} className={className || 'mt-0 space-y-4'}>
                {content}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
