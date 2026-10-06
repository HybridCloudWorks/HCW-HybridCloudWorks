/**
 * Start — the five ways a piece begins (ADR 0033 §7 slice 2). Each card
 * seeds the brief for its mode and moves to the Brief tab; nothing is
 * written until the Brief or Draft tab says so.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Globe,
  LayoutTemplate,
  Lightbulb,
  ListOrdered,
  Loader2,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { getJSON } from '@/lib/api';
import { START_MODES } from './brief';
import {
  DETECTED_ROWS_SHOWN,
  MAX_HTML_FILE_BYTES,
  MAX_URLS_PER_IMPORT,
  extractUrls,
  mergeDetected,
  shortUrl,
} from './urlIntake';

const ICONS = {
  idea: Lightbulb,
  template: LayoutTemplate,
  existing: FileText,
  url: Globe,
  blank: Square,
};

function TemplatePicker({ formats, onPick }) {
  if (!formats.length) {
    return (
      <EmptyState
        compact
        title="No formats to pick from"
        description="The format library arrives with the voice configuration; open Voice & profile once and come back."
      />
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {formats.map((format) => (
        <button
          key={format.key}
          type="button"
          onClick={() => onPick(format)}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5"
        >
          <span>
            <span className="font-medium">{format.label}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {format.wordRange?.[0]}–{format.wordRange?.[1]} words
            </span>
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ExistingPicker({ onPick }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [query, setQuery] = useState('');

  const load = () => {
    getJSON('cms/content?limit=100')
      .then((res) => setState({ status: 'ready', items: res?.items || [], error: null }))
      .catch((err) =>
        setState({
          status: 'error',
          items: [],
          error: err?.message || 'The content list could not be read.',
        })
      );
  };
  useEffect(load, []);

  const retry = () => {
    setState({ status: 'loading', items: [], error: null });
    load();
  };

  if (state.status === 'error') {
    return (
      <EmptyState
        compact
        variant="error"
        title="Content could not be listed"
        description={state.error}
        onRetry={retry}
      />
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the content list…
      </div>
    );
  }
  const needle = query.trim().toLowerCase();
  const items = state.items
    .filter((item) => (item.Title || item.title || '').toLowerCase().includes(needle))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 40);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label="Search content by title"
          placeholder="Search by title"
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState
          compact
          variant={needle ? 'filtered' : 'empty'}
          title={needle ? 'Nothing matches that title' : 'No content in the pipeline yet'}
          description={needle ? 'Try fewer words.' : 'Start from an idea or a URL instead.'}
        />
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 truncate">{item.Title || item.title || 'Untitled'}</span>
                <StatusBadge content={item} size="xs" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Read each chosen .html file and add the URLs it links to; the problems, if any, as sentences. */
async function readHtmlFiles(files) {
  const urls = [];
  const problems = [];
  for (const file of files) {
    if (!/\.html?$/i.test(file.name)) {
      problems.push(`${file.name}: not an .html file, skipped.`);
      continue;
    }
    if (file.size > MAX_HTML_FILE_BYTES) {
      problems.push(
        `${file.name}: over ${Math.round(MAX_HTML_FILE_BYTES / 1024 / 1024)} MB, skipped.`
      );
      continue;
    }
    const text = await file.text();
    const found = extractUrls(text, { html: true });
    if (!found.length) problems.push(`${file.name}: no http(s) links found.`);
    urls.push(...found);
  }
  return { urls, problems };
}

/**
 * From a URL: paste one URL or many (one per line, or a block of text), or
 * import .html files saved from a browser; every URL found becomes a row.
 * One row continues to the Brief as before; the rows go to the Forge Studio
 * Queue together with "Add all", and "Remove all" clears them before they do.
 */
