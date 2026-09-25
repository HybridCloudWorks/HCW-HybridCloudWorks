/**
 * The build as a picture, the SVG alone (#668, #670): the tree `layoutDiagram`
 * lays out, drawn as inline SVG with nothing that is not a function of the
 * layout and the focused component, so the pre-rendered SVG and the hydrated
 * one agree byte for byte: no viewport measurement, no random ids, no clock.
 *
 * Two callers. The page's diagram card (LzDiagram.jsx) wraps it in zoom and
 * pan and makes every box a button that focuses its component in the teaches
 * panel. The article embed (components/content/LandingZoneCard.jsx) draws it
 * read-only: `interactive={false}` leaves the boxes as plain groups with no
 * role, no tab stop and no handler, because a card in an article has no
 * teaches panel to focus. Colours are Tailwind `fill-*` and `stroke-*`
 * classes with dark variants, from styles.js, never inline.
 */
import React from 'react';
import { V_GAP } from '@/lib/landingZone';
import {
  CONTAINS_EDGE_CLASS,
  KINDS,
  KIND_LABEL,
  NODE_CLASS,
  NODE_TEXT_CLASS,
  PEERING_EDGE_CLASS,
} from './styles';

/** Diagram node id → the catalogue component it stands for, for the fixed ids. */
const NODE_COMPONENT = Object.freeze({
  policy: 'policy',
  'sub:management': 'management',
  hub: 'connectivity-hub',
  dns: 'connectivity-hub',
  firewall: 'firewall',
  'spoke:identity': 'identity',
});

/** The same for the ids that carry a suffix: every management group, and numbered spokes. */
const NODE_PREFIX_COMPONENT = Object.freeze([
  ['mg:', 'management-groups'],
  ['spoke:corp', 'corp'],
  ['spoke:online', 'online'],
]);

/** The catalogue component a diagram node stands for, or null. */
export function componentForNode(nodeId) {
  if (NODE_COMPONENT[nodeId]) return NODE_COMPONENT[nodeId];
  const match = NODE_PREFIX_COMPONENT.find(([prefix]) => nodeId.startsWith(prefix));
  return match ? match[1] : null;
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

/** The attributes that make a box a button; none when the SVG is read-only. */
function nodeInteraction({ interactive, focused, onActivate }) {
  if (!interactive) return { className: 'outline-none' };
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': focused,
    className: 'cursor-pointer outline-none focus-visible:opacity-80',
    onClick: onActivate,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

/**
 * Peering edges dip below the row the hub and spokes share, so the viewBox is
 * one gap taller when there are any.
 *
 * @param {object} props
 * @param {ReturnType<typeof import('@/lib/landingZone').layoutDiagram>} props.layout
 * @param {string|null} [props.focusedId]  the component drawn with a heavier border
 * @param {(componentId: string) => void} [props.onFocus]
 * @param {boolean} [props.interactive=true]  false draws plain boxes: no role, no tab stop
 * @param {string} [props.titleId]  the id of the `<title>` the SVG is labelled by; an
 *   article with two embeds passes each its own
 */
export function LzSvg({
  layout,
  focusedId = null,
  onFocus,
  interactive = true,
  titleId = 'lz-diagram-title',
}) {
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
      aria-labelledby={titleId}
      data-testid="lz-diagram"
      data-interactive={interactive ? 'true' : 'false'}
    >
      <title id={titleId}>{describeLayout(layout)}</title>
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
              aria-label={n.label}
              data-node={n.id}
              data-kind={n.kind}
              {...nodeInteraction({ interactive, focused, onActivate: () => activate(n.id) })}
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
