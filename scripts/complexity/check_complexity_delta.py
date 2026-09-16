#!/usr/bin/env python3
"""
Fail a pull request that ADDS cyclomatic complexity. Say nothing about the
complexity that was already there.

Why this is a delta gate and not `lizard . -C 8 -W`
===================================================
Measured on this repository, 2026-09-16, at the head of `main`:

    CCN > 8 : 479 functions      CCN > 20 : 43 functions
    CCN > 10: 322 functions      CCN > 25 : 25 functions
    CCN > 12: 219 functions      CCN > 30 : 18 functions
    CCN > 15: 117 functions      CCN > 40 :  9 functions

A whole-tree gate at CCN 8 is therefore red 479 times over on its first run and
on every run after it, including pull requests that REMOVE complexity. A check
that cannot go green is a check nobody reads, and this repository has paid for
that shape before: `monitor-unresolved-secrets.yml` sits `disabled_manually`
with nothing in the history saying why.

So the question this asks is not "is this repository complex" — it is, and the
number above is the backlog — but "did THIS pull request make it worse". That
question has a green answer available on every single pull request, which is
what makes it worth wiring to a red X.

While you are at it, note that the command that prompted this
(`lizard . -C 8 -W`) does not do what it reads like. Lizard's `-W` is
`--whitelist` and takes a FILENAME; `lizard . -C 8 -W` exits **2** from
argparse — "argument -W/--whitelist: expected one argument" — before it
measures anything at all. The flag that prints warnings is lowercase `-w`, and
lizard already exits 1 when any warning is found, so no fail-on-warning flag is
needed. A gate that is red for an argument error looks exactly like a gate that
is red for a finding, which is the expensive kind of wrong.

What counts as adding complexity
================================
For every function in a file this pull request touches, compare its CCN against
the same function at the merge base:

  NEW        absent at the base and over the threshold      -> blocks
  WORSENED   present at the base, over the threshold, and
             higher than it was                             -> blocks
  CARRIED    over the threshold but no higher than it was   -> reported, allowed
  IMPROVED   lower than it was                              -> reported, celebrated

CARRIED is the whole point. Editing one line of a function that is already at
CCN 30 must not be blocked, or the backlog becomes unfixable: every attempt to
tackle it would be refused by the thing asking for it to be tackled.

Matching functions across a diff
================================
Functions are matched by (path, name), not by line number — a line number moves
the moment anything above it is edited, so a line-keyed match reports the whole
file as new after a one-line insertion near the top.

Two wrinkles are handled, both because a refactor must not read as an addition:

  * Two functions with the same name in one file are matched in source order,
    so the second `load` pairs with the second `load`.
  * A function that is new AT ITS PATH is paired, before it is called new, with
    a same-named function that LEFT somewhere else in this diff — a base
    function whose own (path, name) no longer exists at the head. Splitting a
    1,551-line page into one file per tab (#575) otherwise reports every
    function in the new files as newly added complexity, which is the opposite
    of what happened. Where several candidates share a name, the one with the
    closest CCN is used, and the report names the path it came from so a
    mis-pairing is visible rather than silent.

    Pairing on "it left somewhere" rather than on an identical CCN is
    deliberate, because an identical CCN is not available. Measured here on
    2026-09-16: `getLiveUrl` scores **7** inside the 1,551-line
    SocialHubPage.jsx and **10** as the same body in socialView.js, the only
    textual difference being the `export` keyword. Lizard's JavaScript
    tokenizer drifts with the surrounding file, so a move is worth ±3 CCN of
    noise on its own. Requiring an exact match would report every large-file
    split as new complexity — the one refactor this repository most needs to
    stay cheap.

Usage
-----
    python3 scripts/complexity/check_complexity_delta.py --base origin/main
    python3 scripts/complexity/check_complexity_delta.py --base origin/main --ccn 10

Exit codes
----------
    0  nothing was made worse
    1  at least one function is new-and-complex or was made more complex
    2  the comparison could not be made (no base, no lizard, bad revision)

Exit 2 is deliberately not exit 1. "Evaluated and failed" and "could not
evaluate" are different findings, and conflating them is how a gate goes quietly
blind — the same reasoning `scripts/verify-timer-witness.mjs` records for its
own exit 2.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

try:
    import lizard
except ImportError:  # pragma: no cover - exercised only on a broken runner
    print("FATAL: lizard is not installed. `pip install lizard`", file=sys.stderr)
    sys.exit(2)


DEFAULT_CCN = 8

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
# .md, .yml) is skipped rather than guessed at.
SUPPORTED_EXTENSIONS = {
    ext.lower() for reader in lizard.languages() for ext in getattr(reader, "ext", [])
}


@dataclass(frozen=True)
class Func:
    """One function as lizard measured it."""

    path: str
    name: str
    ordinal: int  # nth function of this name in this file, in source order
    ccn: int
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


def git(*args: str) -> str:
    """One git command, as stripped stdout. Raises on a non-zero exit."""
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def analysable(path: str, include_tests: bool = False) -> bool:
    if any(part in EXCLUDED_PARTS for part in Path(path).parts):
        return False
    if not include_tests and any(marker in f"/{path}" for marker in TEST_MARKERS):
        return False
    return Path(path).suffix.lstrip(".").lower() in SUPPORTED_EXTENSIONS


def changed_paths(base: str, include_tests: bool) -> tuple[list[str], list[str]]:
    """
    The diff's analysable paths, as (head_paths, base_paths).

    `-M` so a rename is one R entry rather than a delete and an add; its old
    path goes into the base side so the moved functions are found there.

    Three dots, not two: compare against the merge base, so commits that landed
    on `main` after this branch started are not read as this branch's work.
    """
    raw = git("diff", "--name-status", "-M", "--diff-filter=ACMRD", f"{base}...HEAD")
    head_paths: list[str] = []
    base_paths: list[str] = []
    for line in raw.splitlines():
        head_path, base_path = sides_of(line)
        if head_path:
            head_paths.append(head_path)
        if base_path:
            base_paths.append(base_path)
    return (
        sorted({p for p in head_paths if analysable(p, include_tests)}),
        sorted({p for p in base_paths if analysable(p, include_tests)}),
    )


def sides_of(line: str) -> tuple[str, str]:
    """
    One `--name-status` line as the (head, base) paths it contributes.

    An empty string means the line contributes nothing to that side: an added
    file has no base, a deleted file has no head, and a rename has a different
    path on each.
    """
    fields = line.split("\t")
    if len(fields) < 2:
        return ("", "")
    status, path = fields[0], fields[1]
    if status.startswith("R") and len(fields) >= 3:
        return (fields[2], path)
    if status.startswith("D"):
        return ("", path)
    if status.startswith("A"):
        return (path, "")
    return (path, path)  # M, C


# ── measurement ──────────────────────────────────────────────────────────────


def measure(real_path: Path, reported_as: str) -> list[Func]:
    """Lizard one file. `reported_as` is the repository path used as the key."""
    try:
        info = lizard.analyze_file(str(real_path))
    except Exception as err:  # a parse failure must not be silent
        print(f"  ! could not analyse {reported_as}: {err}", file=sys.stderr)
        return []
    seen: dict[str, int] = defaultdict(int)
    functions = []
    for fn in sorted(info.function_list, key=lambda f: f.start_line):
        ordinal = seen[fn.name]
        seen[fn.name] += 1
        functions.append(
            Func(
                path=reported_as,
                name=fn.name,
                ordinal=ordinal,
                ccn=fn.cyclomatic_complexity,
                line=fn.start_line,
                nloc=fn.nloc,
            )
        )
    return functions


def measure_head(paths: list[str], root: Path) -> dict[tuple[str, str, int], Func]:
    out = {}
    for path in paths:
        full = root / path
        if not full.is_file():
            continue
        for fn in measure(full, path):
            out[fn.key] = fn
    return out


def measure_base(
    paths: list[str], base_sha: str, root: Path
) -> dict[tuple[str, str, int], Func]:
    """
    Measure the base revision by writing each file out of the object database.

    `git show <sha>:<path>` rather than a second checkout: the working tree must
    not move under a job that may be doing other things, and a worktree add
    costs a full checkout to read a handful of files.

    Bytes, not text. A source file with a lone surrogate or a non-UTF-8 byte
    would otherwise raise here and be reported as "could not analyse", turning a
    base-side read error into a phantom NEW function on the head side.
    """
    out: dict[tuple[str, str, int], Func] = {}
    with tempfile.TemporaryDirectory(prefix="complexity-base-") as tmp:
        tmpdir = Path(tmp)
        for path in paths:
            blob = subprocess.run(
                ["git", "show", f"{base_sha}:{path}"],
                capture_output=True,
                check=False,
                cwd=root,
            )
            if blob.returncode != 0:
                continue  # absent at the base: genuinely a new file
            staged = tmpdir / path
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_bytes(blob.stdout)
            for fn in measure(staged, path):
                out[fn.key] = fn
    return out


# ── comparison ───────────────────────────────────────────────────────────────


def compare(
    head: dict[tuple[str, str, int], Func],
    base: dict[tuple[str, str, int], Func],
    threshold: int,
) -> list[Finding]:
    """Classify every head function against its base counterpart."""
    # Functions that LEFT where they were: a base function whose own key is
    # gone at the head. These are what a new-at-its-path function may have
    # moved from. A base function still sitting at its own path is not a
    # candidate, so two unrelated `load`s in two untouched files cannot pair.
    departed: dict[str, list[Func]] = defaultdict(list)
    for key, fn in base.items():
        # Anonymous functions are excluded: lizard names every arrow function
        # "(anonymous)", so pairing on that name matches the 40th callback in
        # one file with the 3rd in another and reports a confident number about
        # nothing. A nameless function cannot be tracked across a move, so it is
        # judged where it stands.
        if key not in head and fn.name != "(anonymous)":
            departed[fn.name].append(fn)

    findings: list[Finding] = []
    for key, fn in sorted(head.items(), key=lambda kv: (-kv[1].ccn, kv[0])):
        prior, origin = base.get(key), None
        if prior is None:
            prior = claim_departed(departed, fn)
            origin = prior.path if prior else None
        finding = classify(fn, prior, origin, threshold)
        if finding:
            findings.append(finding)
    return findings


def claim_departed(departed: dict[str, list[Func]], fn: Func) -> Func | None:
    """
    The function `fn` most likely moved from, consumed so it pairs once.

    Closest CCN among the candidates, because the tokenizer's own drift across
    files is worth a few points either way.
    """
    candidates = departed.get(fn.name)
    if fn.name == "(anonymous)" or not candidates:
        return None
    prior = min(candidates, key=lambda c: abs(c.ccn - fn.ccn))
    candidates.remove(prior)
    return prior


def classify(
    fn: Func, prior: Func | None, origin: str | None, threshold: int
) -> Finding | None:
    """One function's verdict, or None when there is nothing worth saying."""
    if prior is None:
        return Finding("NEW", fn, None, None) if fn.ccn > threshold else None
    if fn.ccn < prior.ccn:
        return Finding("IMPROVED", fn, prior.ccn, origin)
    if fn.ccn <= threshold:
        return None
    verdict = "WORSENED" if fn.ccn > prior.ccn else "CARRIED"
    return Finding(verdict, fn, prior.ccn, origin)


