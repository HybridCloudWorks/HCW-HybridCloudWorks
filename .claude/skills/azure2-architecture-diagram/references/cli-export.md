# draw.io CLI Export

Use draw.io desktop to export only when requested.

## Locate the executable

- Windows: `C:\Program Files\draw.io\draw.io.exe`
- macOS: `/Applications/draw.io.app/Contents/MacOS/draw.io`
- Linux: `drawio`

Check `drawio` on PATH first (`where.exe drawio` on Windows, `command -v drawio` on Unix).

## Export

```text
drawio -x -f <png|svg|pdf> -e -b 10 -o <output> <input.drawio>
```

- `-x`: export
- `-f`: format
- `-e`: embed editable diagram data
- `-b 10`: add a 10px border
- `-o`: output path
- `-t`: transparent PNG
- `-s`: scale
- `--width` or `--height`: fit while preserving aspect ratio
- `-a`: all PDF pages
- `-p`: zero-based page index

Use double extensions such as `platform.drawio.svg`. Do not delete the `.drawio` source unless the user explicitly requests cleanup. Verify that the exported file exists and is non-empty; successful XML creation alone does not prove visual quality.
