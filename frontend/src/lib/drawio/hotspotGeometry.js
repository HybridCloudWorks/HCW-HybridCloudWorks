/**
 * Derive on-screen hotspot positions from diagram geometry.
 *
 * Stored hotspots reference a draw.io **shape id**; the x/y percentages that
 * `InteractiveDiagram` renders are computed here from the parsed XML on every
 * load, never persisted. That is the whole point of the design: re-upload an
 * edited diagram and every pin moves with its shape, because nothing remembered
 * where the shape used to be.
 *
 * Percentages are taken against the diagram **bounds** (union of all shapes),
 * because that is the frame draw.io's own export crops to — the coordinate
 * space of the image visitors actually see.
 */

/**
 * @param {Array<{shapeId?: string, x?: number, y?: number, label, description, link}>} hotspots
 * @param {{shapes: Array, bounds: Object|null}|null} parsed - from parseDrawio; null when no XML exists
 * @returns {{resolved: Array, unresolved: Array}} resolved carries the
 *   `{id, x, y, label, description, link}` shape InteractiveDiagram expects;
 *   unresolved lists hotspots whose shapeId no longer exists in the diagram —
 *   surface these in authoring UIs, never render them at a guessed position.
 */
export function resolveHotspots(hotspots = [], parsed = null) {
  const resolved = [];
  const unresolved = [];
  const byId = new Map((parsed?.shapes || []).map((shape) => [shape.id, shape]));
  const bounds = parsed?.bounds || null;

  hotspots.forEach((hotspot, index) => {
    if (!hotspot) return;

    if (hotspot.shapeId) {
      const shape = byId.get(hotspot.shapeId);
      if (!shape || !bounds || !bounds.width || !bounds.height) {
        unresolved.push(hotspot);
        return;
      }
      resolved.push({
        ...hotspot,
        id: hotspot.id || hotspot.shapeId,
        x: toPercent(shape.centerX - bounds.minX, bounds.width),
        y: toPercent(shape.centerY - bounds.minY, bounds.height),
      });
      return;
    }

    // Legacy form: percentages were authored by hand (ArchitectureReviewBoard
    // still writes these). Pass them through untouched.
    if (Number.isFinite(hotspot.x) && Number.isFinite(hotspot.y)) {
      resolved.push({ ...hotspot, id: hotspot.id || `hotspot-${index}` });
      return;
    }

    unresolved.push(hotspot);
  });

  return { resolved, unresolved };
}

function toPercent(value, total) {
  const percent = (value / total) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100;
}