def totals(
    head: dict[tuple[str, str, int], Func], base: dict[tuple[str, str, int], Func]
) -> tuple[int, int]:
    """
    Total CCN over the changed files, head and base.

    Per-function verdicts can all be green while a diff adds twenty small
    branchy functions, and they can all be red on a split that halved the
    page it came from. This is the line that says which happened.
    """
    return (sum(f.ccn for f in head.values()), sum(f.ccn for f in base.values()))


# ── reporting ────────────────────────────────────────────────────────────────


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
            f"| **{f.func.ccn}** | {was} |"
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
    won = sum((f.was or 0) - f.func.ccn for f in improved)
    lines = [f"### 📉 {len(improved)} function(s) got simpler (−{won} CCN)", ""]
    lines += [
        f"- `{f.func.name}` in `{f.func.path}` — {f.was} → **{f.func.ccn}**{f.where}"
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
        f"CCN {f.func.ccn}{f.where}"
        for f in carried[:LIST_CAP]
    ]
    if len(carried) > LIST_CAP:
        lines.append(f"- …and {len(carried) - LIST_CAP} more")
    return lines + ["", "</details>", ""]


def render(
    findings: list[Finding], threshold: int, files: int, total: tuple[int, int]
) -> str:
    """The job summary, as markdown. One section per thing worth knowing."""
    head_total, base_total = total
    delta = head_total - base_total
    arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "—")
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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="base ref, e.g. origin/main")
    parser.add_argument("--ccn", type=int, default=DEFAULT_CCN)
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="also measure test files, which are skipped by default",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="print the findings but always exit 0 — the ratchet before it is armed",
    )
    parser.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    return parser.parse_args(argv)


