import { useMemo } from 'react';
import {
  GripVertical,
  Pencil,
  Trash2,
  Lightbulb,
  CheckCircle2,
  Link2,
  Image as ImageIcon,
  AlignLeft,
  FileCode2,
  Video,
  Minus,
  Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEditor } from '../context/EditorContext';
import { useDragDrop } from '../hooks/useDragDrop';

// ── Module type config ────────────────────────────────────────────────────────

const MODULE_ICONS = {
  fact: Lightbulb,
  recommendation: CheckCircle2,
  links: Link2,
  picture: ImageIcon,
  video: Video,
  text: AlignLeft,
  code: FileCode2,
  spacer: Minus,
};

const MODULE_COLORS = {
  fact: 'border-blue-500/40 bg-blue-500/5',
  recommendation: 'border-emerald-500/40 bg-emerald-500/5',
  links: 'border-blue-400/40 bg-blue-400/5',
  picture: 'border-purple-500/40 bg-purple-500/5',
  video: 'border-rose-500/40 bg-rose-500/5',
  text: 'border-sky-500/40 bg-sky-500/5',
  code: 'border-amber-500/40 bg-amber-500/5',
  spacer: 'border-slate-500/30 bg-slate-500/5',
};

// ── Board item builder ────────────────────────────────────────────────────────

/**
 * Builds a flat ordered list of {kind, ...} items from sections + modules.
 * Sections own their text. Modules sit immediately after the section
 * whose content contains their placeholder.
 */
export function buildBoardItems(sections, moduleItems, sectionModuleOffsets) {
  const items = [];
  sections.forEach((section, sIdx) => {
    items.push({ kind: 'section', sectionIndex: sIdx, section });
    const start = sectionModuleOffsets[sIdx] ?? 0;
    const end = sectionModuleOffsets[sIdx + 1] ?? moduleItems.length;
    for (let mIdx = start; mIdx < end; mIdx++) {
      items.push({ kind: 'module', globalModuleIndex: mIdx, module: moduleItems[mIdx] });
    }
  });
  return items;
}

/**
 * Given a reordered boardItems array, rebuild sections with their new module sets.
 * Returns the new sections array (content updated, structure preserved).
 *
 * Modules "float" — after a reorder, a module belongs to the last section
 * that preceded it in the board list. Modules before the first section are
 * prepended to section 0.
 */
export function applyBoardReorder(boardItems, originalSections, allModules) {
  // Assign each module to its nearest preceding section
  const sectionModuleLists = originalSections.map(() => []);
  let currentSectionIdx = 0;
  const preludeMods = []; // modules that appear before any section (edge case)

  boardItems.forEach((item) => {
    if (item.kind === 'section') {
      currentSectionIdx = item.sectionIndex;
    } else if (item.kind === 'module') {
      const target = sectionModuleLists[currentSectionIdx];
      if (target) {
        target.push(allModules[item.globalModuleIndex]);
      } else {
        preludeMods.push(allModules[item.globalModuleIndex]);
      }
    }
  });

  // For each section, strip its existing module placeholders and rebuild with new module list
  return originalSections.map((section, sIdx) => {
    const mods = sIdx === 0 ? [...preludeMods, ...sectionModuleLists[0]] : sectionModuleLists[sIdx];
    const strippedContent = section.content
      .replace(/<module[\s\S]*?<\/module>/g, '')
      .replace(/<!-- MODULE_\d+ -->/g, '')
      .trim();
    if (mods.length === 0) {
      return { ...section, content: strippedContent };
    }
    const modStrings = mods.map((m) => serializeModule(m)).join('\n\n');
    return { ...section, content: `${strippedContent}\n\n${modStrings}` };
  });
}

function serializeModule(m) {
  const { type, align = 'left' } = m;
  if (type === 'fact' || type === 'recommendation' || type === 'text' || type === 'code') {
    return `<module type="${type}" align="${align}">${m.content || ''}</module>`;
  }
  if (type === 'links' || type === 'picture' || type === 'video' || type === 'spacer') {
    const { type: _t, align: _a, ...rest } = m;
    return `<module type="${type}" align="${align}">${JSON.stringify(rest)}</module>`;
  }
  return '';
}

// ── Module preview ────────────────────────────────────────────────────────────

function getModulePreview(module) {
  if (module.type === 'picture') {
    return (
      <div className="flex items-center gap-2">
        {module.imageUrl && (
          <img
            src={module.imageUrl}
            alt={module.caption || ''}
            className="h-10 w-14 object-cover rounded border border-border shrink-0"
          />
        )}
        <span className="text-muted-foreground text-xs truncate">
          {module.caption || module.imageUrl || '—'}
        </span>
      </div>
    );
  }
  if (module.type === 'links') {
    const links = module.links || [];
    return (
      <div className="flex flex-col gap-0.5">
        {links.slice(0, 3).map((l, i) => (
          <span key={i} className="text-xs text-blue-400 truncate">
            {l.title || l.url}
          </span>
        ))}
        {links.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{links.length - 3} more</span>
        )}
      </div>
    );
  }
  if (module.type === 'spacer') {
    return (
      <span className="text-xs text-muted-foreground italic">
        {module.style || 'gradient'} spacer
      </span>
    );
  }
  if (module.type === 'video') {
    return (
      <span className="text-xs text-muted-foreground truncate">
        {module.caption || module.videoUrl || 'YouTube video'}
      </span>
    );
  }
  const text = String(module.content || '');
  return <span className="text-xs text-muted-foreground line-clamp-2">{text || '—'}</span>;
}

