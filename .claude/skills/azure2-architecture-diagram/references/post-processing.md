# Post-processing and Validation

No validation hook is bundled in this package. Run equivalent deterministic checks after every write.

1. Parse the XML.
2. Require the full `mxfile/diagram/mxGraphModel/root` structure and cells `0` and `1`.
3. Require unique `mxCell` IDs.
4. Validate all `parent`, `source`, and `target` references.
5. Reject compressed diagram content.
6. Reject illegal `--` inside XML comments.
7. Extract `image=img/lib/azure2/...svg` values and compare them with the two Azure2 catalogs.
8. Confirm text-bearing styles use Helvetica, except requested sketch mode.
9. Render/open for overlap and clipping checks when possible.

Report structural and visual validation separately. Never describe a file as visually verified based only on XML parsing.
