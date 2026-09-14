/**
 * NewsletterContentFields — the Content part of Newsletter settings (#557):
 * which sections each issue carries, in what order, how many items each, how
 * many days back it looks, and whether and how the AI intro is written.
 *
 * Presentational only. It edits the settings object the card holds and the
 * card saves the whole document, because the settings are one document with a
 * full-replace write: a second card saving its own copy would put back an
 * old postal address or reply-to.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp } from 'lucide-react';

/** Used when the server sends no options; it always does, so these are a fallback. */
export const FALLBACK_CONTENT_OPTIONS = Object.freeze({
  sections: [
    { id: 'articles', title: 'New on HybridCloudWorks' },
    { id: 'certification-news', title: 'Certification news' },
    { id: 'episodes', title: 'Listen & learn' },
  ],
  introTones: ['professional', 'friendly', 'concise', 'enthusiastic'],
  windowDays: { min: 1, max: 31 },
  maxItems: { min: 1, max: 20 },
});

const TONE_LABELS = {
  professional: 'Professional',
  friendly: 'Friendly',
  concise: 'Short and direct',
  enthusiastic: 'Enthusiastic',
};

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/** A number input's value as the API wants it: a number, or '' while the box is empty. */
const asNumber = (raw) => (raw === '' ? '' : Number(raw));

/** Why the content cannot be saved as it stands, or null. */
export function contentProblem(value) {
  const sections = value.sections || [];
  if (sections.length > 0 && !sections.some((row) => row.enabled)) {
    return 'Turn on at least one section.';
  }
  if (sections.some((row) => row.maxItems === '')) {
    return 'Enter how many items each section may show.';
  }
  if (value.windowDays === '') return 'Enter how many days back to look.';
  return null;
}

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function SectionRow({ row, title, index, count, bounds, onRow, onMove }) {
  const boxId = `nl-section-${row.id}`;
  const itemsId = `nl-section-items-${row.id}`;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
      <input
        id={boxId}
        type="checkbox"
        className="h-4 w-4"
        checked={row.enabled}
        onChange={(event) => onRow(index, { enabled: event.target.checked })}
      />
      <label htmlFor={boxId} className="min-w-0 flex-1 text-sm font-medium">
        {title}
      </label>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        Most items
      </span>
      <Input
        id={itemsId}
        type="number"
        className="h-8 w-20"
        min={bounds.min}
        max={bounds.max}
        aria-label={`Most items in ${title}`}
        value={row.maxItems}
        onChange={(event) => onRow(index, { maxItems: asNumber(event.target.value) })}
      />
      <div className="flex">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Move ${title} up`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Move ${title} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function SectionList({ sections, options, onChange }) {
  const titles = new Map(options.sections.map((section) => [section.id, section.title]));
  const onRow = (index, patch) =>
    onChange(sections.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const onMove = (index, delta) => onChange(move(sections, index, delta));
  return (
    <ul className="space-y-2" aria-label="Sections">
      {sections.map((row, index) => (
        <SectionRow
          key={row.id}
          row={row}
          title={titles.get(row.id) || row.id}
          index={index}
          count={sections.length}
          bounds={options.maxItems}
          onRow={onRow}
          onMove={onMove}
        />
      ))}
    </ul>
  );
}

function IntroFields({ value, options, onChange }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex items-center gap-3">
        {/* A native checkbox with the switch role: the Radix Switch needs ResizeObserver. */}
        <input
          id="nl-intro"
          type="checkbox"
          role="switch"
          className="h-4 w-4"
          checked={value.introEnabled !== false}
          onChange={(event) => onChange({ introEnabled: event.target.checked })}
        />
        <Label htmlFor="nl-intro">AI intro</Label>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nl-tone">Intro tone</Label>
        <select
          id="nl-tone"
          className={SELECT_CLASS}
          value={value.introTone}
          disabled={value.introEnabled === false}
          onChange={(event) => onChange({ introTone: event.target.value })}
        >
          {options.introTones.map((tone) => (
            <option key={tone} value={tone}>
              {TONE_LABELS[tone] || tone}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function NewsletterContentFields({ value, options, onChange }) {
  const opts = options || FALLBACK_CONTENT_OPTIONS;
  const sections = value.sections || [];
  return (
    <fieldset className="space-y-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">Content</legend>
      <p className="text-sm text-muted-foreground">
        What goes into each issue. The Build button and the Monday automatic build both use these
        choices. Sections that are ticked appear in this order.
      </p>
      {sections.length > 0 && (
        <SectionList
          sections={sections}
          options={opts}
          onChange={(next) => onChange({ sections: next })}
        />
      )}
      <div className="space-y-1.5 md:w-1/2">
        <Label htmlFor="nl-window">Days back</Label>
        <Input
          id="nl-window"
          type="number"
          min={opts.windowDays.min}
          max={opts.windowDays.max}
          value={value.windowDays}
          onChange={(event) => onChange({ windowDays: asNumber(event.target.value) })}
        />
        <p className="text-xs text-muted-foreground">
          How far back to look for new items ({opts.windowDays.min} to {opts.windowDays.max} days).
        </p>
      </div>
      <IntroFields value={value} options={opts} onChange={onChange} />
    </fieldset>
  );
}
