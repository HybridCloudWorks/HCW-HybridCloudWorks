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
    python3 scripts/complexity/check_complexity_delta.py --base origin/main --threshold 10

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
import sys
from pathlib import Path

from compare import compare, totals
from measure import changed_paths, git, measure_base, measure_head
from model import DEFAULT_THRESHOLD, Finding, lizard, supported_extensions
from report import annotate, render, write_summary

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="base ref, e.g. origin/main")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
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
            f"CCN {f.func.complexity} ({was}) — over the threshold of {args.threshold}",
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
    if lizard is None:
        print("FATAL: lizard is not installed. `pip install lizard`", file=sys.stderr)
        return 2

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
            f"(lizard reads {len(supported_extensions())} extensions; this diff "
            "has none of them).\n",
            args.summary,
        )
        return 0

    head = measure_head(head_paths, root)
    base = measure_base(base_paths, base_sha, root)
    findings = compare(head, base, args.threshold)
    emit(render(findings, args.threshold, len(head_paths), totals(head, base)), args.summary)
    return report_blocking(findings, args)


if __name__ == "__main__":
    sys.exit(main())
