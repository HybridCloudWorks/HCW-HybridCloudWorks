import { useState, useMemo, useCallback } from 'react';
import { parseModulesFromMarkdown, rebuildMarkdownWithModules } from '@/lib/moduleParser';

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
    case 'fact':
    default:
      return 'Add a sharp supporting insight or important fact here.';
  }
}

function buildPayloadFromForm(form) {
  const { type, align, content, imageUrl, videoUrl, caption } = form;

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
  return { type, align, content };
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
  const isContentType = ['fact', 'recommendation', 'text', 'code'].includes(current.type);
  return {
    type: nextType,
    align: current.type === 'spacer' ? 'left' : current.align || 'left',
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
      type: nextType,
      align: 'left',
      content: getDefaultModuleDraft(nextType),
      imageUrl: '',
      videoUrl: '',
      caption: '',
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
    if (moduleItems.length >= 10) return;

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
    let formContent = payload.content || '';
    let formImageUrl = '';
    let formVideoUrl = '';
    let formCaption = '';
    if (payload.type === 'links') {
      formContent = linksToInput(payload.links || []);
    } else if (payload.type === 'spacer') {
      formContent = payload.style || 'gradient';
    } else if (payload.type === 'picture') {
      formContent = '';
      formImageUrl = payload.imageUrl || '';
      formCaption = payload.caption || '';
    } else if (payload.type === 'video') {
      formContent = '';
      formVideoUrl = payload.videoUrl || '';
      formCaption = payload.caption || '';
    }
    setModuleForm({
      type: payload.type,
      align: payload.align || 'left',
      content: formContent,
      imageUrl: formImageUrl,
      videoUrl: formVideoUrl,
      caption: formCaption,
    });
  }, [moduleForm, moduleItems, parsedPreviewText, setDraft]);

  /**
   * Load an existing module into the form for editing.
   * Does NOT touch the draft — changes are only committed via applyModuleEdits().
   */
  const editModule = useCallback(
    (index) => {
      const item = moduleItems[index];
      if (!item) return;

      let content = item.content || '';
      if (item.type === 'links') content = linksToInput(item.links || []);
      else if (item.type === 'spacer') content = item.style || 'gradient';

      setEditingModuleIndex(index);
      setModuleForm({
        type: item.type || 'fact',
        align: item.align || 'left',
        content,
        imageUrl: item.imageUrl || '',
        videoUrl: item.videoUrl || '',
        caption: item.caption || '',
      });
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
        if (i !== index || item.type === 'spacer') return item;
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
        } else {
          nextModule = buildContentModule(nextType, current, defaultContent);
        }

        const next = moduleItems.map((item, i) => (i === editingModuleIndex ? nextModule : item));
        setDraft(rebuildMarkdownWithModules(parsedPreviewText, next));

        setModuleForm({
          type: nextModule.type,
          align: nextModule.align || 'left',
          content: nextModule.content || nextModule.style || defaultContent,
          imageUrl: nextModule.imageUrl || '',
          videoUrl: nextModule.videoUrl || '',
          caption: nextModule.caption || '',
        });
        return;
      }

      // Not editing — just update form
      setModuleForm({
        type: nextType,
        align: 'left',
        content: defaultContent,
        imageUrl: '',
        videoUrl: '',
        caption: '',
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
