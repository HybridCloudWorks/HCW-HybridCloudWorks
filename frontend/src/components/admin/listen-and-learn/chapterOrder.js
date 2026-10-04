/**
 * The Library's chapter order rules (ADR 0033 §4), pure: how an open book
 * lists its chapters, and what a drag between rows or a Move button sends
 * the server — the whole order of the live chapters, once.
 */

/** The chapters in list order, archived last so the live book reads first. */
export function orderedChapters(episodes) {
  return [...episodes].sort((a, b) => {
    const aa = a.status === 'archived' ? 1 : 0;
    const bb = b.status === 'archived' ? 1 : 0;
    return aa - bb || (a.order ?? 0) - (b.order ?? 0);
  });
}

/**
 * The ids to send after moving the live chapter at `fromIndex` to `toIndex`
 * (both indexes into the live, unarchived rows), or null when the move
 * changes nothing or names a row that is not a live chapter.
 */
export function moveChapter(chapters, fromIndex, toIndex) {
  const live = chapters.filter((c) => c.status !== 'archived');
  const inRange = (index) => index >= 0 && index < live.length;
  const valid = inRange(fromIndex) && inRange(toIndex) && fromIndex !== toIndex;
  if (!valid) return null;
  const next = [...live];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((c) => c.id);
}
