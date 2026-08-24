/**
 * Turn stored hotspots into the on-screen positions `InteractiveDiagram` draws.
 *
 * Stored hotspots reference a draw.io **shape id**; the x/y percentages are
 * derived from the diagram XML on every load and never persisted. That is the
 * whole point: re-upload an edited diagram and every pin moves with its shape,
 * because nothing remembered where the shape used to be.
 *
 * Hand-authored `{x, y}` hotspots — the only kind this repository could write
 * before the draw.io tooling landed — pass through untouched and resolve
 * synchronously, so an existing architecture renders exactly as it did.
 *
 * Client-side only. `DOMParser` and `DecompressionStream` do not exist during
 * the prerender pass, which is why a failure here is swallowed rather than
 * thrown: a bad or unreachable diagram must leave the page standing.
 *
 * Ported from Site-Main's ArchitectureDetailTemplate (088f458), lifted out of
 * the template so the admin preview and the public page resolve identically —
 * an admin who positions a pin against different maths than the visitor sees
 * is authoring blind.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseDrawioFile } from '@/lib/drawio/parseDrawio';
import { resolveHotspots } from '@/lib/drawio/hotspotGeometry';

/**
 * @param {string|null} diagramXml raw `.drawio` XML, or an https URL to it
 * @param {Array} hotspots stored hotspots ({shapeId,…} or legacy {x,y,…})
 * @returns {Array} hotspots with x/y percentages, ready to render
 */
export function useResolvedHotspots(diagramXml, hotspots) {
  // A normalized document is a fresh object every render, so everything keys
  // on the hotspots' CONTENT rather than the array identity — an array
  // dependency would re-fire the effect on every render.
  const hotspotsJson = JSON.stringify(hotspots || []);
  const key = `${diagramXml || ''}::${hotspotsJson}`;

  // Legacy {x,y} pins resolve synchronously and render immediately.
  const legacyResolved = useMemo(
    () => resolveHotspots(JSON.parse(hotspotsJson), null).resolved,
    [hotspotsJson]
  );

  // XML-derived positions arrive async; stored with their key so a stale
  // result is ignored rather than needing a synchronous reset in the effect.
  const [derived, setDerived] = useState(null);

  useEffect(() => {
    if (!diagramXml) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const text = /^https?:\/\//.test(diagramXml)
          ? await (await fetch(diagramXml)).text()
          : diagramXml;
        const parsed = await parseDrawioFile(text);
        const { resolved } = resolveHotspots(JSON.parse(hotspotsJson), parsed);
        if (!cancelled) setDerived({ key, resolved });
      } catch {
        // A bad or unreachable diagram must not take the page down — the
        // legacy hotspots keep rendering.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, diagramXml, hotspotsJson]);

  return derived?.key === key ? derived.resolved : legacyResolved;
}

export default useResolvedHotspots;
