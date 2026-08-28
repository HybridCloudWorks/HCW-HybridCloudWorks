import { useState, useMemo, useCallback } from 'react';
import {
  parseModulesFromMarkdown,
  rebuildMarkdownWithModules,
  RAW_MODULE_TYPES,
  MAX_MODULES,
} from '@/lib/moduleParser';
import { FULL_WIDTH_MODULE_TYPES } from '@/lib/modulePairing';

// ── Pure helpers (module-private) ────────────────────────────────────────────

function parseLinksInput(value = '') {
  return String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) return { title: match[1], url: match[2] };
      return { title: line.replace(/^[-*]\s*/, ''), url: line.replace(/^[-*]\s*/, '') };
    });
}

function linksToInput(links = []) {
  return links.map((link) => `- [${link.title || link.url}](${link.url})`).join('\n');
}

// stat_board form encoding: one stat per line, `value | label | sublabel?`.
function parseStatsInput(value = '') {
  return String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statValue, label, sublabel] = line.split('|').map((part) => part.trim());
      const stat = { value: statValue || '', label: label || '' };
      if (sublabel) stat.sublabel = sublabel;
      return stat;
    });
}

function statsToInput(stats = []) {
  return stats
    .map((stat) =>
      [stat.value, stat.label, stat.sublabel]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join(' | ')
    )
    .join('\n');
}

// comparison form encoding: first line = pipe-separated columns, then one row per line.
function parseComparisonInput(value = '') {
  const lines = String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const columns = (lines[0] || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  const rows = lines.slice(1).map((line) => line.split('|').map((part) => part.trim()));
  return { columns, rows };
}

function comparisonToInput({ columns = [], rows = [] } = {}) {
  return [columns.join(' | '), ...rows.map((row) => (row || []).join(' | '))].join('\n');
}

// timeline form encoding: one step per line, `Title :: detail?`.
function parseStepsInput(value = '') {
  return String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, ...rest] = line.split('::');
      const step = { title: (title || '').trim() };
      const body = rest.join('::').trim();
      if (body) step.body = body;
      return step;
    });
}

function stepsToInput(steps = []) {
  return steps
    .map((step) => (step.body ? `${step.title} :: ${step.body}` : step.title || ''))
    .join('\n');
}

function getDefaultModuleDraft(type) {
  switch (type) {
    case 'recommendation':
      return 'Use this callout for best practices, decisions, or recommended next steps.';
    case 'code':
      return 'const message = "Add your code snippet";\nconsole.log(message);';
    case 'text':
      return 'Add framed narrative copy here.';
    case 'links':
      return '- [Reference link](https://example.com)';
    case 'picture':
      return '';
    case 'video':
      return '';
    case 'spacer':
      return 'gradient';
    case 'design':
      return 'graph TD;\n  A[Start] --> B[Finish]';
    case 'pull_quote':
      return 'One striking sentence worth restating large.';
    case 'stat_board':
      return '40% | lower cost\n3x | faster deploys';
    case 'comparison':
      return 'Dimension | Option A | Option B\nCost | $ | $$';
    case 'timeline':
      return 'Assess :: Inventory what you run today\nMigrate :: Move workloads in waves';
    case 'callout':
      return 'One or two sentences of detail.';
    case 'fact':
    default:
      return 'Add a sharp supporting insight or important fact here.';
  }
}

// stat_board, comparison and timeline always render full width; their payloads
// pin align="all" the same way spacer pins its own.
function buildRichPayloadFromForm(form) {
  const { type, align, content, attribution, title, eyebrow } = form;

  if (type === 'pull_quote') {
    const payload = { type, align, text: String(content || '').trim() };
    if (String(attribution || '').trim()) payload.attribution = attribution.trim();
    return payload;
  }
  if (type === 'stat_board') {
    return { type, align: 'all', stats: parseStatsInput(content) };
  }
  if (type === 'comparison') {
    return { type, align: 'all', ...parseComparisonInput(content) };
  }
  if (type === 'timeline') {
    return { type, align: 'all', steps: parseStepsInput(content) };
  }
  if (type === 'callout') {
    const payload = {
      type,
      align,
      title: String(title || '').trim(),
      body: String(content || '').trim(),
    };
    if (String(eyebrow || '').trim()) payload.eyebrow = eyebrow.trim();
    return payload;
  }
  return null;
}

function buildPayloadFromForm(form) {
  const { type, align, content, imageUrl, videoUrl, caption } = form;

  const richPayload = buildRichPayloadFromForm(form);
  if (richPayload) return richPayload;

  if (type === 'links') {
    return { type: 'links', align, links: parseLinksInput(content) };
  }
  if (type === 'picture') {
    return { type: 'picture', align, imageUrl, caption };
  }
  if (type === 'video') {
    return { type: 'video', align, videoUrl, caption };
  }
  if (type === 'spacer') {
    return { type: 'spacer', align: 'left', style: content || 'gradient', height: 'h-1' };
  }
  if (type === 'design') {
    return { type, align: 'all', content };
  }
  return { type, align, content };
}

