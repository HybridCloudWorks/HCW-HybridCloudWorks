"""
Findings as the job summary and the annotations a reviewer actually sees.
"""

from __future__ import annotations

import os
import sys

from model import LIST_CAP, Finding

def section_blocking(findings: list[Finding], threshold: int) -> list[str]:
    blocking = [f for f in findings if f.blocking]
    if not blocking:
        return ["### ✅ Nothing was added or made more complex", ""]
    lines = [
        f"### ❌ {len(blocking)} function(s) added complexity",
        "",
        "| | Function | File | CCN | Was |",
        "|---|---|---|---|---|",
    ]
    for f in blocking:
        was = "— (new)" if f.was is None else f"{f.was}{f.where}"
        lines.append(
            f"| {f.verdict} | `{f.func.name}` | `{f.func.path}:{f.func.line}` "
            f"| **{f.func.complexity}** | {was} |"
        )
    lines += [
        "",
        "Split the function, or lift its branches into named helpers. If the "
        "complexity is genuinely irreducible, say so on the pull request and "
        f"raise the threshold above {threshold} in the workflow deliberately — "
        "do not add an ignore that outlives the reason for it.",
        "",
    ]
    return lines


def section_improved(findings: list[Finding]) -> list[str]:
    improved = [f for f in findings if f.verdict == "IMPROVED"]
    if not improved:
        return []
    won = sum((f.was or 0) - f.func.complexity for f in improved)
    lines = [f"### 📉 {len(improved)} function(s) got simpler (−{won} CCN)", ""]
    lines += [
        f"- `{f.func.name}` in `{f.func.path}` — {f.was} → **{f.func.complexity}**{f.where}"
        for f in improved[:LIST_CAP]
    ]
    if len(improved) > LIST_CAP:
        lines.append(f"- …and {len(improved) - LIST_CAP} more")
    return lines + [""]


def section_carried(findings: list[Finding]) -> list[str]:
    carried = [f for f in findings if f.verdict == "CARRIED"]
    if not carried:
        return []
    lines = [
        f"<details><summary>{len(carried)} pre-existing function(s) over the "
        "threshold, carried no worse — not blocking</summary>",
        "",
    ]
    lines += [
        f"- `{f.func.name}` in `{f.func.path}:{f.func.line}` — "
        f"CCN {f.func.complexity}{f.where}"
        for f in carried[:LIST_CAP]
    ]
    if len(carried) > LIST_CAP:
        lines.append(f"- …and {len(carried) - LIST_CAP} more")
    return lines + ["", "</details>", ""]


def direction(delta: int) -> str:
    """The glyph a total's movement reads as: up, down, or unchanged."""
    if delta > 0:
        return "▲"
    if delta < 0:
        return "▼"
    return "—"


def render(
    findings: list[Finding], threshold: int, files: int, total: tuple[int, int]
) -> str:
    """The job summary, as markdown. One section per thing worth knowing."""
    head_total, base_total = total
    delta = head_total - base_total
    arrow = direction(delta)
    lines = [
        "## Complexity delta",
        "",
        f"Threshold **CCN > {threshold}**, over **{files}** analysable changed "
        "file(s). Only functions this pull request added or made worse can fail "
        "this check; what was already over the threshold is reported and allowed.",
        "",
        f"**Total CCN across the changed files: {base_total} → {head_total} "
        f"({arrow} {delta:+d})**",
        "",
    ]
    lines += section_blocking(findings, threshold)
    lines += section_improved(findings)
    lines += section_carried(findings)
    return "\n".join(lines)

def annotate(level: str, path: str, line: int, message: str, title: str) -> None:
    """
    One finding, as a GitHub workflow command when there is a GitHub to tell.

    An annotation lands on the changed line in the Files Changed view, which is
    where the person who wrote the function is already looking. A line in a job
    log is a place nobody goes on a green build, and this check is green on most
    of them by design.

    Outside Actions the same finding prints in clang's `file:line: level:` form,
    which every editor's quickfix list already parses — the format lizard's own
    `-w` uses, for the same reason.
    """
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # Commas and newlines would terminate the command's parameter list.
        safe = message.replace("\n", " ").replace(",", ";")
        print(f"::{level} file={path},line={line},title={title}::{safe}")
    else:
        print(f"{path}:{line}: {level}: {title} — {message}", file=sys.stderr)


def write_summary(path: str | None, report: str) -> None:
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(report + "\n")


