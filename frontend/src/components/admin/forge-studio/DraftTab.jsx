/**
 * Draft — the workspace (ADR 0033 §7 slice 2).
 *
 * With no document yet, it creates one from the brief and runs the forge
 * job against it (or saves the brief as a draft and stops). With a
 * document, it shows the draft as it stands — title, summary, body, grade,
 * status — lets the text be edited and saved under the ETag, and offers the
 * AI actions, each one call to the router recorded on the document's
 * activity so AI-written text stays identifiable. A result is never applied
 * on its own: every one has an explicit "use" button.
 */
import React, { useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Flame,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { START_MODES, TONES } from './brief';
import { describeJob } from './useForgeSession';

/**
 * The AI actions, in the order the row shows them. `scope: 'selection'`
 * actions work on the selected text when there is one, else on the whole
 * body; the rest always read the whole draft. Labels match the server's
 * ASSIST_ACTIONS (forge-studio.js), which owns the prompts.
 */
export const ASSIST_ACTIONS = Object.freeze([
  { id: 'outline', label: 'Generate outline', scope: 'all' },
  { id: 'expand', label: 'Expand section', scope: 'selection' },
  { id: 'condense', label: 'Condense', scope: 'selection' },
  { id: 'rewrite', label: 'Rewrite', scope: 'selection' },
  { id: 'tone', label: 'Change tone', scope: 'selection' },
  { id: 'title', label: 'Suggest title', scope: 'all' },
  { id: 'summary', label: 'Summary', scope: 'all' },
  { id: 'metadata', label: 'Metadata', scope: 'all' },
  { id: 'social', label: 'Extract social posts', scope: 'all' },
  { id: 'claims', label: 'Check unsupported claims', scope: 'all' },
]);

/** The outline a model proposed, as markdown headings and bullets. */
export function outlineToMarkdown(outline = []) {
  return outline
    .map((section) => {
      const bullets = (section.bullets || []).map((b) => `- ${b}`).join('\n');
      return `## ${section.heading}${bullets ? `\n\n${bullets}` : ''}`;
    })
    .join('\n\n');
}

/** Replace `[start, end)` of `body` with `text`; the whole body when no range. */
export function spliceBody(body, range, text) {
  if (!range || range.start === range.end) return text;
  return `${body.slice(0, range.start)}${text}${body.slice(range.end)}`;
}

/** What the grade line says about a grade against its threshold. */
export function gradeVerdict(overall, threshold) {
  if (typeof threshold !== 'number') return '';
  return overall >= threshold ? ' · clears it' : ' · below it';
}

async function copyText(text) {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1"
      onClick={async () => {
        if (await copyText(text)) setCopied(true);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function GradeLine({ doc }) {
  const grade = doc?.forgeGrade;
  const threshold = doc?.forgeMeta?.threshold ?? doc?.forgeGrade?.threshold;
  if (!grade || typeof grade.overall !== 'number') {
    return <span className="text-xs text-muted-foreground">Not graded yet</span>;
  }
  return (
    <span className="text-xs">
      Grade <span className="font-mono font-semibold">{grade.overall}</span>
      {typeof threshold === 'number' && (
        <span className="text-muted-foreground">
          {' '}
          / threshold {threshold}
          {gradeVerdict(grade.overall, threshold)}
        </span>
      )}
      {grade.note && <span className="ml-1 text-muted-foreground">({grade.note})</span>}
    </span>
  );
}

function ActivityList({ activity = [] }) {
  const [open, setOpen] = useState(false);
  const rows = [...activity].reverse();
  let content = null;
  if (open && rows.length === 0) {
    content = (
      <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Nothing recorded yet. Every AI action and every save lands here.
      </p>
    );
  } else if (open) {
    content = (
      <ul className="divide-y divide-border/60 border-t border-border/60 text-xs">
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2">
            <span className="font-mono text-muted-foreground">
              {row.at ? new Date(row.at).toLocaleString() : ''}
            </span>
            <span className="font-medium">
              {row.action}
              {row.details?.assist ? `: ${row.details.assist}` : ''}
            </span>
            <span className="text-muted-foreground">{row.actor}</span>
            {(row.provider || row.model) && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {[row.provider, row.model].filter(Boolean).join(' / ')}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        Activity ({rows.length}) — who did what, through which model
      </button>
      {content}
    </div>
  );
}

// ── one renderer per result shape ───────────────────────────────────────────

function OutlineResult({ result, onApply }) {
  const outline = Array.isArray(result?.outline) ? result.outline : [];
  if (!outline.length) {
    return <p className="text-sm text-muted-foreground">The model returned no outline.</p>;
  }
  return (
    <>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {outline.map((section, index) => (
          <li key={index}>
            <span className="font-medium">{section.heading}</span>
            {Array.isArray(section.bullets) && section.bullets.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {section.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => onApply({ type: 'append', text: outlineToMarkdown(outline) })}
        >
          Append as headings
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onApply({ type: 'replace-all', text: outlineToMarkdown(outline) })}
        >
          Replace the draft with the outline
        </Button>
      </div>
    </>
  );
}

function TitlesResult({ result, onApply }) {
  const titles = Array.isArray(result?.titles) ? result.titles : [];
  if (!titles.length) {
    return <p className="text-sm text-muted-foreground">The model returned no titles.</p>;
  }
  return (
    <ul className="space-y-1">
      {titles.map((title) => (
        <li
          key={title}
          className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-1.5 text-sm"
        >
          <span>{title}</span>
          <Button size="sm" variant="ghost" onClick={() => onApply({ type: 'title', text: title })}>
            Use this title
          </Button>
        </li>
      ))}
    </ul>
  );
}

function MetadataRow({ label, value, action, onAction }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2">
      <span>
        <span className="text-xs text-muted-foreground">{label}</span>
        <br />
        {value}
      </span>
      {action && (
        <Button size="sm" variant="ghost" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function MetadataResult({ result, onApply }) {
  const tags = Array.isArray(result?.tags) ? result.tags : [];
  const keywords = Array.isArray(result?.seoKeywords) ? result.seoKeywords : [];
  return (
    <div className="space-y-2 text-sm">
      <MetadataRow
        label="Title"
        value={result?.title}
        action="Use"
        onAction={() => onApply({ type: 'title', text: result.title })}
      />
      <MetadataRow
        label="Summary"
        value={result?.summary}
        action="Use"
        onAction={() => onApply({ type: 'summary', text: result.summary })}
      />
      <MetadataRow
        label="Tags"
        value={tags.join(', ')}
        action="Add to SEO keywords"
        onAction={() => onApply({ type: 'keywords', text: [...tags, ...keywords].join(', ') })}
      />
      <MetadataRow label="SEO keywords" value={keywords.join(', ')} />
      <MetadataRow
        label="Slug"
        value={result?.slug ? <span className="font-mono">{result.slug}</span> : ''}
      />
    </div>
  );
}

function SocialResult({ result, contentId }) {
  const posts = Array.isArray(result?.posts) ? result.posts : [];
  return (
    <div className="space-y-2">
      {posts.map((post, index) => (
        <div
          key={`${post.network}-${index}`}
          className="rounded border border-border/60 p-3 text-sm"
        >
          <div className="mb-1 flex items-center justify-between">
            <Badge variant="secondary" className="capitalize">
              {post.network}
            </Badge>
            <CopyButton text={post.text} />
          </div>
          <p className="whitespace-pre-wrap">{post.text}</p>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Paste one into the Social Hub composer:{' '}
        <Link
          className="text-primary underline"
          to={`/admin/social?tab=compose&contentId=${encodeURIComponent(contentId)}`}
        >
          open the Social Hub with this piece selected
        </Link>
        .
      </p>
    </div>
  );
}

function ClaimsResult({ result }) {
  const claims = Array.isArray(result?.claims) ? result.claims : [];
  if (!claims.length) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300">
        The model found no claim stated without support.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {claims.map((claim, index) => (
        <li
          key={index}
          className="rounded border border-amber-300/60 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20"
        >
          <p className="font-medium">“{claim.claim}”</p>
          {claim.why && <p className="text-xs text-muted-foreground">Why: {claim.why}</p>}
          {claim.suggestion && <p className="text-xs">Suggestion: {claim.suggestion}</p>}
        </li>
      ))}
    </ul>
  );
}

function SummaryResult({ text, onApply }) {
  return (
    <>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
      <Button size="sm" onClick={() => onApply({ type: 'summary', text })}>
        Use as summary
      </Button>
    </>
  );
}

function TextResult({ text, hasSelection, onEdit, onApply }) {
  return (
    <>
      <Textarea
        aria-label="AI result"
        rows={10}
        value={text}
        onChange={(event) => onEdit(event.target.value)}
        className="font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onApply({ type: 'replace', text })}>
          {hasSelection ? 'Replace the selection' : 'Replace the draft'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onApply({ type: 'append', text })}>
          Append to the draft
        </Button>
        <CopyButton text={text} />
      </div>
    </>
  );
}

function AssistResult({
  assist,
  resultText,
  onEditText,
  hasSelection,
  contentId,
  onClose,
  onApply,
}) {
  const { action, label, result, provider, model } = assist;
  let body;
  if (action === 'outline') body = <OutlineResult result={result} onApply={onApply} />;
  else if (action === 'title') body = <TitlesResult result={result} onApply={onApply} />;
  else if (action === 'metadata') body = <MetadataResult result={result} onApply={onApply} />;
  else if (action === 'social') body = <SocialResult result={result} contentId={contentId} />;
  else if (action === 'claims') body = <ClaimsResult result={result} />;
  else if (action === 'summary') body = <SummaryResult text={resultText} onApply={onApply} />;
  else {
    body = (
      <TextResult
        text={resultText}
        hasSelection={hasSelection}
        onEdit={onEditText}
        onApply={onApply}
      />
    );
  }
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> {label}
            </CardTitle>
            <CardDescription>
              Written by{' '}
              <span className="font-mono">
                {[provider, model].filter(Boolean).join(' / ') || 'the router'}
              </span>
              . Recorded on the document&apos;s activity. Nothing is applied until you choose to.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" aria-label="Dismiss result" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{body}</CardContent>
    </Card>
  );
}

// ── before the document exists ──────────────────────────────────────────────

function GeneratePanel({ session, template, onBrief }) {
  const { brief, title, busy, job } = session;
  const mode = START_MODES.find((m) => m.id === brief.mode);
  const generating = busy === 'generate';
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title || 'Untitled'}</CardTitle>
        <CardDescription>
          {mode?.label}
          {template ? ` · ${template.label}` : ''} · publishes to {brief.targetChannel} · kind{' '}
          <span className="font-mono">{brief.kind}</span> · origin{' '}
          <span className="font-mono">{brief.ideaOrigin}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {brief.objective && <p className="text-sm">{brief.objective}</p>}
        <p className="text-xs text-muted-foreground">
          Generate creates the document on the Drafts page first (status Drafting), saves the brief,
          kind and idea origin on it, then runs the forge: it writes, scrubs, grades and stages the
          draft as forge_ready above the publish threshold, otherwise editing.
        </p>
        {job && (
          <div
            className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
            role="status"
          >
            {generating && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            )}
            <span>{describeJob(job)}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => session.generate({ templateLabel: template?.label })}
            disabled={Boolean(busy)}
            className="gap-1"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Flame className="h-4 w-4" />
            )}
            Generate the first draft
          </Button>
          <Button
            variant="outline"
            onClick={() => session.saveAsDraft({ templateLabel: template?.label })}
            disabled={Boolean(busy)}
            className="gap-1"
          >
            {busy === 'create' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save the brief as a draft (no AI)
          </Button>
          <Button variant="ghost" onClick={onBrief}>
            Edit the brief
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DraftToolbar({ session, template }) {
  const { doc, busy, loading, dirty, contentId } = session;
  const generating = busy === 'generate';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge content={doc} />
      <GradeLine doc={doc} />
      {doc.format && <Badge variant="outline">format: {doc.format}</Badge>}
      {doc.kind && <Badge variant="outline">kind: {doc.kind}</Badge>}
      {doc.ideaOrigin && <Badge variant="outline">origin: {doc.ideaOrigin}</Badge>}
      <span className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={Boolean(busy) || loading}
          onClick={() => session.loadDoc(contentId)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={Boolean(busy)}
          onClick={() => session.generate({ templateLabel: template?.label })}
          title="Runs the forge again against this document; the body is rewritten and a version is kept."
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Flame className="h-3.5 w-3.5" />
          )}
          Regenerate
        </Button>
        <Button
          size="sm"
          className="gap-1"
          disabled={busy === 'save' || !dirty}
          onClick={() => session.save()}
        >
          {busy === 'save' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </span>
    </div>
  );
}

function AssistPanel({
  busy,
  pendingAction,
  canRun,
  instruction,
  tone,
  onInstruction,
  onTone,
  onRun,
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> AI actions
        </CardTitle>
        <CardDescription>
          One call each, through the AI Engine&apos;s route for “Forge Studio assist”. Every result
          is editable and nothing is applied until you say so.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="assist-instruction">Direction (optional)</Label>
          <Input
            id="assist-instruction"
            value={instruction}
            onChange={(event) => onInstruction(event.target.value)}
            placeholder="e.g. add a cost comparison; keep the code blocks"
          />
        </div>
        <div>
          <Label htmlFor="assist-tone">Tone (for Change tone)</Label>
          <select
            id="assist-tone"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={tone}
            onChange={(event) => onTone(event.target.value)}
          >
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {ASSIST_ACTIONS.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant="outline"
              disabled={Boolean(busy) || !canRun}
              onClick={() => onRun(action.id)}
            >
              {pendingAction === action.id ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {action.label}
            </Button>
          ))}
        </div>
        {busy === 'assist' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the model…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * @param {{
 *   session: ReturnType<typeof import('./useForgeSession').useForgeSession>,
 *   formats: Array<{key: string, label: string}>,
 *   onBrief: () => void, onFinish: () => void,
 * }} props
 */
export default function DraftTab({ session, formats = [], onBrief, onFinish }) {
  const { doc, text, brief, title, busy, job, assistResult, conflict, contentId } = session;
  const bodyRef = useRef(null);
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState(TONES[0]);
  const [resultText, setResultText] = useState('');
  const [range, setRange] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const template = formats.find((f) => f.key === brief.templateKey);

  if (!doc && !title.trim() && !contentId) {
    return (
      <EmptyState
        title="No brief yet"
        description="Start from an idea, a template, existing content or a URL, write the brief, and the draft is created from it here."
        action={<Button onClick={onBrief}>Go to the brief</Button>}
      />
    );
  }
  if (!doc) {
    return <GeneratePanel session={session} template={template} onBrief={onBrief} />;
  }

  const selectionRange = () => {
    const el = bodyRef.current;
    if (!el) return null;
    const { selectionStart, selectionEnd } = el;
    return selectionStart !== selectionEnd ? { start: selectionStart, end: selectionEnd } : null;
  };

  const runAction = async (actionId) => {
    const spec = ASSIST_ACTIONS.find((a) => a.id === actionId);
    const selected = spec?.scope === 'selection' ? selectionRange() : null;
    const source = selected ? text.body.slice(selected.start, selected.end) : text.body;
    if (!source.trim()) return;
    setRange(selected);
    setPendingAction(actionId);
    try {
      const result = await session.assist(actionId, { text: source, instruction, tone });
      if (result && typeof result.result?.text === 'string') setResultText(result.result.text);
    } finally {
      setPendingAction(null);
    }
  };

  const apply = ({ type, text: value }) => {
    switch (type) {
      case 'title':
        session.setText('title', value);
        break;
      case 'summary':
        session.setText('summary', value);
        break;
      case 'keywords':
        session.setBrief('seoKeywords', [brief.seoKeywords, value].filter(Boolean).join(', '));
        break;
      case 'replace':
        session.setText('body', spliceBody(text.body, range, value));
        break;
      case 'replace-all':
        session.setText('body', value);
        break;
      case 'append':
        session.setText('body', `${text.body.trimEnd()}\n\n${value}`.trim());
        break;
      default:
        break;
    }
    session.clearAssist();
  };

  const hasSelection = Boolean(range && range.start !== range.end);

  return (
    <div className="space-y-4">
      <DraftToolbar session={session} template={template} />

      {job && busy === 'generate' && (
        <div
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>{describeJob(job)}</span>
        </div>
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30"
        >
          <span>
            This draft changed elsewhere since you opened it. Your text is kept here; reload to see
            the latest, then re-apply what you need.
          </span>
          <Button size="sm" variant="outline" onClick={() => session.loadDoc(contentId)}>
            Reload the latest
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-3">
          <div>
            <Label htmlFor="draft-title">Title</Label>
            <Input
              id="draft-title"
              value={text.title}
              onChange={(event) => session.setText('title', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="draft-summary">Summary</Label>
            <Textarea
              id="draft-summary"
              rows={2}
              value={text.summary}
              onChange={(event) => session.setText('summary', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="draft-body">Body (markdown)</Label>
            <Textarea
              id="draft-body"
              ref={bodyRef}
              rows={24}
              value={text.body}
              onChange={(event) => session.setText('body', event.target.value)}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Select a passage before Expand, Condense, Rewrite or Change tone to work on it alone;
              otherwise the whole body is used.
            </p>
          </div>
          <ActivityList activity={doc.activity} />
        </div>

        <div className="space-y-3">
          <AssistPanel
            busy={busy}
            pendingAction={pendingAction}
            canRun={Boolean(text.body.trim())}
            instruction={instruction}
            tone={tone}
            onInstruction={setInstruction}
            onTone={setTone}
            onRun={runAction}
          />

          {assistResult && !busy && (
            <AssistResult
              assist={assistResult}
              resultText={resultText}
              onEditText={setResultText}
              hasSelection={hasSelection}
              contentId={contentId}
              onClose={session.clearAssist}
              onApply={apply}
            />
          )}

          <Button variant="secondary" className="w-full" onClick={onFinish}>
            Next steps for this piece
          </Button>
        </div>
      </div>
    </div>
  );
}
