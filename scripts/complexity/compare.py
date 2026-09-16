"""
The judgement: one verdict per function, and the aggregate.

No git, no lizard, no I/O — every function here is a function of its arguments,
which is why test_complexity_delta.py can cover all of it without a repository
to point at. Every case in it is an argument someone will have at the moment
this blocks their pull request.
"""

from __future__ import annotations

from collections import defaultdict

from model import Finding, Func

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
    for key, fn in sorted(head.items(), key=lambda kv: (-kv[1].complexity, kv[0])):
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
    prior = min(candidates, key=lambda c: abs(c.complexity - fn.complexity))
    candidates.remove(prior)
    return prior


def classify(
    fn: Func, prior: Func | None, origin: str | None, threshold: int
) -> Finding | None:
    """One function's verdict, or None when there is nothing worth saying."""
    if prior is None:
        return Finding("NEW", fn, None, None) if fn.complexity > threshold else None
    if fn.complexity < prior.complexity:
        return Finding("IMPROVED", fn, prior.complexity, origin)
    if fn.complexity <= threshold:
        return None
    verdict = "WORSENED" if fn.complexity > prior.complexity else "CARRIED"
    return Finding(verdict, fn, prior.complexity, origin)


def totals(
    head: dict[tuple[str, str, int], Func], base: dict[tuple[str, str, int], Func]
) -> tuple[int, int]:
    """
    Total CCN over the changed files, head and base.

    Per-function verdicts can all be green while a diff adds twenty small
    branchy functions, and they can all be red on a split that halved the
    page it came from. This is the line that says which happened.
    """
    return (sum(f.complexity for f in head.values()), sum(f.complexity for f in base.values()))


# ── reporting ────────────────────────────────────────────────────────────────
