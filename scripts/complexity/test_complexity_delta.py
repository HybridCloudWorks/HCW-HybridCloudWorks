#!/usr/bin/env python3
"""
The comparison this gate is, tested without git or lizard.

`compare()` is where every judgement happens, and every one of them is a
decision someone will disagree with at the moment it blocks their pull request.
Each case below is the answer to one of those arguments, written down.

    python3 -m unittest discover -s scripts/complexity -p 'test_*.py'
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_complexity_delta import (  # noqa: E402
    Func,
    analysable,
    compare,
    totals,
)

THRESHOLD = 8


def fn(path, name, ccn, ordinal=0, line=1):
    return Func(path=path, name=name, ordinal=ordinal, ccn=ccn, line=line, nloc=10)


def index(*functions):
    return {f.key: f for f in functions}


def verdicts(findings):
    return {(f.func.name, f.verdict) for f in findings}


class NewCode(unittest.TestCase):
    def test_a_new_complex_function_blocks(self):
        findings = compare(index(fn("a.js", "parse", 12)), {}, THRESHOLD)
        self.assertEqual(verdicts(findings), {("parse", "NEW")})
        self.assertTrue(findings[0].blocking)
        self.assertIsNone(findings[0].was)

    def test_a_new_simple_function_is_not_reported_at_all(self):
        # Silence is the point: a gate that lists every function it approved is
        # a gate whose output nobody finishes reading.
        self.assertEqual(compare(index(fn("a.js", "parse", 8)), {}, THRESHOLD), [])

    def test_the_threshold_is_exclusive(self):
        # CCN 8 with a threshold of 8 passes; 9 does not. Stated because "at or
        # over" versus "over" is an off-by-one someone will hit and misread as
        # the tool being wrong.
        self.assertEqual(compare(index(fn("a.js", "f", 8)), {}, THRESHOLD), [])
        self.assertEqual(len(compare(index(fn("a.js", "f", 9)), {}, THRESHOLD)), 1)


class ExistingCode(unittest.TestCase):
    def test_a_function_made_worse_blocks(self):
        findings = compare(
            index(fn("a.js", "parse", 14)), index(fn("a.js", "parse", 11)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "WORSENED")})
        self.assertEqual(findings[0].was, 11)

    def test_a_complex_function_carried_unchanged_does_not_block(self):
        # The whole reason this is a delta gate. Editing one line of a CCN 30
        # function must not be refused, or the backlog cannot be worked at all.
        findings = compare(
            index(fn("a.js", "parse", 30)), index(fn("a.js", "parse", 30)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "CARRIED")})
        self.assertFalse(findings[0].blocking)

    def test_a_function_that_got_simpler_is_reported_as_a_win(self):
        findings = compare(
            index(fn("a.js", "parse", 20)), index(fn("a.js", "parse", 30)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "IMPROVED")})
        self.assertFalse(findings[0].blocking)

    def test_an_improvement_is_reported_even_below_the_threshold(self):
        # Going 7 -> 3 never crosses the threshold, and is still the work this
        # check exists to encourage.
        findings = compare(
            index(fn("a.js", "parse", 3)), index(fn("a.js", "parse", 7)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "IMPROVED")})

    def test_growth_that_stays_under_the_threshold_is_allowed(self):
        self.assertEqual(
            compare(
                index(fn("a.js", "parse", 7)), index(fn("a.js", "parse", 4)), THRESHOLD
            ),
            [],
        )


class MovedCode(unittest.TestCase):
    def test_a_function_that_moved_file_is_not_new(self):
        # Splitting a large file is the refactor this repository most needs to
        # stay cheap; reporting every function in the new file as newly added
        # complexity would tax exactly that.
        findings = compare(
            index(fn("new.js", "parse", 12)), index(fn("old.js", "parse", 12)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "CARRIED")})
        self.assertEqual(findings[0].origin, "old.js")

    def test_a_move_that_also_added_branches_is_judged_on_the_delta(self):
        findings = compare(
            index(fn("new.js", "parse", 18)), index(fn("old.js", "parse", 12)), THRESHOLD
        )
        self.assertEqual(verdicts(findings), {("parse", "WORSENED")})
        self.assertEqual(findings[0].was, 12)
        self.assertEqual(findings[0].origin, "old.js")

    def test_a_function_still_at_its_old_path_is_not_a_move_candidate(self):
        # Two unrelated `load`s in two files must not pair. The one in old.js is
        # still in old.js at the head, so it never joins the departed pool, and
        # new.js's `load` is correctly a new function.
        head = index(fn("old.js", "load", 12), fn("new.js", "load", 12))
        base = index(fn("old.js", "load", 12))
        findings = compare(head, base, THRESHOLD)
        self.assertEqual(
            verdicts(findings), {("load", "CARRIED"), ("load", "NEW")}
        )

    def test_the_closest_ccn_wins_when_several_candidates_share_a_name(self):
        head = index(fn("new.js", "read", 20))
        base = index(fn("x.js", "read", 9, ordinal=0), fn("y.js", "read", 19))
        findings = compare(head, base, THRESHOLD)
        self.assertEqual(findings[0].origin, "y.js")
        self.assertEqual(findings[0].was, 19)

    def test_anonymous_functions_never_pair_across_a_move(self):
        # lizard names every arrow function "(anonymous)". Pairing on that name
        # matches the 40th callback in one file with the 3rd in another and
        # reports a confident number about nothing.
        findings = compare(
            index(fn("new.js", "(anonymous)", 12)),
            index(fn("old.js", "(anonymous)", 12)),
            THRESHOLD,
        )
        self.assertEqual(verdicts(findings), {("(anonymous)", "NEW")})


class DuplicateNames(unittest.TestCase):
    def test_two_functions_of_one_name_pair_in_source_order(self):
        head = index(
            fn("a.js", "load", 12, ordinal=0, line=10),
            fn("a.js", "load", 30, ordinal=1, line=90),
        )
        base = index(
            fn("a.js", "load", 12, ordinal=0, line=10),
            fn("a.js", "load", 20, ordinal=1, line=80),
        )
        findings = compare(head, base, THRESHOLD)
        by_ordinal = {f.func.ordinal: f.verdict for f in findings}
        self.assertEqual(by_ordinal, {0: "CARRIED", 1: "WORSENED"})


class Totals(unittest.TestCase):
    def test_the_aggregate_catches_what_per_function_verdicts_miss(self):
        # Twenty new functions at CCN 5 each trip no per-function verdict and
        # are still 100 CCN of new branching.
        head = index(*[fn(f"a{i}.js", f"f{i}", 5) for i in range(20)])
        self.assertEqual(totals(head, {}), (100, 0))
        self.assertEqual(compare(head, {}, THRESHOLD), [])


class PathFiltering(unittest.TestCase):
    def test_source_files_are_analysable(self):
        for path in ("src/a.js", "src/a.jsx", "hooks/b.py", "scripts/c.mjs"):
            self.assertTrue(analysable(path), path)

    def test_unparseable_types_are_skipped(self):
        for path in ("infra/main.tf", "a.ps1", "README.md", ".github/w.yml"):
            self.assertFalse(analysable(path), path)

    def test_generated_and_vendored_trees_are_skipped(self):
        for path in (
            "frontend/node_modules/x/index.js",
            "frontend/dist/assets/a.js",
            "site/search/worker.js",
        ):
            self.assertFalse(analysable(path), path)

    def test_tests_are_skipped_unless_asked_for(self):
        # A describe() block of arrow functions scores like a state machine:
        # `reply` in functions/src/lib/newsletter/handlers.test.js measures
        # CCN 44 and is a fixture.
        for path in ("a/b.test.js", "a/b.spec.jsx", "a/__tests__/c.js"):
            self.assertFalse(analysable(path), path)
            self.assertTrue(analysable(path, include_tests=True), path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
