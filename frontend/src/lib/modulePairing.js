/**
 * Module pairing rules shared by the public article renderer
 * (BlogDetailTemplate) and the editor preview (PreviewPanel) — the two must
 * pair identically or the preview lies about the published layout.
 */

/**
 * Types that always render full width: they can never sit in a two-column
 * pair regardless of their align attribute.
 */
export const FULL_WIDTH_MODULE_TYPES = ['spacer', 'stat_board', 'comparison', 'timeline', 'design'];

/**
 * True when `value` is nothing but markdown headings (and blank lines) — the
 * one kind of text segment allowed to sit between two paired modules.
 */
export function isHeadingOnlyTextSegment(value = '') {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!normalized) return false;
  return (
    /^#{1,6}\s+.+$/m.test(normalized) &&
    normalized.split('\n').every((line) => !line.trim() || /^#{1,6}\s+.+$/.test(line.trim()))
  );
}

/**
 * True when two adjacent modules should render side by side: opposite
 * left/right aligns, and neither is a full-width type or align="all".
 */
export function canPairModules(currentModule, nextModule) {
  if (!currentModule || !nextModule) return false;
  if (
    FULL_WIDTH_MODULE_TYPES.includes(currentModule.type) ||
    FULL_WIDTH_MODULE_TYPES.includes(nextModule.type)
  ) {
    return false;
  }
  if (currentModule.align === 'all' || nextModule.align === 'all') return false;
  return (
    (currentModule.align === 'left' && nextModule.align === 'right') ||
    (currentModule.align === 'right' && nextModule.align === 'left')
  );
}