def report_blocking(findings: list[Finding], args: argparse.Namespace) -> int:
    """Annotate every blocking finding, and say whether that fails the build."""
    blocking = [f for f in findings if f.blocking]
    if not blocking:
        return 0
    level = "warning" if args.report_only else "error"
    for f in blocking:
        was = "new" if f.was is None else f"was {f.was}"
        annotate(
            level,
            f.func.path,
            f.func.line,
            f"CCN {f.func.ccn} ({was}) — over the threshold of {args.ccn}",
            f"{f.verdict}: {f.func.name}",
        )
    if args.report_only:
        print(
            "\nReport-only: this did not fail the build. Arm it by setting the "
            "COMPLEXITY_ENFORCE repository variable to `true`.",
            file=sys.stderr,
        )
        return 0
    return 1


def emit(report: str, summary_path: str | None) -> None:
    print(report)
    write_summary(summary_path, report)


def main() -> int:
    args = parse_args()

    try:
        root = Path(git("rev-parse", "--show-toplevel"))
        base_sha = git("merge-base", args.base, "HEAD")
    except RuntimeError as err:
        # A gate that cannot read its base has not evaluated anything, and must
        # not report that as a pass. Most often a shallow clone: CI needs
        # `fetch-depth: 0`.
        print(f"FATAL: cannot resolve the base revision — {err}", file=sys.stderr)
        print("Does the checkout use `fetch-depth: 0`?", file=sys.stderr)
        return 2

    head_paths, base_paths = changed_paths(args.base, args.include_tests)
    if not head_paths and not base_paths:
        emit(
            "## Complexity delta\n\nNo analysable source files changed "
            f"(lizard reads {len(SUPPORTED_EXTENSIONS)} extensions; this diff "
            "has none of them).\n",
            args.summary,
        )
        return 0

    head = measure_head(head_paths, root)
    base = measure_base(base_paths, base_sha, root)
    findings = compare(head, base, args.ccn)
    emit(render(findings, args.ccn, len(head_paths), totals(head, base)), args.summary)
    return report_blocking(findings, args)


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


if __name__ == "__main__":
    sys.exit(main())
