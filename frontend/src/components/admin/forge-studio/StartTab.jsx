/**
 * Start — the five ways a piece begins (ADR 0033 §7 slice 2). Each card
 * seeds the brief for its mode and moves to the Brief tab; nothing is
 * written until the Brief or Draft tab says so.
 */
import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Globe,
  LayoutTemplate,
  Lightbulb,
  Loader2,
  Search,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { getJSON } from '@/lib/api';
import { START_MODES } from './brief';

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

/**
 * @param {{ formats: Array<{key: string, label: string, wordRange?: number[]}>, onStart: (mode: string, extras?: object) => void }} props
 */
export default function StartTab({ formats = [], onStart }) {
  const [picking, setPicking] = useState(null); // 'template' | 'existing' | 'url' | null
  const [url, setUrl] = useState('');

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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Forge from a URL</CardTitle>
            <CardDescription>
              The page is scraped into a source document and forged from there. The brief you write
              next is saved onto the result.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (url.trim()) onStart('url', { sourceUrl: url.trim() });
              }}
            >
              <div className="flex-1">
                <Label htmlFor="forge-start-url">Source URL</Label>
                <Input
                  id="forge-start-url"
                  type="url"
                  required
                  placeholder="https://learn.microsoft.com/…"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={!url.trim()} className="gap-1">
                Continue to the brief <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
