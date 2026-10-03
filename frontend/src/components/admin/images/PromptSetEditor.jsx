/**
 * The open image set on Image Prompts (ADR 0033): four tabs.
 *
 *   Set      the shared creative brief — purpose, theme, primary prompt,
 *            style rules, what to avoid, aspect ratio, tags — with version
 *            history, duplicate, rename, archive and delete
 *   Prompts  the named variations, each with its parameters and per-slot
 *            templates (the form resets fully when you switch, so one
 *            prompt's slot text never leaks into another)
 *   Pages    which site pages generate with this set; the dropdown picks a
 *            prompt and nothing saves until Assign is pressed
 *   Images   every image generated from the set, selected / rejected / in
 *            use, and a Generate action that tries the set on a subject
 *            without leaving the page
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Copy,
  History,
  Loader2,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ConfirmModal from '@/components/admin/ConfirmModal';
import EmptyState from '@/components/admin/shared/EmptyState';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { COMMON_PROVIDERS, queryGalleryImages } from '@/lib/imageGallery';
import { resolveMediaUrl } from '@/lib/functionsBase';

export const SLOT_TEMPLATE_FIELDS = [
  {
    key: 'hero',
    label: 'Hero slot',
    placeholder: 'Cover composition guidance for the hero image.',
  },
  {
    key: 'secondary1',
    label: 'Secondary 1',
    placeholder: 'Architecture or platform detail emphasis.',
  },
  {
    key: 'secondary2',
    label: 'Secondary 2',
    placeholder: 'Implementation flow or operational motion.',
  },
  {
    key: 'secondary3',
    label: 'Secondary 3',
    placeholder: 'Business outcome or governance emphasis.',
  },
];
export const EMPTY_SLOT_TEMPLATES = Object.freeze({
  hero: '',
  secondary1: '',
  secondary2: '',
  secondary3: '',
});
export const ASPECT_RATIOS = ['', '16:9', '1:1', '4:3', '3:2', '9:16', '4:5'];

const PROVIDER_LABELS = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  finops: 'FinOps',
  vmware: 'VMware',
  terraform: 'Terraform',
  ansible: 'Ansible',
  github: 'GitHub',
  docker: 'Docker',
};
const PAGE_LABELS = {
  '': 'Landing',
  news: 'News',
  blog: 'Blog',
  'architecture-designs': 'Architecture Designs',
  frameworks: 'Frameworks',
  education: 'Education',
  'audio-architecture': 'Audio Architecture',
  tools: 'Tools',
  focus: 'Focus',
  code: 'Code',
  modules: 'Modules',
  workflows: 'Workflows',
  sandboxes: 'Sandboxes',
};

/** The allowlisted pages grouped by provider, each with a readable label. */
export function groupPages(allowedPages = []) {
  const groups = new Map();
  for (const path of allowedPages) {
    const [, provider = '', ...rest] = path.split('/');
    const suffix = rest.join('/');
    const group = groups.get(provider) || {
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      pages: [],
    };
    group.pages.push({ path, label: PAGE_LABELS[suffix] || suffix });
    groups.set(provider, group);
  }
  return [...groups.values()];
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** "this set / Hero", "Other Set / Hero", or "unassigned". */
function assignmentLabel(current, mine) {
  if (!current?.setName) return 'unassigned';
  const prompt = current.promptName ? ` / ${current.promptName}` : '';
  return mine ? `this set${prompt}` : `${current.setName}${prompt}`;
}

function setFieldsFrom(set) {
  return {
    primaryPrompt: set?.primaryPrompt || '',
    purpose: set?.purpose || '',
    theme: set?.theme || '',
    styleRules: set?.styleRules || '',
    negativePrompt: set?.negativePrompt || '',
    aspectRatio: set?.aspectRatio || '',
    tags: (set?.tags || []).join(', '),
  };
}

function promptFieldsFrom(prompt) {
  return {
    name: prompt?.name || '',
    additionalParameters: prompt?.additionalParameters || '',
    slotTemplates: { ...EMPTY_SLOT_TEMPLATES, ...(prompt?.slotTemplates || {}) },
  };
}

function imageState(image) {
  if (image.softDeletedAt) return { id: 'trash', label: 'In trash', tone: 'bad' };
  if (image.archivedAt) return { id: 'archived', label: 'Archived', tone: 'off' };
  if (image.approvalStatus === 'rejected')
    return { id: 'rejected', label: 'Rejected', tone: 'bad' };
  if (image.approvalStatus === 'approved') return { id: 'selected', label: 'Selected', tone: 'ok' };
  return { id: 'draft', label: 'Draft', tone: 'muted' };
}

function NameDialog({
  open,
  title,
  description,
  confirmLabel,
  initial,
  onConfirm,
  onCancel,
  busy,
}) {
  const [value, setValue] = useState(initial || '');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(initial || '');
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <label htmlFor="set-name-input" className="text-xs font-medium">
          Set name
        </label>
        <Input
          id="set-name-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && onConfirm(value.trim())}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(value.trim())} disabled={busy || !value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PromptSetEditor({
  set,
  isNew,
  allowedPages,
  pageAssignments,
  busy,
  onBack,
  onSaveSet,
  onCreateSet,
  onDeleteSet,
  onArchiveSet,
  onRestoreSet,
  onDuplicateSet,
  onRenameSet,
  onSavePrompt,
  onDeletePrompt,
  onAssignPage,
  onGenerateSample,
  onOpenGallery,
  onOpenImage,
}) {
  const [tab, setTab] = useState('set');
  const [newName, setNewName] = useState('');
  const [fields, setFields] = useState(() => setFieldsFrom(set));
  const [showHistory, setShowHistory] = useState(false);
  const [promptName, setPromptName] = useState(() => set?.prompts?.[0]?.name || '');
  const [promptFields, setPromptFields] = useState(() => promptFieldsFrom(set?.prompts?.[0]));
  const [pageChoice, setPageChoice] = useState({});
  const [imagesWithUsage, setImagesWithUsage] = useState(null);
  const [sample, setSample] = useState({
    promptName: '',
    slot: 'hero',
    title: '',
    summary: '',
    provider: '',
  });
  const [sampleResult, setSampleResult] = useState(null);
  const [sampleError, setSampleError] = useState('');
  const [sampling, setSampling] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [setKey, setSetKey] = useState(set?.id);
  if ((set?.id || '') !== (setKey || '')) {
    // A different set opened: every form follows it, nothing carries over.
    setSetKey(set?.id);
    setFields(setFieldsFrom(set));
    setPromptName(set?.prompts?.[0]?.name || '');
    setPromptFields(promptFieldsFrom(set?.prompts?.[0]));
    setPageChoice({});
    setImagesWithUsage(null);
    setSampleResult(null);
    setSampleError('');
  }

  const prompts = useMemo(() => set?.prompts || [], [set]);
  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.name === promptName) || null,
    [prompts, promptName]
  );
  const groups = useMemo(() => groupPages(allowedPages), [allowedPages]);
  const images = imagesWithUsage || set?.images || [];

  useEffect(() => {
    if (tab !== 'images' || !set?.name || isNew) return undefined;
    let cancelled = false;
    queryGalleryImages({ set: set.name, state: 'all', limit: 200, usage: true })
      .then((listing) => {
        if (!cancelled) setImagesWithUsage(listing.items);
      })
      .catch(() => {
        // The set's own image list (without usage) stays on screen.
      });
    return () => {
      cancelled = true;
    };
  }, [tab, set?.name, isNew]);

  const choosePrompt = (name) => {
    setPromptName(name);
    setPromptFields(promptFieldsFrom(prompts.find((p) => p.name === name)));
  };
  const startNewPrompt = () => {
    setPromptName('');
    setPromptFields(promptFieldsFrom(null));
  };
  const saveSet = () => {
    const payload = {
      ...fields,
      tags: fields.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (isNew) onCreateSet(newName.trim(), payload);
    else onSaveSet(set.name, payload);
  };
  const savePrompt = () => {
    onSavePrompt(set.name, promptFields.name.trim(), {
      additionalParameters: promptFields.additionalParameters,
      slotTemplates: promptFields.slotTemplates,
    });
    setPromptName(promptFields.name.trim());
  };
  const runSample = async () => {
    setSampling(true);
    setSampleError('');
    setSampleResult(null);
    try {
      const result = await onGenerateSample({
        setName: set.name,
        promptName: sample.promptName,
        slot: sample.slot,
        title: sample.title.trim(),
        summary: sample.summary.trim(),
        provider: sample.provider,
      });
      setSampleResult(result);
      setImagesWithUsage(null);
    } catch (err) {
      setSampleError(err?.message || 'The sample could not be generated.');
    } finally {
      setSampling(false);
    }
  };

  const canSaveSet = fields.primaryPrompt.trim() && (!isNew || newName.trim());
  const liveImages = images.filter((i) => !i.softDeletedAt && !i.archivedAt);

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={isNew ? 'New image set' : `Image set ${set.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All sets
          </Button>
          <h2 className="text-lg font-semibold">{isNew ? 'New image set' : set.name}</h2>
          {!isNew && <Badge variant="outline">v{set.version}</Badge>}
          {set?.archivedAt && (
            <StatusBadge status={{ id: 'archived', label: 'Archived', tone: 'off' }} size="xs" />
          )}
          {set?.legacy && <Badge variant="outline">Legacy</Badge>}
        </div>
        {!isNew && !set.legacy && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setDialog('rename')}
              disabled={busy}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Rename
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setDialog('duplicate')}
              disabled={busy}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Duplicate
            </Button>
            {set.archivedAt ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => onRestoreSet(set.name)}
                disabled={busy}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => onArchiveSet(set.name)}
                disabled={busy}
                title="Hide from generators and unassign its pages; keep everything"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1"
              onClick={() => setDialog('delete')}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Image set sections">
          <TabsTrigger value="set">Set</TabsTrigger>
          <TabsTrigger value="prompts" disabled={isNew}>
            Prompts ({prompts.length})
          </TabsTrigger>
          <TabsTrigger value="pages" disabled={isNew}>
            Pages ({set?.pages?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="images" disabled={isNew}>
            Images ({liveImages.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="set" className="space-y-4">
          {isNew && (
            <div>
              <label htmlFor="new-set-name" className="text-xs font-medium">
                Set name <span className="text-destructive">*</span>
              </label>
              <Input
                id="new-set-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Azure Chibi, Enterprise Hero"
                maxLength={120}
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="set-purpose" className="text-xs font-medium">
                Purpose
              </label>
              <Input
                id="set-purpose"
                value={fields.purpose}
                onChange={(e) => setFields({ ...fields, purpose: e.target.value })}
                placeholder="What this set is for, e.g. covers for Azure blog posts"
                maxLength={500}
              />
            </div>
            <div>
              <label htmlFor="set-theme" className="text-xs font-medium">
                Theme
              </label>
              <Input
                id="set-theme"
                value={fields.theme}
                onChange={(e) => setFields({ ...fields, theme: e.target.value })}
                placeholder="The visual world, e.g. chibi engineers in a glass data centre"
                maxLength={500}
              />
            </div>
          </div>
          <div>
            <label htmlFor="set-primary" className="text-xs font-medium">
              Primary prompt <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="set-primary"
              value={fields.primaryPrompt}
              onChange={(e) => setFields({ ...fields, primaryPrompt: e.target.value })}
              rows={5}
              placeholder="The shared base every image in this set starts from."
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Changing this text bumps the version; the previous text is kept in the history below.
              Images record the version they were made with.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="set-style" className="text-xs font-medium">
                Style rules
              </label>
              <Textarea
                id="set-style"
                value={fields.styleRules}
                onChange={(e) => setFields({ ...fields, styleRules: e.target.value })}
                rows={4}
                placeholder="Shared instructions appended to every prompt: palette, camera, rendering, mood."
              />
            </div>
            <div>
              <label htmlFor="set-negative" className="text-xs font-medium">
                Avoid
              </label>
              <Textarea
                id="set-negative"
                value={fields.negativePrompt}
                onChange={(e) => setFields({ ...fields, negativePrompt: e.target.value })}
                rows={4}
                placeholder="What must not appear: photorealism, text, logos, clutter."
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="set-ratio" className="text-xs font-medium">
                Aspect ratio
              </label>
              <select
                id="set-ratio"
                value={fields.aspectRatio}
                onChange={(e) => setFields({ ...fields, aspectRatio: e.target.value })}
                className={inputClass}
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio || 'default'} value={ratio}>
                    {ratio || 'Model default (16:9)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="set-tags" className="text-xs font-medium">
                Tags (comma-separated)
              </label>
              <Input
                id="set-tags"
                value={fields.tags}
                onChange={(e) => setFields({ ...fields, tags: e.target.value })}
                placeholder="azure, chibi, covers"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveSet} disabled={busy || !canSaveSet}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isNew ? 'Create set' : 'Save set'}
            </Button>
            {!isNew && set.history?.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setShowHistory(!showHistory)}
                aria-expanded={showHistory}
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                {showHistory ? 'Hide' : 'Show'} history ({set.history.length})
              </Button>
            )}
          </div>
          {showHistory && !isNew && (
            <ol className="space-y-2 rounded-lg border border-border p-3 text-xs">
              {set.history.map((entry) => (
                <li key={`${entry.version}-${entry.savedAt}`} className="space-y-1">
                  <p className="font-medium">
                    v{entry.version}
                    {entry.savedAt ? ` · ${new Date(entry.savedAt).toLocaleString()}` : ''}
                    {entry.savedBy ? ` · ${entry.savedBy}` : ''}
                  </p>
                  <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">
                    {entry.primaryPrompt}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => setFields({ ...fields, primaryPrompt: entry.primaryPrompt })}
                  >
                    Restore this text into the editor
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent
          value="prompts"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"
        >
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={startNewPrompt}
            >
              New prompt
            </Button>
            {prompts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No prompts yet. A prompt is a named variation of the set; the hero slot template is
                what the AI cover uses.
              </p>
            )}
            <ul className="space-y-1" aria-label="Prompts in this set">
              {prompts.map((prompt) => (
                <li key={prompt.id}>
                  <button
                    type="button"
                    onClick={() => choosePrompt(prompt.name)}
                    aria-pressed={promptName === prompt.name}
                    className={`w-full rounded-md border px-2 py-1.5 text-left text-sm ${promptName === prompt.name ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'}`}
                  >
                    {prompt.name}
                    {Object.values(prompt.slotTemplates || {}).some(Boolean) && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        · slot templates
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div>
              <label htmlFor="prompt-name" className="text-xs font-medium">
                Prompt name <span className="text-destructive">*</span>
              </label>
              <Input
                id="prompt-name"
                value={promptFields.name}
                onChange={(e) => setPromptFields({ ...promptFields, name: e.target.value })}
                placeholder="e.g. Hero, Deep Dive, Lego Team"
                maxLength={120}
                disabled={Boolean(selectedPrompt)}
              />
              {selectedPrompt && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Names are the prompt&apos;s id; to rename, create a new prompt and delete this
                  one.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="prompt-params" className="text-xs font-medium">
                Additional parameters
              </label>
              <Textarea
                id="prompt-params"
                value={promptFields.additionalParameters}
                onChange={(e) =>
                  setPromptFields({ ...promptFields, additionalParameters: e.target.value })
                }
                rows={3}
                placeholder="What makes this variation different: composition, props, lighting, camera angle, palette."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {SLOT_TEMPLATE_FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`slot-${field.key}`} className="text-xs font-medium">
                    {field.label} template
                  </label>
                  <Textarea
                    id={`slot-${field.key}`}
                    value={promptFields.slotTemplates[field.key]}
                    onChange={(e) =>
                      setPromptFields({
                        ...promptFields,
                        slotTemplates: {
                          ...promptFields.slotTemplates,
                          [field.key]: e.target.value,
                        },
                      })
                    }
                    rows={3}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The hero template is used by the AI cover (review queue and change feed) and by set
              samples; the secondary templates by the Submit URLs preview slots.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={savePrompt}
                disabled={busy || !promptFields.name.trim()}
              >
                {selectedPrompt ? 'Save prompt' : 'Add prompt'}
              </Button>
              {selectedPrompt && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDialog('deletePrompt')}
                  disabled={busy}
                >
                  Delete prompt
                </Button>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pages" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A page assigned to this set generates its AI covers, previews and curated images from
            it. Choose a prompt and press Assign; changing the dropdown alone saves nothing. A page
            can have one set at a time, so assigning here replaces another set&apos;s assignment.
          </p>
          {set?.archivedAt && (
            <p className="text-xs text-destructive">
              This set is archived; restore it before assigning pages.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {groups.map((group) => (
              <div key={group.provider} className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-1.5 text-xs font-semibold">
                  {group.label}
                </p>
                <ul className="divide-y divide-border/60">
                  {group.pages.map((page) => {
                    const current = pageAssignments[page.path];
                    const mine = current?.setName === set.name;
                    const choice = pageChoice[page.path] ?? (mine ? current.promptName || '' : '');
                    return (
                      <li
                        key={page.path}
                        className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-[9rem] font-medium">{page.label}</span>
                        <span className="text-muted-foreground">
                          {assignmentLabel(current, mine)}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <select
                            value={choice}
                            onChange={(e) =>
                              setPageChoice({ ...pageChoice, [page.path]: e.target.value })
                            }
                            className="rounded border border-input bg-background px-1.5 py-0.5 text-[11px]"
                            aria-label={`Prompt for ${group.label} ${page.label}`}
                            disabled={busy || Boolean(set?.archivedAt)}
                          >
                            <option value="">Primary prompt only</option>
                            {prompts.map((p) => (
                              <option key={p.id} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            disabled={busy || Boolean(set?.archivedAt)}
                            onClick={() => onAssignPage(page.path, set.name, choice)}
                          >
                            {mine ? 'Update' : 'Assign'}
                          </Button>
                          {mine && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              disabled={busy}
                              onClick={() => onAssignPage(page.path, '', '')}
                            >
                              Unassign
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <div className="rounded-lg border border-border p-3">
            <p className="flex items-center gap-1 text-sm font-semibold">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate a sample from this set
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              One hero through the same path the AI cover uses — primary prompt, the chosen
              prompt&apos;s hero template, style rules and the keyword matrix. The image lands in
              the gallery under this set. Each sample is billed by the image provider.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
              <div>
                <label htmlFor="sample-prompt" className="text-[11px] font-medium">
                  Prompt
                </label>
                <select
                  id="sample-prompt"
                  value={sample.promptName}
                  onChange={(e) => setSample({ ...sample, promptName: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Primary prompt only</option>
                  {prompts.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sample-slot" className="text-[11px] font-medium">
                  Slot
                </label>
                <select
                  id="sample-slot"
                  value={sample.slot}
                  onChange={(e) => setSample({ ...sample, slot: e.target.value })}
                  className={inputClass}
                >
                  {SLOT_TEMPLATE_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sample-provider" className="text-[11px] font-medium">
                  Provider
                </label>
                <select
                  id="sample-provider"
                  value={sample.provider}
                  onChange={(e) => setSample({ ...sample, provider: e.target.value })}
                  className={inputClass}
                >
                  {COMMON_PROVIDERS.map((p) => (
                    <option key={p.value || 'none'} value={p.value}>
                      {p.value ? p.label : 'No provider'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sample-title" className="text-[11px] font-medium">
                  Subject
                </label>
                <Input
                  id="sample-title"
                  value={sample.title}
                  onChange={(e) => setSample({ ...sample, title: e.target.value })}
                  placeholder="e.g. Scaling AKS with KEDA"
                />
              </div>
              <div className="md:col-span-3">
                <label htmlFor="sample-summary" className="text-[11px] font-medium">
                  Context (optional)
                </label>
                <Input
                  id="sample-summary"
                  value={sample.summary}
                  onChange={(e) => setSample({ ...sample, summary: e.target.value })}
                  placeholder="A sentence of context for the illustration"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  className="w-full gap-1"
                  onClick={runSample}
                  disabled={sampling || busy || Boolean(set?.archivedAt)}
                >
                  {sampling ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  {sampling ? 'Generating…' : 'Generate'}
                </Button>
              </div>
            </div>
            {sampleError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {sampleError}
              </p>
            )}
            {sampleResult && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
                <img
                  src={resolveMediaUrl(sampleResult.imageUrl)}
                  alt={`Sample from ${set.name}`}
                  className="w-full rounded-lg border border-border object-cover"
                />
                <div className="space-y-1 text-xs">
                  <p>
                    <span className="font-medium">Generated by</span> {sampleResult.imageProvider}
                    {sampleResult.imageModel ? ` · ${sampleResult.imageModel}` : ''}
                    {typeof sampleResult.costPerImageUsd === 'number'
                      ? ` · about $${sampleResult.costPerImageUsd.toFixed(3)} per image`
                      : ' · per-image price not configured (CONTENTFORGE_IMAGE_COST_USD)'}
                  </p>
                  <p>
                    <span className="font-medium">Template version</span>{' '}
                    {sampleResult.promptTemplateVersion}
                  </p>
                  <details>
                    <summary className="cursor-pointer font-medium">Prompt sent</summary>
                    <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">
                      {sampleResult.prompt}
                    </pre>
                  </details>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {images.length} image{images.length === 1 ? '' : 's'} carry this set&apos;s lineage
              {imagesWithUsage ? '' : ' (usage loading…)'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenGallery(set.name)}
            >
              Open in Image Gallery
            </Button>
          </div>
          {images.length === 0 ? (
            <EmptyState
              compact
              title="No images from this set yet"
              description="Generate a sample above, or assign the set to a page and generate a cover from the review queue."
            />
          ) : (
            <ul
              className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6"
              aria-label="Images generated from this set"
            >
              {images.map((image) => (
                <li key={image.id} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    className="block w-full focus:outline-none focus:ring-2 focus:ring-ring"
                    onClick={() => onOpenImage(image)}
                    title={image.title || image.id}
                  >
                    <img
                      src={resolveMediaUrl(image.imageUrl)}
                      alt={image.altText || image.title || ''}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  </button>
                  <div className="space-y-1 p-2 text-[10px]">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={imageState(image)} size="xs" />
                      {image.usageCount > 0 && (
                        <Badge variant="secondary">In use ({image.usageCount})</Badge>
                      )}
                      {image.slot && <Badge variant="outline">{image.slot}</Badge>}
                    </div>
                    <p className="truncate text-muted-foreground">
                      {image.promptName ? `${image.promptName} · ` : ''}
                      {image.promptTemplateVersion || ''}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {image.createdAt ? new Date(image.createdAt).toLocaleDateString() : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <NameDialog
        open={dialog === 'rename'}
        title={`Rename "${set?.name}"`}
        description="Prompts, page assignments and generated images move to the new name; the old name is kept as an alias."
        confirmLabel="Rename"
        initial={set?.name}
        busy={busy}
        onConfirm={(name) => {
          setDialog(null);
          onRenameSet(set.name, name);
        }}
        onCancel={() => setDialog(null)}
      />
      <NameDialog
        open={dialog === 'duplicate'}
        title={`Duplicate "${set?.name}"`}
        description="A copy of the set and its prompts at version 1. Page assignments and images stay with the original."
        confirmLabel="Duplicate"
        initial={set ? `${set.name} copy` : ''}
        busy={busy}
        onConfirm={(name) => {
          setDialog(null);
          onDuplicateSet(set.name, name);
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog === 'delete'}
        title={`Delete "${set?.name}"?`}
        description={`The set, its ${prompts.length} prompt${prompts.length === 1 ? '' : 's'} and its ${set?.pages?.length || 0} page assignment${set?.pages?.length === 1 ? '' : 's'} are removed. Generated images stay in the gallery and keep their lineage text. Archive instead if you may want it back.`}
        confirmLabel="Delete set"
        onConfirm={() => {
          setDialog(null);
          onDeleteSet(set.name);
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog === 'deletePrompt'}
        title={`Delete prompt "${selectedPrompt?.name}"?`}
        description="Pages assigned to this prompt fall back to the set's primary prompt."
        confirmLabel="Delete prompt"
        onConfirm={() => {
          setDialog(null);
          onDeletePrompt(set.name, selectedPrompt.name);
          startNewPrompt();
        }}
        onCancel={() => setDialog(null)}
      />
    </section>
  );
}
