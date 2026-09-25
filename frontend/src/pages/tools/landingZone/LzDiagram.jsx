/**
 * The build as a picture (#668): the tree `layoutDiagram` lays out, drawn as
 * inline SVG. The layout is pure and in fixed units, and this file adds
 * nothing that is not a function of it and the focused component, so the
 * pre-rendered SVG and the hydrated one agree byte for byte: no viewport
 * measurement, no random ids, no clock.
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
import { V_GAP, layoutDiagram } from '@/lib/landingZone';
import {
  CONTAINS_EDGE_CLASS,
  HINT_CLASS,
  KINDS,
  KIND_LABEL,
  NODE_CLASS,
  NODE_TEXT_CLASS,
  PEERING_EDGE_CLASS,
  SWATCH_CLASS,
} from './styles';

/** The catalogue component a diagram node stands for, or null. */
export function componentForNode(nodeId) {
  if (nodeId.startsWith('mg:')) return 'management-groups';
  if (nodeId === 'policy') return 'policy';
  if (nodeId === 'sub:management') return 'management';
  if (nodeId === 'hub' || nodeId === 'dns') return 'connectivity-hub';
  if (nodeId === 'firewall') return 'firewall';
  if (nodeId === 'spoke:identity') return 'identity';
  if (nodeId.startsWith('spoke:corp')) return 'corp';
  if (nodeId.startsWith('spoke:online')) return 'online';
  return null;
}

/** One sentence for the SVG's title: what is in the picture. */
export function describeLayout(layout) {
  const counts = new Map();
  for (const n of layout.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const parts = KINDS.filter((kind) => counts.has(kind)).map((kind) => {
    const count = counts.get(kind);
    const label = KIND_LABEL[kind].toLowerCase();
    return count === 1 ? `1 ${label}` : `${count} ${label}s`;
  });
  return `Landing zone diagram: ${parts.join(', ')}.`;
}

const bottomCentre = (n) => [n.x + n.w / 2, n.y + n.h];
const topCentre = (n) => [n.x + n.w / 2, n.y];

/**
 * The SVG alone, for the page and for the determinism test. Peering edges
 * dip below the row the hub and spokes share, so the viewBox is one gap
 * taller when there are any.
 */
export function LzSvg({ layout, focusedId, onFocus }) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const hasPeering = layout.edges.some((e) => e.kind === 'peering');
  const height = layout.height + (hasPeering ? V_GAP : 0);

  const activate = (nodeId) => {
    const componentId = componentForNode(nodeId);
    if (componentId && onFocus) onFocus(componentId);
  };

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${height}`}
      width="100%"
      className="block h-auto w-full"
      aria-labelledby="lz-diagram-title"
      data-testid="lz-diagram"
    >
      <title id="lz-diagram-title">{describeLayout(layout)}</title>
      <g data-edges="contains">
        {layout.edges
          .filter((e) => e.kind === 'contains')
          .map((e) => {
            const [x1, y1] = bottomCentre(byId.get(e.from));
            const [x2, y2] = topCentre(byId.get(e.to));
            return (
              <line
                key={`${e.from}>${e.to}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={1.5}
                className={CONTAINS_EDGE_CLASS}
              />
            );
          })}
      </g>
      <g data-edges="peering">
        {layout.edges
          .filter((e) => e.kind === 'peering')
          .map((e) => {
            const [hx, hy] = bottomCentre(byId.get(e.from));
            const [sx, sy] = bottomCentre(byId.get(e.to));
            const d = `M ${hx} ${hy} C ${hx} ${hy + V_GAP} ${sx} ${sy + V_GAP} ${sx} ${sy}`;
            return (
              <path
                key={`${e.from}~${e.to}`}
                d={d}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                className={PEERING_EDGE_CLASS}
              />
            );
          })}
      </g>
      <g data-nodes="">
        {layout.nodes.map((n) => {
          const componentId = componentForNode(n.id);
          const focused = componentId !== null && componentId === focusedId;
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={n.label}
              aria-pressed={focused}
              data-node={n.id}
              data-kind={n.kind}
              className="cursor-pointer outline-none focus-visible:opacity-80"
              onClick={() => activate(n.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activate(n.id);
                }
              }}
            >
              <title>{n.label}</title>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={8}
                strokeWidth={focused ? 3 : 1.5}
                className={NODE_CLASS[n.kind]}
              />
              <text
                x={n.x + n.w / 2}
                y={n.y + n.h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={n.kind === 'management-group' ? 600 : 400}
                className={NODE_TEXT_CLASS}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

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
