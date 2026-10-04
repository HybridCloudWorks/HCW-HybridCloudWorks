/**
 * Pure vocabulary and derivations for the image-set editor (ADR 0033):
 * the field tables each tab renders from, the labels the Pages tab shows,
 * and the small readers that turn a set, prompt or image into form values.
 * Nothing here touches React; everything is unit-tested on its own.
 */
import { COMMON_PROVIDERS } from '@/lib/imageGallery';

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

export const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The Set tab's creative brief, one entry per field, in rows: a row of two
 * renders side by side, a row of one spans the width.
 */
export const SET_FIELD_ROWS = [
  [
    {
      key: 'purpose',
      id: 'set-purpose',
      label: 'Purpose',
      kind: 'input',
      placeholder: 'What this set is for, e.g. covers for Azure blog posts',
      maxLength: 500,
    },
    {
      key: 'theme',
      id: 'set-theme',
      label: 'Theme',
      kind: 'input',
      placeholder: 'The visual world, e.g. chibi engineers in a glass data centre',
      maxLength: 500,
    },
  ],
  [
    {
      key: 'primaryPrompt',
      id: 'set-primary',
      label: 'Primary prompt',
      kind: 'textarea',
      required: true,
      rows: 5,
      placeholder: 'The shared base every image in this set starts from.',
      help:
        'Changing this text bumps the version; the previous text is kept in the history below. ' +
        'Images record the version they were made with.',
    },
  ],
  [
    {
      key: 'styleRules',
      id: 'set-style',
      label: 'Style rules',
      kind: 'textarea',
      rows: 4,
      placeholder:
        'Shared instructions appended to every prompt: palette, camera, rendering, mood.',
    },
    {
      key: 'negativePrompt',
      id: 'set-negative',
      label: 'Avoid',
      kind: 'textarea',
      rows: 4,
      placeholder: 'What must not appear: photorealism, text, logos, clutter.',
    },
  ],
  [
    {
      key: 'aspectRatio',
      id: 'set-ratio',
      label: 'Aspect ratio',
      kind: 'select',
      options: ASPECT_RATIOS.map((ratio) => ({
        value: ratio,
        label: ratio || 'Model default (16:9)',
      })),
    },
    {
      key: 'tags',
      id: 'set-tags',
      label: 'Tags (comma-separated)',
      kind: 'input',
      placeholder: 'azure, chibi, covers',
      className: 'font-mono text-sm',
    },
  ],
];
const SET_TEXT_KEYS = SET_FIELD_ROWS.flat()
  .map((field) => field.key)
  .filter((key) => key !== 'tags');

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

/** "this set / Hero", "Other Set / Hero", or "unassigned". */
export function assignmentLabel(current, mine) {
  if (!current?.setName) return 'unassigned';
  const prompt = current.promptName ? ` / ${current.promptName}` : '';
  return mine ? `this set${prompt}` : `${current.setName}${prompt}`;
}

/**
 * What one row of the Pages tab shows: whether the page is this set's, the
 * assignment label, and the prompt the dropdown displays — the unsaved
 * choice first, otherwise the saved prompt when the page is ours.
 */
export function pageRowState({ page, setName, pageAssignments, pageChoice }) {
  const current = pageAssignments[page.path];
  const mine = current?.setName === setName;
  const saved = mine ? current.promptName || '' : '';
  return {
    mine,
    label: assignmentLabel(current, mine),
    choice: pageChoice[page.path] ?? saved,
  };
}

export const promptOptions = (prompts) => [
  { value: '', label: 'Primary prompt only' },
  ...prompts.map((prompt) => ({ value: prompt.name, label: prompt.name })),
];

/** The three dropdowns of the sample form, each as `{ value, label }` rows. */
export function sampleOptions(prompts) {
  return {
    promptName: promptOptions(prompts),
    slot: SLOT_TEMPLATE_FIELDS.map((field) => ({ value: field.key, label: field.label })),
    provider: COMMON_PROVIDERS.map((provider) => ({
      value: provider.value,
      label: provider.value ? provider.label : 'No provider',
    })),
  };
}

const textOf = (value) => value || '';

export function setFieldsFrom(set) {
  const source = set || {};
  const fields = {};
  for (const key of SET_TEXT_KEYS) fields[key] = textOf(source[key]);
  fields.tags = (source.tags || []).join(', ');
  return fields;
}

/** The comma-separated tags field back into the list the server stores. */
export function parseTags(text) {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function setPayloadFrom(fields) {
  return { ...fields, tags: parseTags(fields.tags) };
}

export function promptFieldsFrom(prompt) {
  const source = prompt || {};
  return {
    name: textOf(source.name),
    additionalParameters: textOf(source.additionalParameters),
    slotTemplates: { ...EMPTY_SLOT_TEMPLATES, ...(source.slotTemplates || {}) },
  };
}

export const hasSlotTemplates = (prompt) => Object.values(prompt.slotTemplates || {}).some(Boolean);

export const findPrompt = (prompts, name) => prompts.find((prompt) => prompt.name === name) || null;

export function imageState(image) {
  if (image.softDeletedAt) return { id: 'trash', label: 'In trash', tone: 'bad' };
  if (image.archivedAt) return { id: 'archived', label: 'Archived', tone: 'off' };
  if (image.approvalStatus === 'rejected')
    return { id: 'rejected', label: 'Rejected', tone: 'bad' };
  if (image.approvalStatus === 'approved') return { id: 'selected', label: 'Selected', tone: 'ok' };
  return { id: 'draft', label: 'Draft', tone: 'muted' };
}

export const isLiveImage = (image) => !image.softDeletedAt && !image.archivedAt;

/** "1 prompt", "2 prompts". */
export const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The delete confirmation's sentence, with the set's own counts in it. */
export function deleteSetDescription(set, prompts) {
  const pages = set?.pages || [];
  return (
    `The set, its ${plural(prompts.length, 'prompt')} and its ` +
    `${plural(pages.length, 'page assignment')} are removed. Generated images stay in the ` +
    'gallery and keep their lineage text. Archive instead if you may want it back.'
  );
}

/** The sample result's provider line: model and per-image price when known. */
export function sampleProviderLine(result) {
  const model = result.imageModel ? ` · ${result.imageModel}` : '';
  const cost =
    typeof result.costPerImageUsd === 'number'
      ? ` · about $${result.costPerImageUsd.toFixed(3)} per image`
      : ' · per-image price not configured (CONTENTFORGE_IMAGE_COST_USD)';
  return `${model}${cost}`;
}
