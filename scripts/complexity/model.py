"""
What a function is here, and what a verdict about one is.

Split out of check_complexity_delta.py on 2026-09-16, when Qlty's
`qlty:file-complexity` put that file at 72 — the gate's own module being the
thing the gate exists to prevent. The module is now four: this one holds the
shapes and the thresholds, measure.py talks to git and lizard, compare.py holds
the judgement, and report.py writes it down.
"""

from __future__ import annotations

from dataclasses import dataclass

try:
    import lizard
except ImportError:  # pragma: no cover - exercised only on a runner without it
    lizard = None

DEFAULT_THRESHOLD = 8

# How many rows a collapsible list prints before it says "and N more". A
# summary nobody scrolls to the end of has the same value as no summary.
LIST_CAP = 20

# Paths that are generated, vendored or installed. Lizard has no .gitignore
# awareness, so a local run with build output present would otherwise measure
# dist/ and node_modules/ and disagree with CI, which analyses a clean clone.
EXCLUDED_PARTS = (
    "node_modules",
    "dist",
    "build",
    "coverage",
    "site",
    ".terraform",
    "__pycache__",
    ".venv",
)

# Test files, skipped unless --include-tests. A test's branches are table-driven
# assertions rather than logic anyone maintains, and a describe() block full of
# arrow functions scores like a state machine: `reply` in
# functions/src/lib/newsletter/handlers.test.js measures CCN 44 and is a fixture.
# Counting them would put most of the gate's noise in the files whose complexity
# matters least.
TEST_MARKERS = (".test.", ".spec.", "/__tests__/", "/test/", "/tests/")

# Only extensions lizard actually parses. Anything else in a diff (.tf, .ps1,
# .md, .yml) is skipped rather than guessed at. Computed on first use so this
# module imports without lizard present.
_EXTENSIONS: set[str] | None = None


def supported_extensions() -> set[str]:
    global _EXTENSIONS
    if _EXTENSIONS is None:
        _EXTENSIONS = {
            ext.lower()
            for reader in lizard.languages()
            for ext in getattr(reader, "ext", [])
        }
    return _EXTENSIONS


@dataclass(frozen=True)
class Func:
    """One function as lizard measured it."""

    path: str
    name: str
    ordinal: int  # nth function of this name in this file, in source order
    complexity: int
    line: int
    nloc: int

    @property
    def key(self) -> tuple[str, str, int]:
        return (self.path, self.name, self.ordinal)


@dataclass
class Finding:
    verdict: str  # NEW | WORSENED | CARRIED | IMPROVED
    func: Func
    was: int | None  # CCN at the base, or None when there was no base function
    origin: str | None = None  # the path it moved from, when it moved

    @property
    def blocking(self) -> bool:
        return self.verdict in ("NEW", "WORSENED")

    @property
    def where(self) -> str:
        return f" (from `{self.origin}`)" if self.origin else ""


# ── git ──────────────────────────────────────────────────────────────────────
