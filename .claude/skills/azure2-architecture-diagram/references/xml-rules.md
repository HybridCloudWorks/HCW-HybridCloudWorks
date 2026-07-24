# Azure2 XML Generation Rules

## Required document

```xml
<mxfile host="Electron" version="29.6.1">
  <diagram name="Page-1" id="diagram-1">
    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1400" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

Keep XML uncompressed. Use unique descriptive IDs.

## Azure2 icon style

```text
image;aspect=fixed;html=1;points=[];align=center;verticalAlign=top;verticalLabelPosition=bottom;fontSize=10;fontFamily=Helvetica;image=img/lib/azure2/networking/Front_Doors.svg
```

Use an exact catalog path. The Azure2 palette is image-based; do not write `shape=mxgraph.azure2.*` or legacy `shape=mxgraph.azure.*` for current service icons.

## Labels

- Category container `value`: functional role, for example Edge, Compute, Data, or Identity.
- Icon `value`: service name plus optional italic role.
- Escape HTML inside attributes: `Azure Functions&lt;div&gt;&lt;i&gt;API handlers&lt;/i&gt;&lt;/div&gt;`.

## Groups

- Put children of real containers under their container ID using relative coordinates.
- Keep Region `container=0`; place visible regional services under the nearest real parent with absolute coordinates.
- Do not use resource groups as network boundaries.
- Prefer flat layouts unless the hierarchy conveys actual governance, deployment, or networking scope.

## Edges and labels

Connect to service icons. Use separate child cells for edge labels:

```xml
<mxCell id="edge-api-data" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=#605E5C;strokeWidth=1.5;fontFamily=Helvetica;" edge="1" parent="1" source="api-icon" target="data-icon">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
<mxCell id="edge-api-data-label" value="queries" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];fontSize=11;fontFamily=Helvetica;" connectable="0" vertex="1" parent="edge-api-data">
  <mxGeometry relative="1" x="0" y="-1" as="geometry"><mxPoint as="offset" /></mxGeometry>
</mxCell>
```

Add explicit waypoints when routing would cross a service or label.

## XML safety

- Escape `&`, `<`, `>`, and quotes in attribute values.
- Never put `--` inside XML comments.
- Never reference missing cells.
- Never add a fixed model background that breaks adaptive contrast.
