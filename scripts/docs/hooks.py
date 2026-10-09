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
- an image under docs/ -> a site-relative path to the same file, which the
  site publishes; any other image -> the raw file on GitHub

Registered in mkdocs.yml under `hooks:`. Runs under `mkdocs build --strict`, so
a link this hook cannot make resolvable fails the build rather than shipping.
"""
from __future__ import annotations

import re
from pathlib import Path

from mkdocs.structure.files import File, Files

ROOT = Path(__file__).resolve().parents[2]
BLOB = "https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/"
SOURCES = {
    "README.md": "repo/readme.md",
    "CHANGELOG.md": "repo/changelog.md",
    "TODO.md": "repo/todo.md",
}
LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)\)")
IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
RAW = "https://raw.githubusercontent.com/saulpatinojr/HCW-HybridCloudWorks/main/"
DOCS_PREFIX = "docs/"


def _target(href: str) -> str:
    """Where a link written against the repository root points once the page
    lives on the site. External links pass through untouched."""
    if href.startswith(("http://", "https://", "mailto:", "#")):
        return href
    base, _, fragment = href.partition("#")
    fragment = f"#{fragment}" if fragment else ""
    # Strip a leading "./" or "/", never a bare ".": `lstrip("./")` treated
    # its argument as a set of characters and turned `.github/CONTRIBUTING.md`
    # into `github/CONTRIBUTING.md`, a 404 on GitHub.
    while base.startswith("./"):
        base = base[2:]
    base = base.lstrip("/")
    if base in SOURCES:
        target = Path(SOURCES[base]).name
    elif base in ("docs", DOCS_PREFIX):
        target = "../index.md"
    elif base.startswith(DOCS_PREFIX):
        rest = base[len(DOCS_PREFIX):]
        target = f"../{rest}index.md" if rest.endswith("/") else f"../{rest}"
    else:
        target = f"{BLOB}{base}"
    return f"{target}{fragment}"


def _image(src: str) -> str:
    """Where an image written against the repository root is once the page
    lives on the site: a file under docs/ is published by the site itself, so
    it is linked site-relative; anything else comes from GitHub raw."""
    if src.startswith(("http://", "https://", "data:")):
        return src
    while src.startswith("./"):
        src = src[2:]
    src = src.lstrip("/")
    if src.startswith(DOCS_PREFIX):
        return f"../{src[len(DOCS_PREFIX):]}"
    return f"{RAW}{src}"


def _rewrite(markdown: str) -> str:
    """The page with every image and link pointed where it lives once on the site."""

    def sub(match: re.Match) -> str:
        """One link, its target rewritten."""
        return f"[{match.group(1)}]({_target(match.group(2))})"

    def image(match: re.Match) -> str:
        """One image, its source rewritten."""
        return f"![{match.group(1)}]({_image(match.group(2))})"

    return LINK.sub(sub, IMAGE.sub(image, markdown))


def on_files(files: Files, config) -> Files:
    """Add the root README, CHANGELOG and TODO as generated pages, links rewritten."""
    for source, target in SOURCES.items():
        content = (ROOT / source).read_text(encoding="utf-8")
        files.append(File.generated(config, target, content=_rewrite(content)))
    return files