/** The form's `content` textarea representation of a committed payload. */
function formContentFor(item) {
  switch (item.type) {
    case 'links':
      return linksToInput(item.links || []);
    case 'spacer':
      return item.style || 'gradient';
    case 'pull_quote':
      return item.text || '';
    case 'stat_board':
      return statsToInput(item.stats || []);
    case 'comparison':
      return comparisonToInput(item);
    case 'timeline':
      return stepsToInput(item.steps || []);
    case 'callout':
      return item.body || '';
    default:
      return item.content || '';
  }
}

/** Load a committed module payload back into the flat form representation. */
function moduleToFormState(item) {
  return {
    type: item.type || 'fact',
    align: item.align || 'left',
    content: formContentFor(item),
    imageUrl: item.imageUrl || '',
    videoUrl: item.videoUrl || '',
    caption: item.caption || '',
    attribution: item.attribution || '',
    title: item.title || '',
    eyebrow: item.eyebrow || '',
  };
}

function buildPictureModule(current, imageCandidates) {
  return {
    type: 'picture',
    align: current.type === 'spacer' ? 'left' : current.align || 'left',
    imageUrl:
      current.type === 'picture' ? current.imageUrl || '' : imageCandidates?.[0]?.imageUrl || '',
    caption: current.type === 'picture' ? current.caption || '' : '',
  };
}

function buildVideoModule(current) {
  return {
    type: 'video',
    align: current.type === 'spacer' ? 'left' : current.align || 'left',
    videoUrl: current.type === 'video' ? current.videoUrl || '' : '',
    caption: current.type === 'video' ? current.caption || '' : '',
  };
}

function buildSpacerModule(current) {
  return {
    type: 'spacer',
    align: 'left',
    style: current.type === 'spacer' ? current.style || 'gradient' : 'gradient',
    height: current.type === 'spacer' ? current.height || 'h-1' : 'h-1',
  };
}

