import React from 'react';
import {
  Lightbulb,
  CheckCircle2,
  Link2,
  Image as ImageIcon,
  Video,
  ClipboardPaste,
  AlignLeft,
  FileCode2,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SPACER_STYLE_OPTIONS } from '@/components/modules/InlineModules';
import { useEditor } from '../context/EditorContext';

const MODULE_TYPES = [
  { key: 'fact', label: 'Fact', icon: Lightbulb },
  { key: 'recommendation', label: 'Tip', icon: CheckCircle2 },
  { key: 'code', label: 'Code', icon: FileCode2 },
  { key: 'text', label: 'Frame', icon: AlignLeft },
  { key: 'links', label: 'Links', icon: Link2 },
  { key: 'picture', label: 'Image', icon: ImageIcon },
  { key: 'video', label: 'Video', icon: Video },
  { key: 'spacer', label: 'Spacer', icon: Minus },
];

const ALIGN_OPTIONS = ['left', 'right', 'all'];

function getPrimaryLabel({ isEditing, atMax }) {
  if (isEditing) return 'Apply Changes';
  if (atMax) return 'Max 10 modules';
  return 'Add to Article';
}

export function ModuleForm() {
  const imageUrlInputRef = React.useRef(null);
  const {
    moduleItems,
    editingModuleIndex,
    moduleForm,
    setModuleFormField,
    applyModuleTypeSelection,
    applyModuleEdits,
    addModuleToDraft,
    resetModuleForm,
    imageCandidates,
  } = useEditor();

  const { type, align, content, imageUrl, videoUrl, caption } = moduleForm;
  const isEditing = editingModuleIndex >= 0;
  const atMax = moduleItems.length >= 10;

  function handleTypeSelect(nextType) {
    applyModuleTypeSelection(nextType, imageCandidates);
  }

  function handlePrimaryAction() {
    if (isEditing) {
      applyModuleEdits();
    } else {
      addModuleToDraft();
    }
  }

  function applyImageUrlValue(value) {
    setModuleFormField('imageUrl', String(value || '').trim());
  }

  function handleImageUrlPaste(event) {
    const pastedValue = event.clipboardData?.getData('text');
    if (!pastedValue) return;
    applyImageUrlValue(pastedValue);
  }

  function handleImageUrlDrop(event) {
    const droppedValue = event.dataTransfer?.getData('text/plain');
    if (!droppedValue) return;
    event.preventDefault();
    event.stopPropagation();
    applyImageUrlValue(droppedValue);
  }

  async function handlePasteButtonClick() {
    try {
      const clipboardValue = await navigator.clipboard?.readText?.();
      if (clipboardValue) {
        applyImageUrlValue(clipboardValue);
        imageUrlInputRef.current?.focus();
        return;
      }
    } catch {
      // Fall back to manual entry if clipboard access is blocked by the browser.
    }

    const manualValue = window.prompt('Paste the external image URL');
    if (manualValue) {
      applyImageUrlValue(manualValue);
      imageUrlInputRef.current?.focus();
    }
  }

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {isEditing ? `Editing module ${editingModuleIndex + 1}` : 'New module'}
        </p>
        <Badge variant="outline" className="text-[10px]">
          {moduleItems.length}/10
        </Badge>
      </div>

      {/* Type selector — 4 across, then 3 */}
      <div className="grid grid-cols-4 gap-1">
        {MODULE_TYPES.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            type="button"
            variant={type === key ? 'default' : 'outline'}
            size="sm"
            className="h-8 flex-col gap-0.5 text-[10px] px-1"
            onClick={() => handleTypeSelect(key)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Align row (not for spacer) */}
      {type !== 'spacer' && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground w-10 shrink-0">Align</span>
          {ALIGN_OPTIONS.map((a) => (
            <Button
              key={a}
              type="button"
              variant={align === a ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setModuleFormField('align', a)}
            >
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </Button>
          ))}
        </div>
      )}

      {/* Type-specific inputs */}
      {(type === 'fact' || type === 'recommendation' || type === 'text') && (
        <Textarea
          value={content}
          onChange={(e) => setModuleFormField('content', e.target.value)}
          className="min-h-[100px] text-sm"
          placeholder="Write the module content..."
        />
      )}

      {type === 'code' && (
        <Textarea
          value={content}
          onChange={(e) => setModuleFormField('content', e.target.value)}
          className="min-h-[100px] text-sm font-mono"
          placeholder="Paste a code snippet here..."
        />
      )}

      {type === 'links' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            One link per line. Markdown format: <code className="text-[10px]">- [Title](url)</code>
          </p>
          <Textarea
            value={content}
            onChange={(e) => setModuleFormField('content', e.target.value)}
            className="min-h-[80px] text-sm font-mono"
            placeholder="- [AWS Docs](https://docs.aws.amazon.com)"
          />
        </div>
      )}

      {type === 'picture' && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                ref={imageUrlInputRef}
                value={imageUrl}
                onChange={(e) => applyImageUrlValue(e.target.value)}
                onPaste={handleImageUrlPaste}
                onDrop={handleImageUrlDrop}
                onDragOver={(event) => event.preventDefault()}
                placeholder="https://example.com/image.png"
                className="text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handlePasteButtonClick}
              >
                <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
                Paste URL
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              External image URLs stay external. They are not copied into the Image Gallery unless
              you manually upload them there.
            </p>
          </div>
          <Input
            value={caption}
            onChange={(e) => setModuleFormField('caption', e.target.value)}
            placeholder="Caption (optional)"
            className="text-sm"
          />
          {/* Quick-pick from image candidates */}
          {imageCandidates.length > 0 && (
            <div className="grid grid-cols-4 gap-1 max-h-32 overflow-y-auto">
              {imageCandidates.slice(0, 12).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className={`rounded border overflow-hidden transition-all ${
                    imageUrl === img.imageUrl
                      ? 'ring-2 ring-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => setModuleFormField('imageUrl', img.imageUrl)}
                  title={img.label}
                >
                  <img src={img.imageUrl} alt={img.label} className="w-full h-10 object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {type === 'video' && (
        <div className="space-y-2">
          <Input
            value={videoUrl}
            onChange={(e) => setModuleFormField('videoUrl', String(e.target.value || '').trim())}
            placeholder="https://www.youtube.com/watch?v=..."
            className="text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            YouTube only. Click plays; double-click toggles 50% screen size in the published
            article.
          </p>
          <Input
            value={caption}
            onChange={(e) => setModuleFormField('caption', e.target.value)}
            placeholder="Caption (optional)"
            className="text-sm"
          />
        </div>
      )}

      {type === 'spacer' && (
        <div className="grid grid-cols-3 gap-1">
          {(SPACER_STYLE_OPTIONS || []).map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant={content === key ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setModuleFormField('content', key)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          onClick={handlePrimaryAction}
          disabled={!isEditing && atMax}
        >
          {getPrimaryLabel({ isEditing, atMax })}
        </Button>
        {isEditing && (
          <Button type="button" variant="outline" size="sm" onClick={() => resetModuleForm(type)}>
            Done
          </Button>
        )}
        {!isEditing && (
          <Button type="button" variant="ghost" size="sm" onClick={() => resetModuleForm()}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
