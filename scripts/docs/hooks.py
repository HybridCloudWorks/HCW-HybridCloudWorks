"""MkDocs hook: publish the root README, CHANGELOG and TODO inside the site.

The repository-structure policy keeps these three files at the repository
root, and the documentation site wants them too. Copying them into docs/ by
hand would create a second copy that drifts, so this hook generates
repo/readme.md, repo/changelog.md and repo/todo.md in memory on every build.

Relative links inside them are written against the repository root, not the
site, so they are rewritten here:

- docs/<path>.md      -> a site-relative link to that page
- README.md / CHANGELOG.md / TODO.md -> the sibling generated page
- any other repository path -> the file on GitHub, so the link keeps working
  without the site having to know what it points at

Registered in mkdocs.yml under `hooks:`. Runs under `mkdocs build --strict`, so
a link this hook cannot make resolvable fails the build rather than shipping.
"""
from __future__ import annotations

import re
from pathlib import Path

from mkdocs.structure.files import File, Files

ROOT = Path(__file__).resolve().parents[2]
BLOB = "https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/"
SOURCES = {
    "README.md": "repo/readme.md",
    "CHANGELOG.md": "repo/changelog.md",
    "TODO.md": "repo/todo.md",
}
LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)\)")


def _rewrite(markdown: str) -> str:
    def sub(match: re.Match) -> str:
        text, href = match.group(1), match.group(2)
        if href.startswith(("http://", "https://", "mailto:", "#")):
            return match.group(0)
        base, _, fragment = href.partition("#")
        fragment = f"#{fragment}" if fragment else ""
        base = base.lstrip("./")
        if base in SOURCES:
            return f"[{text}]({Path(SOURCES[base]).name}{fragment})"
        if base == "docs" or base == "docs/":
            return f"[{text}](../index.md{fragment})"
        if base.startswith("docs/"):
            rest = base[len("docs/"):]
            if rest.endswith("/"):
                rest += "index.md"
            return f"[{text}](../{rest}{fragment})"
        return f"[{text}]({BLOB}{base}{fragment})"

    return LINK.sub(sub, markdown)


def on_files(files: Files, config) -> Files:
    for source, target in SOURCES.items():
        content = (ROOT / source).read_text(encoding="utf-8")
        files.append(File.generated(config, target, content=_rewrite(content)))
    return files