function buildContentModule(nextType, current, defaultContent) {
  const isContentType = RAW_MODULE_TYPES.includes(current.type);
  let align = current.type === 'spacer' ? 'left' : current.align || 'left';
  if (nextType === 'design') align = 'all';
  return {
    type: nextType,
    align,
    content: isContentType ? current.content || defaultContent : defaultContent,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const INITIAL_FORM = {
  type: 'fact',
  align: 'left',
  content: getDefaultModuleDraft('fact'),
  imageUrl: '',
  videoUrl: '',
  caption: '',
  attribution: '',
  title: '',
  eyebrow: '',
};

/**
 * Manages module state.
 * The auto-sync useEffect from the old editor is intentionally removed.
 * Changes to the module form do NOT cascade to the draft until the user
 * explicitly calls applyModuleEdits() or addModuleToDraft().
 *
 * @param {string}   draft     - Current markdown draft (owned by useEditorState)
 * @param {Function} setDraft  - Stable setter from useEditorState
 */
export function useModules(draft, setDraft) {
  const [editingModuleIndex, setEditingModuleIndex] = useState(-1);
  const [moduleForm, setModuleForm] = useState(INITIAL_FORM);

  // Single parse per draft change — no double-parse
  const parsedDraft = useMemo(() => parseModulesFromMarkdown(draft), [draft]);
  const moduleItems = parsedDraft.modules;
  const parsedPreviewText = parsedDraft.text;

  // ── Form helpers ───────────────────────────────────────────────────────────

  const setModuleFormField = useCallback((field, value) => {
    setModuleForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const resetModuleForm = useCallback((nextType = 'fact') => {
    setEditingModuleIndex(-1);
    setModuleForm({
      ...INITIAL_FORM,
      type: nextType,
      content: getDefaultModuleDraft(nextType),
    });
  }, []);

  // ── Module mutations ───────────────────────────────────────────────────────

  /**
   * Commit the current form state to the draft for the module being edited.
   * Called via an explicit "Apply Changes" button — replaces the auto-sync effect.
   */
  const applyModuleEdits = useCallback(() => {
    if (editingModuleIndex < 0 || editingModuleIndex >= moduleItems.length) return;
    const payload = buildPayloadFromForm(moduleForm);
    const next = moduleItems.map((item, i) => (i === editingModuleIndex ? payload : item));
    setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));
  }, [editingModuleIndex, moduleForm, moduleItems, parsedPreviewText, setDraft]);

  /**
   * Add a new module from the current form state. Adds to the end of the draft.
   * Auto-selects the new module for editing.
   */
  const addModuleToDraft = useCallback(() => {
    if (moduleItems.length >= MAX_MODULES) return;

    const payload = buildPayloadFromForm({
      ...moduleForm,
      content: moduleForm.content?.trim()
        ? moduleForm.content
        : getDefaultModuleDraft(moduleForm.type),
    });

    // Ensure links always have at least a fallback entry
    if (payload.type === 'links' && (!payload.links || payload.links.length === 0)) {
      payload.links = parseLinksInput(getDefaultModuleDraft('links'));
    }

    const next = [...moduleItems, payload];
    setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));

    const newIndex = next.length - 1;
    setEditingModuleIndex(newIndex);

    // Load the committed payload back into the form (normalises content representation)
    setModuleForm(moduleToFormState(payload));
  }, [moduleForm, moduleItems, parsedPreviewText, setDraft]);

  /**
   * Load an existing module into the form for editing.
   * Does NOT touch the draft — changes are only committed via applyModuleEdits().
   */
  const editModule = useCallback(
    (index) => {
      const item = moduleItems[index];
      if (!item) return;

      setEditingModuleIndex(index);
      setModuleForm(moduleToFormState(item));
    },
    [moduleItems]
  );

  const deleteModule = useCallback(
    (index) => {
      const next = moduleItems.filter((_, i) => i !== index);
      setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));
      if (editingModuleIndex === index) {
        resetModuleForm(moduleForm.type);
      }
    },
    [editingModuleIndex, moduleForm.type, moduleItems, parsedPreviewText, resetModuleForm, setDraft]
  );

  const setModuleAlignAtIndex = useCallback(
    (index, align) => {
      if (!['left', 'right', 'all'].includes(align)) return;
      const next = moduleItems.map((item, i) => {
        if (i !== index || FULL_WIDTH_MODULE_TYPES.includes(item.type)) return item;
        return { ...item, align };
      });
      setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));
      // If this module is currently being edited, sync the form align field
      if (index === editingModuleIndex) {
        setModuleFormField('align', align);
      }
    },
    [editingModuleIndex, moduleItems, parsedPreviewText, setDraft, setModuleFormField]
  );

  const reorderModules = useCallback(
    (fromIndex, toIndex) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      const next = [...moduleItems];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));

      // Track editing index through the reorder
      setEditingModuleIndex((prev) => {
        if (prev === fromIndex) return toIndex;
        if (prev >= 0) {
          if (fromIndex < prev && toIndex >= prev) return prev - 1;
          if (fromIndex > prev && toIndex <= prev) return prev + 1;
        }
        return prev;
      });
    },
    [moduleItems, parsedPreviewText, setDraft]
  );

  const moveModuleItem = useCallback(
    (index, direction) => {
      const target = index + direction;
      if (target < 0 || target >= moduleItems.length) return;
      reorderModules(index, target);
    },
    [moduleItems.length, reorderModules]
  );

  /**
   * Switch module type.
   * When editing: immediately commits the type change to the draft (preserves content
   * where type families are compatible), then syncs form state.
   * When adding: only updates form state.
   */
  const applyModuleTypeSelection = useCallback(
    (nextType, imageCandidates = []) => {
      const defaultContent = getDefaultModuleDraft(nextType);

      if (editingModuleIndex >= 0) {
        const current = moduleItems[editingModuleIndex] || {};
        let nextModule;

        if (nextType === 'picture') {
          nextModule = buildPictureModule(current, imageCandidates);
        } else if (nextType === 'spacer') {
          nextModule = buildSpacerModule(current);
        } else if (nextType === 'video') {
          nextModule = buildVideoModule(current);
        } else if (RAW_MODULE_TYPES.includes(nextType)) {
          nextModule = buildContentModule(nextType, current, defaultContent);
        } else {
          // Rich JSON types: build a fresh payload from the default form draft.
          nextModule = buildPayloadFromForm({
            type: nextType,
            align: current.type === 'spacer' ? 'left' : current.align || 'left',
            content: defaultContent,
            attribution: '',
            title: nextType === 'callout' ? 'Heads up' : '',
            eyebrow: '',
          });
        }

        const next = moduleItems.map((item, i) => (i === editingModuleIndex ? nextModule : item));
        setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));

        setModuleForm(moduleToFormState(nextModule));
        return;
      }

      // Not editing — just update form
      setModuleForm({
        ...INITIAL_FORM,
        type: nextType,
        content: defaultContent,
      });
    },
    [editingModuleIndex, moduleItems, parsedPreviewText, setDraft]
  );

  return {
    moduleItems,
    parsedPreviewText,
    editingModuleIndex,
    moduleForm,
    setModuleFormField,
    resetModuleForm,
    applyModuleEdits,
    addModuleToDraft,
    editModule,
    deleteModule,
    setModuleAlignAtIndex,
    reorderModules,
    moveModuleItem,
    applyModuleTypeSelection,
  };
}