function UrlIntake({ onStart, onQueueAdd, queueBusy }) {
  const [text, setText] = useState('');
  const [detected, setDetected] = useState([]);
  const [notice, setNotice] = useState('');
  const fileInput = useRef(null);

  const addUrls = (urls, problems = []) => {
    const merged = mergeDetected(detected, urls);
    setDetected(merged.urls);
    const lines = [...problems];
    if (merged.dropped)
      lines.push(`${merged.dropped} left out: a list holds at most ${MAX_URLS_PER_IMPORT}.`);
    if (!urls.length && !problems.length) lines.push('No http(s) URL found in that text.');
    setNotice(lines.join(' '));
  };

  const detect = () => {
    addUrls(extractUrls(text));
    setText('');
  };

  const importFiles = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const { urls, problems } = await readHtmlFiles(files);
    addUrls(urls, problems);
  };

  const removeOne = (url) => setDetected((current) => current.filter((entry) => entry !== url));
  const removeAll = () => {
    setDetected([]);
    setNotice('');
  };
  const addAll = async () => {
    if (!detected.length) return;
    const answer = await onQueueAdd(detected);
    if (!answer) return;
    setDetected([]);
    const parts = [`${answer.added?.length || 0} added to the queue.`];
    if (answer.skipped?.length) parts.push(`${answer.skipped.length} already there.`);
    if (answer.full) parts.push(`${answer.full} not added: the queue is full.`);
    setNotice(parts.join(' '));
  };
  const addOne = async (url) => {
    const answer = await onQueueAdd([url]);
    if (answer) removeOne(url);
  };

  const single = detected.length === 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Forge from a URL</CardTitle>
        <CardDescription>
          One URL continues to the brief as before. Paste several, or import .html files saved from
          a browser, and each becomes a row below; Add all sends them to the Forge Studio Queue,
          where their fields are completed one at a time or together.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const urls = extractUrls(text);
            if (urls.length === 1 && detected.length === 0) {
              onStart('url', { sourceUrl: urls[0] });
              return;
            }
            detect();
          }}
        >
          <div>
            <Label htmlFor="forge-start-url">Source URL, or several</Label>
            <Textarea
              id="forge-start-url"
              rows={3}
              required={detected.length === 0}
              placeholder={
                'https://learn.microsoft.com/…\nOne per line, or paste a block of text with links in it.'
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!text.trim()} className="gap-1">
              {detected.length === 0 && extractUrls(text).length <= 1 ? (
                <>
                  Continue to the brief <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              ) : (
                'Detect URLs'
              )}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              className="sr-only"
              aria-label="Import .html files"
              onChange={importFiles}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-1"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" /> Import .html
            </Button>
            {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
          </div>
        </form>

        {detected.length > 0 && (
          <div className="space-y-2" data-testid="detected-urls">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {detected.length} URL{detected.length === 1 ? '' : 's'} detected
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={removeAll}
                  disabled={queueBusy}
                >
                  Remove all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={addAll}
                  disabled={queueBusy}
                  className="gap-1 bg-green-600 text-white hover:bg-green-700"
                >
                  {queueBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Add all to the queue
                </Button>
              </div>
            </div>
            {detected.length > DETECTED_ROWS_SHOWN && (
              <p className="text-xs text-muted-foreground">
                Showing the first {DETECTED_ROWS_SHOWN}; Add all adds every one of the{' '}
                {detected.length}.
              </p>
            )}
            <ul className="divide-y divide-border rounded-md border border-border">
              {detected.slice(0, DETECTED_ROWS_SHOWN).map((entry) => (
                <li key={entry} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={entry}>
                    {shortUrl(entry)}
                  </span>
                  {single ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => onStart('url', { sourceUrl: entry })}
                    >
                      Continue to the brief{' '}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addOne(entry)}
                      disabled={queueBusy}
                    >
                      Add to queue
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${shortUrl(entry)}`}
                    className="text-destructive"
                    onClick={() => removeOne(entry)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * @param {{
 *   formats: Array<{key: string, label: string, wordRange?: number[]}>,
 *   onStart: (mode: string, extras?: object) => void,
 *   onQueueAdd?: (urls: string[]) => Promise<object|null>,
 *   onOpenQueue?: () => void,
 *   queueCount?: number,
 *   queueBusy?: boolean,
 * }} props
 */
export default function StartTab({
  formats = [],
  onStart,
  onQueueAdd = async () => null,
  onOpenQueue = () => {},
  queueCount = 0,
  queueBusy = false,
}) {
  const [picking, setPicking] = useState(null); // 'template' | 'existing' | 'url' | null

  const pick = (mode) => {
    if (mode === 'template' || mode === 'existing' || mode === 'url') setPicking(mode);
    else onStart(mode);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {START_MODES.map((mode) => {
          const Icon = ICONS[mode.id];
          const active = picking === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={active}
              onClick={() => pick(mode.id)}
              className={`flex h-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 ${
                active ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="font-medium">{mode.label}</span>
              <span className="text-xs text-muted-foreground">{mode.description}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenQueue}
          className="flex h-full flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
        >
          <ListOrdered className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="font-medium">Queue{queueCount > 0 ? ` · ${queueCount}` : ''}</span>
          <span className="text-xs text-muted-foreground">
            The URLs waiting for their fields. Complete them one at a time or several at once, then
            send them into the forge.
          </span>
        </button>
      </div>

      {picking === 'template' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pick a format</CardTitle>
            <CardDescription>
              The forge rotates formats on its own; the one you pick is written into the brief as
              the requested shape and guides the draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplatePicker
              formats={formats}
              onPick={(format) => onStart('template', { templateKey: format.key })}
            />
          </CardContent>
        </Card>
      )}

      {picking === 'existing' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pick the piece to repurpose</CardTitle>
            <CardDescription>
              Its text is copied into a new draft as source material. The original stays as it is.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExistingPicker
              onPick={(item) =>
                onStart('existing', {
                  sourceContentId: item.id,
                  sourceTitle: item.Title || item.title || '',
                  title: `${item.Title || item.title || 'Untitled'} (repurposed)`,
                })
              }
            />
          </CardContent>
        </Card>
      )}

      {picking === 'url' && (
        <UrlIntake onStart={onStart} onQueueAdd={onQueueAdd} queueBusy={queueBusy} />
      )}
    </div>
  );
}
