# Azure Diagram Style Guide

## Visual language

Use Microsoft Azure blue as the primary accent and restrained category tints. Keep service icons unmodified and preserve their aspect ratio.

| Element | Light fill | Stroke or accent |
| --- | --- | --- |
| Azure/governance | `#EAF4FB` | `#0078D4` |
| Networking | `#E8F3FC` | `#0078D4` |
| Compute | `#F2ECFA` | `#8661C5` |
| Containers | `#E8F7FA` | `#00A4EF` |
| Data/database | `#E8F5F2` | `#008272` |
| Storage | `#FFF4CE` | `#CA5010` |
| Integration | `#FDE7F3` | `#C239B3` |
| AI | `#F3E8FF` | `#6B4EFF` |
| Identity/security | `#FDE7E9` | `#D13438` |
| Management | `#F3F2F1` | `#605E5C` |

Use `fillColor=light-dark(LIGHT_FILL,DARK_FILL);fillStyle=auto` on structural containers. Use adaptive text for custom HTML labels. Never add a hardcoded `background` attribute to `mxGraphModel`.

## Typography

- Title: 30px bold Helvetica
- Subtitle: 16px Helvetica
- Boundary: 14px bold Helvetica
- Category container: 12px bold Helvetica
- Service: 10px Helvetica
- Edge: 11px Helvetica
- Legend: 14px Helvetica

## Category containers

Place every Azure icon at 48x48 inside a 120x120 rounded category container. Set the container value to a functional category such as Edge, Compute, Messaging, Data, Identity, or Operations. Set the icon value to the service name and optional italic role.

## Boundaries

- Use solid boundaries for tenant, subscription, VNet, and intentionally strong scopes.
- Use dashed boundaries for management group, resource group, region, zone, subnet, and logical workload scopes.
- Keep Region decorative with `container=0`.
- Match label color to boundary stroke.

## Connectors

- Default: `#605E5C`, 1.5px, orthogonal, filled block arrow.
- Bidirectional/replication: arrows at both ends and an explicit label.
- Async/event: dashed line.
- Control plane/deployment: blue dashed line.
- User/data plane: solid line.
- Never encode meaning by color alone; add a label or legend.

## Sketch mode

Enable only when requested. Add `sketch=1;curveFitting=1;jiggle=2` to non-icon elements, use Comic Sans MS, and keep Azure SVG icons at `sketch=0`.
