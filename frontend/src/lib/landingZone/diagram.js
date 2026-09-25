/**
 * The build as a picture (#667): a tidy tree of management groups with the
 * subscriptions and network pieces under them, hub peered to spokes, laid
 * out in fixed units. Pure: no viewport, no clock, no randomness, so the
 * pre-rendered SVG and the hydrated one agree byte for byte.
 *
 *   { width, height,
 *     nodes: [{ id, kind, label, x, y, w, h }],
 *     edges: [{ from, to, kind }] }
 *
 * `kind` is one of `management-group`, `policy`, `workspace`, `subscription`,
 * `vnet`, `firewall`, `dns`, `spoke`; `edges[].kind` is `contains` for the
 * tree and `peering` for hub-to-spoke. Layout is the classic one: every leaf
 * takes a slot, a parent is centred over its children, and rows are depths,
 * which is what makes nodes unable to overlap.
 */
import { normalizeState, isSelected } from './state';

export const NODE_W = 168;
export const NODE_H = 48;
export const H_GAP = 24;
export const V_GAP = 40;
export const PAD = 16;

const node = (id, kind, label, children = []) => ({ id, kind, label, children });

/** The tree for a state, before layout. Null when nothing is selected. */
function buildTree(state) {
  if (!isSelected(state, 'management-groups')) return null;
  const { options } = state;
  const root = node(`mg:${options.rootParentId}`, 'management-group', options.rootParentId);

  if (isSelected(state, 'policy')) root.children.push(node('policy', 'policy', 'Policy baseline'));

  const platform = node('mg:platform', 'management-group', 'Platform');
  if (isSelected(state, 'management')) {
    platform.children.push(
      node('mg:management', 'management-group', 'Management', [
        node('sub:management', 'workspace', 'Log Analytics + Automation'),
      ])
    );
  }
  if (isSelected(state, 'connectivity-hub')) {
    const hub = node('hub', 'vnet', `Hub VNet ${options.hubCidr}`);
    if (isSelected(state, 'firewall')) {
      hub.children.push(node('firewall', 'firewall', `Azure Firewall ${options.firewallSku}`));
    }
    if (options.privateDnsZones) hub.children.push(node('dns', 'dns', 'Private DNS zones'));
    platform.children.push(node('mg:connectivity', 'management-group', 'Connectivity', [hub]));
  }
  if (isSelected(state, 'identity')) {
    platform.children.push(
      node('mg:identity', 'management-group', 'Identity', [
        node('sub:identity', 'subscription', 'Identity subscription'),
      ])
    );
  }
  if (platform.children.length) root.children.push(platform);

  const landingZones = node('mg:landingzones', 'management-group', 'Landing zones');
  for (const [id, countId, label] of [
    ['corp', 'corpCount', 'Corp'],
    ['online', 'onlineCount', 'Online'],
  ]) {
    if (!isSelected(state, id)) continue;
    const group = node(`mg:${id}`, 'management-group', label);
    for (let i = 1; i <= options[countId]; i += 1) {
      group.children.push(node(`spoke:${id}-${i}`, 'spoke', `${label} ${i}`));
    }
    landingZones.children.push(group);
  }
  if (landingZones.children.length) root.children.push(landingZones);

  return root;
}

function subtreeWidth(n) {
  if (!n.children.length) return NODE_W;
  const childrenWidth = n.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  return Math.max(NODE_W, childrenWidth + H_GAP * (n.children.length - 1));
}

/**
 * @returns {{ width: number, height: number,
 *   nodes: Array<{ id: string, kind: string, label: string, x: number, y: number, w: number, h: number }>,
 *   edges: Array<{ from: string, to: string, kind: string }> }}
 */
export function layoutDiagram(state) {
  const normalized = normalizeState(state);
  const root = buildTree(normalized);
  if (!root) return { width: 0, height: 0, nodes: [], edges: [] };

  const nodes = [];
  const edges = [];
  let maxDepth = 0;

  const place = (n, left, depth) => {
    const width = subtreeWidth(n);
    maxDepth = Math.max(maxDepth, depth);
    nodes.push({
      id: n.id,
      kind: n.kind,
      label: n.label,
      x: left + (width - NODE_W) / 2,
      y: PAD + depth * (NODE_H + V_GAP),
      w: NODE_W,
      h: NODE_H,
    });
    let cursor = left;
    for (const child of n.children) {
      edges.push({ from: n.id, to: child.id, kind: 'contains' });
      place(child, cursor, depth + 1);
      cursor += subtreeWidth(child) + H_GAP;
    }
  };
  place(root, PAD, 0);

  if (nodes.some((n) => n.id === 'hub')) {
    for (const n of nodes) {
      if (n.kind === 'spoke' || n.id === 'sub:identity') {
        edges.push({ from: 'hub', to: n.id, kind: 'peering' });
      }
    }
  }

  return {
    width: PAD * 2 + subtreeWidth(root),
    height: PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * V_GAP,
    nodes,
    edges,
  };
}
