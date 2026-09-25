/**
 * The build as a picture (#668): the diagram card on the page. The SVG itself
 * is LzSvg.jsx, a pure function of the layout and the focused component, so
 * the pre-rendered SVG and the hydrated one agree byte for byte; this file
 * adds what only the page wants around it.
 *
 * Every box is a button that focuses its component in the teaches panel, so
 * the diagram is a second way to ask "what is this". Zoom and pan come from
 * react-zoom-pan-pinch, which the repository already ships
 * (components/widgets/InteractiveDiagram.jsx); plain scrolling is left to
 * the page and Ctrl or Cmd with the wheel zooms, so the diagram does not
 * swallow the scroll on its way past. Colours are Tailwind `fill-*` and
 * `stroke-*` classes with dark variants, from styles.js, never inline.
 */
import React from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { layoutDiagram } from '@/lib/landingZone';
import { LzSvg } from './LzSvg';
import { HINT_CLASS, KINDS, KIND_LABEL, SWATCH_CLASS } from './styles';

// The SVG and its helpers moved to LzSvg.jsx when the article embed (#670)
// needed them without the zoom wrapper; the names stay importable from here.
export { LzSvg, componentForNode, describeLayout } from './LzSvg';

function Legend({ layout }) {
  const present = new Set(layout.nodes.map((n) => n.kind));
  const hasPeering = layout.edges.some((e) => e.kind === 'peering');
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      {KINDS.filter((kind) => present.has(kind)).map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-3 w-4 rounded-sm border ${SWATCH_CLASS[kind]}`}
          />
          {KIND_LABEL[kind]}
        </li>
      ))}
      {hasPeering ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-4 border-t-2 border-dashed border-sky-500 dark:border-sky-400"
          />
          Peering to the hub
        </li>
      ) : null}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {object} props.state  the normalised build
 * @param {string} props.focusedId  the component the teaches panel shows
 * @param {(id: string) => void} props.onFocus
 */
export function LzDiagram({ state, focusedId, onFocus }) {
  const layout = layoutDiagram(state);
  const empty = layout.nodes.length === 0;

  return (
    <Card data-testid="lz-diagram-card">
      <CardHeader>
        <CardTitle className="text-xl">Diagram</CardTitle>
        <CardDescription>
          The management group tree with the subscriptions and networks under it, redrawn as you
          build. Click a box to read about its component; drag to pan, Ctrl + scroll or pinch to
          zoom.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {empty ? (
          <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="lz-diagram-empty">
            Nothing to draw yet. Tick Management groups in the build panel to start the tree; every
            other component hangs from it.
          </p>
        ) : (
          <TransformWrapper
            minScale={0.5}
            maxScale={4}
            wheel={{ activationKeys: ['Control', 'Meta'] }}
            doubleClick={{ disabled: true }}
            panning={{ velocityDisabled: true }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Zoom in"
                    onClick={() => zoomIn()}
                  >
                    <ZoomIn className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Zoom out"
                    onClick={() => zoomOut()}
                  >
                    <ZoomOut className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Reset view"
                    onClick={() => resetTransform()}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className={HINT_CLASS}>
                    {layout.nodes.length} boxes, {layout.width} by {layout.height} units.
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                  <TransformComponent
                    wrapperStyle={{ width: '100%' }}
                    contentStyle={{ width: '100%' }}
                  >
                    <LzSvg layout={layout} focusedId={focusedId} onFocus={onFocus} />
                  </TransformComponent>
                </div>
              </>
            )}
          </TransformWrapper>
        )}
        {empty ? null : <Legend layout={layout} />}
      </CardContent>
    </Card>
  );
}
