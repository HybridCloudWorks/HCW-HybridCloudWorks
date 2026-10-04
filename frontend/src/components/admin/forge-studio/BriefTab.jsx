/**
 * Brief — the creative brief (ADR 0033 §7 slice 2): what the piece is for,
 * who reads it, what it becomes (kind), how it started (idea origin), and
 * the constraints the forge and the AI actions work under. Nothing is
 * written here; the Draft tab creates the document from it.
 */
import React from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import TaxonomyPicker from '@/components/admin/shared/TaxonomyPicker';
import { READING_LEVELS, START_MODES, TARGET_CHANNELS, TONES, briefHasSubstance } from './brief';

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

/** A labelled `<select>`; `emptyLabel`, when given, is the first option with no value. */
function SelectField({ id, label, value, onChange, options, emptyLabel }) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
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

/** The two voice selects, side by side; each writes one brief field. */
const VOICE_SELECTS = Object.freeze([
  {
    id: 'brief-tone',
    label: 'Tone',
    field: 'tone',
    emptyLabel: 'Forge default (direct, practitioner)',
    options: asOptions(TONES),
  },
  {
    id: 'brief-reading',
    label: 'Reading level',
    field: 'readingLevel',
    emptyLabel: 'Not specified',
    options: asOptions(READING_LEVELS),
  },
]);

const CHANNEL_OPTIONS = TARGET_CHANNELS.map((channel) => ({
  value: channel.id,
  label: channel.label,
}));

/**
 * @param {{
 *   session: ReturnType<typeof import('./useForgeSession').useForgeSession>,
 *   formats: Array<{key: string, label: string}>,
 *   onBack: () => void, onNext: () => void,
 * }} props
 */
export default function BriefTab({ session, formats = [], onBack, onNext }) {
  const { brief, title, setBrief, setBriefFields, setTitle, doc } = session;
  const mode = START_MODES.find((m) => m.id === brief.mode) || START_MODES[0];
  const template = formats.find((f) => f.key === brief.templateKey);
  const locked = Boolean(doc); // the draft exists: the brief still edits, the Draft tab re-saves it
  const ready = title.trim() && briefHasSubstance(brief);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {mode.label}
            {template ? ` · ${template.label}` : ''}
            {brief.mode === 'existing' && brief.sourceTitle ? ` · from “${brief.sourceTitle}”` : ''}
          </CardTitle>
          <CardDescription>
            {brief.mode === 'url' && brief.sourceUrl ? (
              <>
                Source: <span className="font-mono text-xs">{brief.sourceUrl}</span>. The job
                scrapes it; the brief below is saved on the result.
              </>
            ) : (
              'A brief needs at least an objective, a key message, an audience, a topic or a source. The forge writes from it; the AI actions on the Draft tab hold to it.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field
            id="brief-title"
            label="Working title"
            hint="The draft is created with this title; the AI can suggest better ones later."
          >
            <Input
              id="brief-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Hub-and-spoke on Azure without the surprises"
            />
          </Field>

          <TaxonomyPicker
            kind={brief.kind}
            ideaOrigin={brief.ideaOrigin}
            onChange={({ kind, ideaOrigin }) => setBriefFields({ kind, ideaOrigin })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brief-objective" label="Objective">
              <Textarea
                id="brief-objective"
                rows={3}
                value={brief.objective}
                onChange={(event) => setBrief('objective', event.target.value)}
                placeholder="What the reader should be able to do afterwards."
              />
            </Field>
            <Field id="brief-audience" label="Audience">
              <Textarea
                id="brief-audience"
                rows={3}
                value={brief.audience}
                onChange={(event) => setBrief('audience', event.target.value)}
                placeholder="Who reads this, and what they already know."
              />
            </Field>
          </div>

          <Field id="brief-key-message" label="Key message">
            <Textarea
              id="brief-key-message"
              rows={2}
              value={brief.keyMessage}
              onChange={(event) => setBrief('keyMessage', event.target.value)}
              placeholder="The one thing the piece must leave behind."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            {VOICE_SELECTS.map((select) => (
              <SelectField
                key={select.id}
                id={select.id}
                label={select.label}
                value={brief[select.field]}
                onChange={(value) => setBrief(select.field, value)}
                options={select.options}
                emptyLabel={select.emptyLabel}
              />
            ))}
            <Field id="brief-length" label="Target length (words)">
              <Input
                id="brief-length"
                type="number"
                min={100}
                max={20000}
                step={50}
                value={brief.targetLength}
                onChange={(event) => setBrief('targetLength', event.target.value)}
                placeholder={
                  template ? `${template.wordRange?.[0]}–${template.wordRange?.[1]}` : '1200'
                }
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brief-required" label="Must cover" hint="One per line or comma-separated.">
              <Textarea
                id="brief-required"
                rows={3}
                value={brief.requiredTopics}
                onChange={(event) => setBrief('requiredTopics', event.target.value)}
              />
            </Field>
            <Field
              id="brief-prohibited"
              label="Must not cover"
              hint="One per line or comma-separated."
            >
              <Textarea
                id="brief-prohibited"
                rows={3}
                value={brief.prohibitedTopics}
                onChange={(event) => setBrief('prohibitedTopics', event.target.value)}
              />
            </Field>
            <Field id="brief-cta" label="Calls to action" hint="One per line.">
              <Textarea
                id="brief-cta"
                rows={2}
                value={brief.callsToAction}
                onChange={(event) => setBrief('callsToAction', event.target.value)}
              />
            </Field>
            <Field
              id="brief-sources"
              label="Sources"
              hint="URLs, one per line. Only http(s) links are kept."
            >
              <Textarea
                id="brief-sources"
                rows={2}
                value={brief.sources}
                onChange={(event) => setBrief('sources', event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="brief-channel"
              label="Publish to"
              value={brief.targetChannel}
              onChange={(value) => setBrief('targetChannel', value)}
              options={CHANNEL_OPTIONS}
            />
            <Field id="brief-campaign" label="Related campaign">
              <Input
                id="brief-campaign"
                value={brief.campaign}
                onChange={(event) => setBrief('campaign', event.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field
              id="brief-seo"
              label="SEO keywords"
              hint="Comma-separated; the first ten become the draft's tags."
            >
              <Input
                id="brief-seo"
                value={brief.seoKeywords}
                onChange={(event) => setBrief('seoKeywords', event.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Start
        </Button>
        <div className="flex items-center gap-3">
          {!ready && (
            <span className="text-xs text-muted-foreground">
              {title.trim()
                ? 'Add an objective, a key message, an audience, a topic or a source.'
                : 'Add a working title.'}
            </span>
          )}
          <Button type="button" onClick={onNext} disabled={!ready} className="gap-1">
            {locked ? 'Back to the draft' : 'Continue to Draft'}{' '}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
