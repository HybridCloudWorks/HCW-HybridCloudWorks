# Azure Layout Guidelines

## Spacing

- Keep 180px horizontal and 120px vertical gaps between 120px service containers.
- For 13+ primary services, increase to 220px and 160px.
- Keep 30px padding inside boundaries; start children below boundary labels.
- Align coordinates to 10px increments.
- Keep external actors below the title at `y >= 140`.

## Flow

Prefer left-to-right user/data flow. Use top-to-bottom for governance inheritance or CI/CD stages. Keep the global entry service outside regional boundaries and duplicated regional services inside each region.

## Edge routing

- Use `orthogonalEdgeStyle`.
- Connect icon-to-icon except for external actor containers.
- Use distinct exit/entry points for multiple connections.
- Add waypoints for non-adjacent nodes and route around containers.
- Keep at least 20px of straight clearance at arrowheads.
- Avoid connector crossings; if unavoidable, use line jumps consistently.

## Azure hierarchy

Place governance boundaries behind network and resource boundaries, with descending z-order. Do not deeply nest a decorative Region. Use a real container only for a scope whose children should move with it.

## Complex diagrams

For seven or more primary services, add 28x28 Azure-blue numbered badges and a right-side legend. Auxiliary operations services need no badges when they are not part of the main flow.

## Visual checks

Render or open the diagram and inspect:

- labels are not clipped;
- icons preserve aspect ratio;
- containers do not cover edges;
- badges do not overlap edges or labels;
- arrows reflect actual direction;
- service and boundary labels remain legible in dark and light modes.