// ── Board cards ───────────────────────────────────────────────────────────────

function SectionBoardCard({
  item,
  boardIndex,
  dragHandlers,
  isDragging,
  isDraggingOver,
  onSelectSection,
}) {
  const dragProps = dragHandlers(boardIndex);
  let border = 'border-border';
  if (isDragging) border = 'opacity-40 border-primary/20 scale-95';
  else if (isDraggingOver) border = 'border-primary bg-primary/5 shadow-md';

  const firstLine = item.section.content.split('\n').find((l) => l.trim()) || '';
  const heading = firstLine.replace(/^#{1,6}\s+/, '').trim();
  const level = (firstLine.match(/^(#+)/) || ['', ''])[1].length || 0;

  return (
    <div
      {...dragProps}
      className={`rounded-lg border-2 bg-background px-4 py-3 transition-all duration-150 cursor-grab ${border}`}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
        <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm flex-1 truncate">{heading || item.section.title}</span>
        {level > 0 && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            H{level}
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onSelectSection(item.sectionIndex);
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ModuleBoardCard({
  item,
  boardIndex,
  dragHandlers,
  isDragging,
  isDraggingOver,
  onEditModule,
  onDeleteModule,
  onAlignChange,
}) {
  const dragProps = dragHandlers(boardIndex);
  const Icon = MODULE_ICONS[item.module.type] || Lightbulb;
  const colorClass = MODULE_COLORS[item.module.type] || 'border-border bg-background';

  let border = colorClass;
  if (isDragging) border = `${colorClass} opacity-40 scale-95`;
  else if (isDraggingOver) border = 'border-primary bg-primary/5 shadow-md';

  const ALIGN_OPTIONS = ['left', 'right', 'all'];

  return (
    <div
      {...dragProps}
      className={`rounded-lg border ml-6 px-3 py-2.5 transition-all duration-150 cursor-grab ${border}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />

        <div className="flex-1 min-w-0 space-y-1">
          {/* Header row */}
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="capitalize text-[10px] shrink-0">
              {item.module.type}
            </Badge>
            {item.module.type !== 'spacer' && (
              <div className="flex items-center gap-0.5">
                {ALIGN_OPTIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAlignChange(item.globalModuleIndex, a);
                    }}
                    className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                      item.module.align === a
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {a.charAt(0).toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content preview */}
          <div className="pl-0.5">{getModulePreview(item.module)}</div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={(e) => {
              e.stopPropagation();
              onEditModule(item.globalModuleIndex);
            }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteModule(item.globalModuleIndex);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Drop zone between items ───────────────────────────────────────────────────

function _DropZone({ boardIndex, dragHandlers, isDraggingOver }) {
  const dragProps = dragHandlers(boardIndex);
  return (
    <div
      {...dragProps}
      className={`h-2 rounded transition-all duration-150 mx-2 ${
        isDraggingOver ? 'h-8 bg-primary/20 border border-dashed border-primary' : ''
      }`}
    />
  );
}

// ── Main Board Tab ────────────────────────────────────────────────────────────

export function BoardTab() {
  const {
    sections,
    moduleItems,
    sectionModuleOffsets,
    reorderBoardItems,
    editModule,
    deleteModule,
    setModuleAlignAtIndex,
    handleSectionSelect,
    setActiveTab,
  } = useEditor();

  const boardItems = useMemo(
    () => buildBoardItems(sections, moduleItems, sectionModuleOffsets),
    [sections, moduleItems, sectionModuleOffsets]
  );

  const boardDrag = useDragDrop(boardItems, reorderBoardItems);

  if (boardItems.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No content yet. Add sections and modules in the Content and Modules tabs.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Board — {sections.length} section{sections.length !== 1 ? 's' : ''}, {moduleItems.length}{' '}
          module{moduleItems.length !== 1 ? 's' : ''}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Drag to reorder. Modules can move between sections.
        </p>
      </div>

      {boardItems.map((item, boardIndex) => {
        if (item.kind === 'section') {
          return (
            <SectionBoardCard
              key={`section-${item.sectionIndex}`}
              item={item}
              boardIndex={boardIndex}
              dragHandlers={boardDrag.dragHandlers}
              isDragging={boardDrag.isDragging(boardIndex)}
              isDraggingOver={boardDrag.isDraggingOver(boardIndex)}
              onSelectSection={(sIdx) => {
                handleSectionSelect(sIdx);
                setActiveTab('content');
              }}
            />
          );
        }

        return (
          <ModuleBoardCard
            key={`module-${item.globalModuleIndex}`}
            item={item}
            boardIndex={boardIndex}
            dragHandlers={boardDrag.dragHandlers}
            isDragging={boardDrag.isDragging(boardIndex)}
            isDraggingOver={boardDrag.isDraggingOver(boardIndex)}
            onEditModule={(idx) => {
              editModule(idx);
              setActiveTab('modules');
            }}
            onDeleteModule={deleteModule}
            onAlignChange={setModuleAlignAtIndex}
          />
        );
      })}
    </div>
  );
}
