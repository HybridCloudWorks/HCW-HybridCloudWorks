/**
 * NewsletterTemplateFields — the Template part of Newsletter settings (#557):
 * which design the email is laid out in, the built-in one or a published
 * Resend template.
 *
 * Presentational apart from reading the template list, like the Content and
 * Signup blocks: it edits the settings object the card holds and the card
 * saves the whole document. The server does the merge
 * (functions/src/lib/newsletter/template-layout.js) and falls back or refuses
 * when a template cannot be used; this block only chooses.
 *
 * The list is `GET cms/mailing-list/templates`. When it cannot be read (no
 * Resend key, rate limited, Resend refusing), the saved choice stays selected
 * and saves unchanged, and the reason is shown. Overlapping loads are
 * generation-guarded, and a failed reload clears the list it replaces.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { describeResendError } from './resendFormat';

export const TEMPLATES_ROUTE = 'cms/mailing-list/templates?limit=100';
export const RESEND_TEMPLATES_URL = 'https://resend.com/templates';

const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/** The rows the select can offer: a usable id, a trimmed name, and whether it is published. */
export function toTemplateOptions(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!TEMPLATE_ID_PATTERN.test(id)) return null;
      const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
      const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
      return { id, name, published: status === 'published' };
    })
    .filter(Boolean);
}

function useResendTemplates() {
  const [state, setState] = useState({ loading: true, templates: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    (async () => {
      try {
        const res = await getJSON(TEMPLATES_ROUTE);
        if (current()) {
          setState({ loading: false, templates: toTemplateOptions(res?.templates), error: '' });
        }
      } catch (err) {
        // No stale list after a failed refresh.
        if (current()) setState({ loading: false, templates: [], error: describeResendError(err) });
      }
    })();
    return () => {
      // Unmounting or a newer attempt: this load may no longer write state.
      if (current()) generation.current += 1;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}

/** The label for a saved id the list does not (or cannot yet) show. */
function savedOnlyLabel(templateId, { loading, error }) {
  if (loading) return `Saved template (${templateId})`;
  if (error) return `Saved template (${templateId}), list unavailable`;
  return `Saved template (${templateId}), not found in Resend`;
}

function TemplateSelect({ templateId, list, onChange }) {
  const listed = list.templates.some((template) => template.id === templateId);
  return (
    <select
      id="nl-template"
      className={SELECT_CLASS}
      value={templateId}
      onChange={(event) => onChange({ templateId: event.target.value })}
    >
      <option value="">Built-in design</option>
      {templateId && !listed && (
        <option value={templateId}>{savedOnlyLabel(templateId, list)}</option>
      )}
      {list.templates.map((template) => (
        <option key={template.id} value={template.id} disabled={!template.published}>
          {template.published ? `${template.name} (published)` : `${template.name} (not published)`}
        </option>
      ))}
    </select>
  );
}

export default function NewsletterTemplateFields({ value, onChange }) {
  const list = useResendTemplates();
  const templateId = value.templateId ?? '';
  const hasUnpublished = list.templates.some((template) => !template.published);
  return (
    <fieldset className="space-y-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">Template</legend>
      <p className="text-sm text-muted-foreground">
        In Resend, create a template and put {'{{{NEWSLETTER_BODY}}}'} where the week&apos;s
        articles should go. The postal address and unsubscribe link are added automatically if your
        template doesn&apos;t include them.{' '}
        <a
          href={RESEND_TEMPLATES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          Open Resend templates <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5 md:max-w-md">
          <Label htmlFor="nl-template">Email design</Label>
          <TemplateSelect templateId={templateId} list={list} onChange={onChange} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={list.reload}
          disabled={list.loading}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reload templates
        </Button>
      </div>
      {list.loading && (
        <p className="text-xs text-muted-foreground">Loading your Resend templates…</p>
      )}
      {list.error && (
        <p role="alert" className="text-sm text-destructive">
          Your Resend templates could not be loaded, so the saved choice is kept: {list.error}
        </p>
      )}
      {hasUnpublished && (
        <p className="text-xs text-muted-foreground">
          Templates that are not published cannot be chosen. Publish them in Resend, then reload.
        </p>
      )}
    </fieldset>
  );
}
