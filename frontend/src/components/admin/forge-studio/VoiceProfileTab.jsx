/**
 * Voice & profile — the forge's configuration (Blog Machine T-604), moved
 * whole from the old Forge Studio page under ADR 0033. Everything here reads
 * and writes the two admin_config documents the pipeline consumes
 * (forge_profile, forge_prompts) through getForgeConfig/updateForgeConfig,
 * whose server side runs the pipeline's own normalizers — so what this tab
 * shows is exactly what the next forge run reads.
 *
 * Calibration is suggestions-only by design: the voice-calibration job reads
 * the owner's published posts and proposes wordSoup additions as chips;
 * nothing lands in the profile until Accept is clicked, and Accept is an
 * ordinary profile save.
 *
 * Fixed with the move (ADR 0033 inventory): a 0 threshold or daily limit is
 * kept as 0 instead of becoming 80 or 3; the interest areas can be cleared
 * (an empty list is sent and stored as empty); accepting, dismissing or
 * clearing a chip shows the saving state and disables the chips meanwhile;
 * the scoreboard shows today's count and formats the totals.
 */
import React, { useState } from 'react';
import { Loader2, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getJSON, postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';

const lines = (value) =>
  String(value || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);

const commas = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * A number from an input's string, or the fallback when it is empty or not a
 * number. `Number(x) || fallback` turned an explicit 0 into the fallback.
 */
export function numberOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Client-only stable identity for editable rows — React keys, never sent
 * to the server (toUpdatePayload maps explicit fields only). Index keys made
 * a removed row's neighbours inherit the wrong input values (#239 review). */
const newRowId = () => crypto.randomUUID();

/** Fetched config → the flat editable shape the form binds to. */
export function toFormState(config) {
  return {
    wordSoup: config.profile.wordSoup || '',
    interestAreas: config.profile.interestAreas.map((area) => ({
      rowId: newRowId(),
      key: area.key,
      label: area.label,
      weight: area.weight,
      keywords: (area.keywords || []).join(', '),
    })),
    certifications: config.profile.certifications.map((cert) => ({
      rowId: newRowId(),
      name: cert.name,
      issuer: cert.issuer,
      keywords: (cert.keywords || []).join(', '),
    })),
    speakingTopics: config.profile.speakingTopics.map((topic) => ({
      rowId: newRowId(),
      title: topic.title,
      keywords: (topic.keywords || []).join(', '),
    })),
    masterPrompt: config.prompts.masterPrompt,
    bannedPhrases: config.prompts.extraBannedPhrases.join('\n'),
    noEmDash: config.prompts.styleRules.noEmDash,
    noHyphenTells: config.prompts.styleRules.noHyphenTells,
    customRules: config.prompts.styleRules.custom.join('\n'),
    publishThreshold: config.prompts.publishThreshold,
    autoForgeEnabled: config.prompts.autoForge.enabled,
    autoForgeDailyLimit: config.prompts.autoForge.dailyLimit,
  };
}

/** Editable shape → the updateForgeConfig payload. An empty list is sent as empty. */
export function toUpdatePayload(form) {
  return {
    profile: {
      wordSoup: form.wordSoup,
      interestAreas: form.interestAreas.map((area) => ({
        key: area.key,
        label: area.label,
        weight: numberOr(area.weight, 0),
        keywords: commas(area.keywords),
      })),
      certifications: form.certifications.map((cert) => ({
        name: cert.name,
        issuer: cert.issuer,
        keywords: commas(cert.keywords),
      })),
      speakingTopics: form.speakingTopics.map((topic) => ({
        title: topic.title,
        keywords: commas(topic.keywords),
      })),
    },
    prompts: {
      masterPrompt: form.masterPrompt,
      extraBannedPhrases: lines(form.bannedPhrases),
      styleRules: {
        noEmDash: form.noEmDash,
        noHyphenTells: form.noHyphenTells,
        custom: lines(form.customRules),
      },
      publishThreshold: numberOr(form.publishThreshold, 80),
      autoForge: {
        enabled: form.autoForgeEnabled,
        dailyLimit: numberOr(form.autoForgeDailyLimit, 3),
      },
    },
  };
}

const money = (value) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

/** A scoreboard total, formatted by what it is. */
export function formatTotal(key, value) {
  if (/cost/i.test(key)) return money(value);
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : String(value);
}

function RowList({ rows, columns, onChange, onAdd, onRemove, addLabel }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.rowId} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {columns.map((col) => (
            <Input
              key={col.field}
              aria-label={col.label}
              placeholder={col.label}
              type={col.type || 'text'}
              min={col.type === 'number' ? 0 : undefined}
              max={col.type === 'number' ? 100 : undefined}
              value={row[col.field]}
              onChange={(event) => onChange(index, col.field, event.target.value)}
              className={col.className || 'flex-1'}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove row ${index + 1}`}
            onClick={() => onRemove(index)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={onAdd} className="gap-1">
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

function VoiceProfileCard({ form, setField, setRows }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice profile</CardTitle>
        <CardDescription>
          Who the forge writes as. The word soup is woven into every draft and every grade; the
          weighted interest areas decide what scores well. An empty interest-area list is kept
          empty.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="word-soup">Word soup — perspective, themes, opinions, anchors</Label>
          <Textarea
            id="word-soup"
            rows={8}
            value={form.wordSoup}
            onChange={(event) => setField('wordSoup', event.target.value)}
            placeholder="Free-form notes about you: what you build, what you believe about cloud, phrases you actually use…"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium leading-none">
            Interest areas (weight 0–100, keywords comma-separated)
          </p>
          <RowList
            rows={form.interestAreas}
            columns={[
              { field: 'label', label: 'Label' },
              { field: 'weight', label: 'Weight', type: 'number', className: 'sm:w-24' },
              { field: 'keywords', label: 'Keywords' },
            ]}
            onChange={(index, field, value) => setRows('interestAreas', index, field, value)}
            onAdd={() =>
              setField('interestAreas', [
                ...form.interestAreas,
                {
                  rowId: newRowId(),
                  key: `custom_${Date.now()}`,
                  label: '',
                  weight: 50,
                  keywords: '',
                },
              ])
            }
            onRemove={(index) =>
              setField(
                'interestAreas',
                form.interestAreas.filter((_, i) => i !== index)
              )
            }
            addLabel="Add interest area"
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">Certifications</p>
            <RowList
              rows={form.certifications}
              columns={[
                { field: 'name', label: 'Name' },
                { field: 'issuer', label: 'Issuer', className: 'sm:w-36' },
                { field: 'keywords', label: 'Keywords' },
              ]}
              onChange={(index, field, value) => setRows('certifications', index, field, value)}
              onAdd={() =>
                setField('certifications', [
                  ...form.certifications,
                  { rowId: newRowId(), name: '', issuer: '', keywords: '' },
                ])
              }
              onRemove={(index) =>
                setField(
                  'certifications',
                  form.certifications.filter((_, i) => i !== index)
                )
              }
              addLabel="Add certification"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">Speaking topics</p>
            <RowList
              rows={form.speakingTopics}
              columns={[
                { field: 'title', label: 'Title' },
                { field: 'keywords', label: 'Keywords' },
              ]}
              onChange={(index, field, value) => setRows('speakingTopics', index, field, value)}
              onAdd={() =>
                setField('speakingTopics', [
                  ...form.speakingTopics,
                  { rowId: newRowId(), title: '', keywords: '' },
                ])
              }
              onRemove={(index) =>
                setField(
                  'speakingTopics',
                  form.speakingTopics.filter((_, i) => i !== index)
                )
              }
              addLabel="Add topic"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PromptsCard({ form, setField }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Master prompt &amp; guardrails</CardTitle>
        <CardDescription>
          The instruction every forge run opens with, and the tells it must never produce.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="master-prompt">Master prompt</Label>
          <Textarea
            id="master-prompt"
            rows={5}
            value={form.masterPrompt}
            onChange={(event) => setField('masterPrompt', event.target.value)}
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="banned-phrases">Banned phrases (one per line)</Label>
            <Textarea
              id="banned-phrases"
              rows={5}
              value={form.bannedPhrases}
              onChange={(event) => setField('bannedPhrases', event.target.value)}
              placeholder={'delve\nin this article\ngame-changer'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-rules">Custom style rules (one per line)</Label>
            <Textarea
              id="custom-rules"
              rows={5}
              value={form.customRules}
              onChange={(event) => setField('customRules', event.target.value)}
              placeholder="Open with the problem, never with context-setting."
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.noEmDash}
              onCheckedChange={(checked) => setField('noEmDash', checked)}
              aria-label="No em dashes"
            />
            No em dashes
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.noHyphenTells}
              onCheckedChange={(checked) => setField('noHyphenTells', checked)}
              aria-label="No hyphen tells"
            />
            No hyphenated AI tells
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityAutomationCard({ form, setField }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quality &amp; automation</CardTitle>
        <CardDescription>
          A draft grading at or above the threshold stages as forge_ready; below it lands in
          editing. 0 means every draft stages. Auto-Forge is honoured by the scheduled forge timer;
          a daily limit of 0 pauses it without switching it off.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Label htmlFor="publish-threshold">Publish threshold (0–100)</Label>
          <Input
            id="publish-threshold"
            type="number"
            min={0}
            max={100}
            value={form.publishThreshold}
            onChange={(event) => setField('publishThreshold', event.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex items-center gap-2 pb-2 text-sm">
          <Switch
            checked={form.autoForgeEnabled}
            onCheckedChange={(checked) => setField('autoForgeEnabled', checked)}
            aria-label="Auto-Forge enabled"
          />
          Auto-Forge
        </div>
        <div className="space-y-2">
          <Label htmlFor="daily-limit">Daily limit (0–10)</Label>
          <Input
            id="daily-limit"
            type="number"
            min={0}
            max={10}
            value={form.autoForgeDailyLimit}
            onChange={(event) => setField('autoForgeDailyLimit', event.target.value)}
            className="w-24"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CalibrationCard({
  suggestions,
  calibrating,
  saving,
  onCalibrate,
  onAccept,
  onDismiss,
  onClear,
}) {
  const additions = suggestions?.wordSoupAdditions || [];
  const hints = suggestions?.styleHints || [];
  const phrases = suggestions?.recurringPhrases || [];
  const hasAny = additions.length + hints.length + phrases.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Voice calibration
        </CardTitle>
        <CardDescription>
          Reads your recent published posts and suggests profile additions. Nothing is applied until
          you accept it — each chip is your call. Accepting a chip saves the whole form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onCalibrate}
            disabled={calibrating || saving}
            className="gap-1"
          >
            {calibrating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Calibrate from my published posts
          </Button>
          {hasAny && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={saving}>
              Dismiss all
            </Button>
          )}
          {saving && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {suggestions?.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Last run {new Date(suggestions.generatedAt).toLocaleString()} over{' '}
              {suggestions.postCount} posts
            </span>
          )}
        </div>
        {additions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">
              Suggested word-soup additions — accept to append
            </p>
            <div className="flex flex-wrap gap-2">
              {additions.map((text) => (
                <span
                  key={text}
                  className={`inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs ${
                    saving ? 'opacity-60' : ''
                  }`}
                >
                  {text}
                  <button
                    type="button"
                    aria-label={`Accept suggestion: ${text}`}
                    className="font-semibold text-primary hover:underline disabled:cursor-not-allowed"
                    disabled={saving}
                    onClick={() => onAccept(text)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    aria-label={`Dismiss suggestion: ${text}`}
                    disabled={saving}
                    onClick={() => onDismiss(text)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {hints.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">
              Style hints (add the ones you agree with as custom rules)
            </p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </div>
        )}
        {phrases.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">Phrases you genuinely reuse</p>
            <div className="flex flex-wrap gap-2">
              {phrases.map((phrase) => (
                <Badge key={phrase} variant="secondary">
                  {phrase}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FormatsStatsCard({ formats, stats }) {
  const formatEntries = formats || [];
  const formatStats = stats?.formats || {};
  const today = stats?.today;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Formats &amp; scoreboard</CardTitle>
        <CardDescription>
          The rotation the forge draws from (read-only; it avoids the last five used) and what it
          has produced so far.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {formatEntries.map((format) => (
            <Badge key={format.key} variant="outline" className="gap-1">
              {format.label}
              <span className="text-muted-foreground">
                {format.wordRange?.[0]}–{format.wordRange?.[1]}w
              </span>
              {typeof formatStats[format.key]?.forged === 'number' && (
                <span className="text-primary">×{formatStats[format.key].forged}</span>
              )}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            forged today:{' '}
            <span className="font-mono text-foreground" data-testid="forged-today">
              {today?.date ? `${Number(today.forged) || 0} (${today.date})` : '0'}
            </span>
          </span>
          {Object.entries(stats?.totals || {}).map(([key, value]) => (
            <span key={key}>
              {key}: <span className="font-mono text-foreground">{formatTotal(key, value)}</span>
            </span>
          ))}
          {stats?.updatedAt && <span>updated {new Date(stats.updatedAt).toLocaleString()}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * @param {{ config: object, onConfig: (config: object) => void }} props
 *   `config` is the getForgeConfig answer the page loaded; `onConfig`
 *   receives every answer a save or calibration returns.
 */
export default function VoiceProfileTab({ config, onConfig }) {
  const [form, setForm] = useState(() => toFormState(config));
  const [saving, setSaving] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const { suggestions } = config;

  const apply = (response) => {
    onConfig(response);
    setForm(toFormState(response));
  };

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setRows = (listField, index, field, value) =>
    setForm((prev) => ({
      ...prev,
      [listField]: prev[listField].map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));

  /** One save: the whole form plus `extra`, with the saving state shown. */
  const write = async (payload, successNotice) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await postJSON('updateForgeConfig', payload);
      if (!response?.ok) throw new Error(response?.error || 'Save failed');
      apply(response);
      if (successNotice) setNotice(successNotice);
      return true;
    } catch (err) {
      setError(err?.message || 'Save failed.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = () =>
    write(toUpdatePayload(form), 'Saved. The next forge run reads this configuration.');

  const calibrate = async () => {
    setCalibrating(true);
    setError('');
    try {
      const job = await runJob('voice-calibration', {}, { maxWaitMs: 5 * 60 * 1000 });
      if (job.status !== 'succeeded') throw new Error(job.error || `Calibration ${job.status}`);
      const latest = await getJSON('getForgeConfig');
      apply(latest);
      setNotice('Calibration complete — review the suggestions below.');
    } catch (err) {
      setError(err?.message || 'Calibration failed.');
    } finally {
      setCalibrating(false);
    }
  };

  const acceptSuggestion = async (text) => {
    const remaining = (suggestions?.wordSoupAdditions || []).filter((entry) => entry !== text);
    const nextForm = { ...form, wordSoup: `${form.wordSoup.trim()}\n${text}`.trim() };
    setForm(nextForm);
    const payload = toUpdatePayload(nextForm);
    payload.profile.suggestionsKept = remaining;
    await write(payload);
  };

  const dismissSuggestion = async (text) => {
    const remaining = (suggestions?.wordSoupAdditions || []).filter((entry) => entry !== text);
    const payload = toUpdatePayload(form);
    payload.profile.suggestionsKept = remaining;
    await write(payload);
  };

  const clearSuggestions = () => write({ ...toUpdatePayload(form), clearSuggestions: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Your voice, the guardrails, and the quality bar every forged post is held to.
        </p>
        <Button onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-500/50 bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {notice}
        </div>
      )}

      <CalibrationCard
        suggestions={suggestions}
        calibrating={calibrating}
        saving={saving}
        onCalibrate={calibrate}
        onAccept={acceptSuggestion}
        onDismiss={dismissSuggestion}
        onClear={clearSuggestions}
      />
      <VoiceProfileCard form={form} setField={setField} setRows={setRows} />
      <PromptsCard form={form} setField={setField} />
      <QualityAutomationCard form={form} setField={setField} />
      <FormatsStatsCard formats={config.formats || []} stats={config.stats || null} />
    </div>
  );
}
