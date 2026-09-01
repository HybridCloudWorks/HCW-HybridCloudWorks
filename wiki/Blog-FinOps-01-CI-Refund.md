---
title: Your CI is a cloud bill — collect the refund on every pull request
subtitle: Why fourteen required checks are worth keeping, and how to stop paying for the eleven that have nothing to test.
date: 2026-09-01
track: finops
tags: [finops, github-actions, ci-cd, cost-optimization]
reading: 8
---

Every pull request on our repository runs fourteen checks. Builds, unit
suites, three CodeQL analyses, Terraform validation, a dependency review, a
repository-policy gate. For a while, every one of them ran in full on every
pull request — including the pull request that changed two lines of Markdown
in a runbook.

That's a cloud bill. It doesn't arrive as an invoice line called "CI you
didn't need", but it is metered compute, consumed on a schedule you control,
producing value only when the check could actually fail. A FinOps practice
that scrutinizes idle VMs and over-provisioned databases while its build
system runs full-matrix on documentation edits is auditing the estate and
skipping the workshop.

This post makes two arguments that sound like they conflict and don't:
**every one of those fourteen checks earns its place**, and **most of them
should not run most of the time**.

## Why the checks are worth keeping

The strongest case for a required check is a specific failure it would have
caught. Ours all have one. A sample:

| Check | The incident that justifies it |
| --- | --- |
| Lockfile-strict install per package | A `package.json` and its lockfile disagreed; dependency PRs previously had nothing validating them at all |
| vps-agent test suite | An edit to a Docker sandbox flag list — the entire security boundary of a job executor — shipped green because the job installed dependencies and ran nothing |
| Workflow permissions test | A workflow holding `contents: write` could push to `main` past every required check, because a ruleset bypass attaches to the Actions token, not to a workflow |
| Frontend build + tests | A pre-rendering pipeline built 120 HTML documents that the client bundle then threw away at boot — caught, eventually, by tests that now run on every change |
| Repository policy validator | Documentation sprawl: new Markdown lands in one reviewed set of locations, or the check says no |

Notice what these have in common: none of them is a style preference. Each is
a control with a named failure mode, most with a scar attached. When someone
proposes deleting a check to "speed up CI", this table is the counterargument.

**Deleting checks is the wrong refund.** The gate is the asset; the waste is
running the gate against changes it cannot possibly fail.

## Where the waste actually is

Measure before optimizing — the same rule as any other cloud spend. Ours, from
real run logs on a documentation-only pull request:

- Six build-and-test jobs: the frontend job alone took ~73 seconds (install,
  lint, format, full build with pre-rendering, tests). None of the six reads
  a Markdown file.
- Three CodeQL analyses: ~50–80 seconds each, analyzing JavaScript, Python
  and workflow files that the diff did not touch.
- Call it nine-plus billed job-minutes per push — and GitHub bills per job,
  rounded up. On a Team plan's Linux runners that's small money per push and
  real money per year; on a free public repo the cost is queue time and a
  contributor waiting three minutes to merge a typo fix. Either way you are
  paying for compute whose output was known before it started.

Multiply by every push to every docs PR — in a repository where the work
tracker, changelog, runbooks and architecture records all live in-repo,
that's the *most common* PR shape — and the shop-floor waste is bigger than
most of the idle-resource findings a cost review turns up.

## The trap: why the obvious fix breaks your merge queue

Every CI system has path filters. GitHub's is `paths:` on the trigger:

    on:
      pull_request:
        paths:
          - 'frontend/**'

Do that to a **required** check and you've built a trap. A required status
context whose workflow never triggered is not treated as satisfied — the pull
request waits on "Expected — waiting for status to be reported" forever.
Which, with trigger-level filters, describes every pull request that
*doesn't* touch the filtered path: most of them. You have converted wasted
compute into a blocked merge queue, which is strictly worse.

## The fix: filter inside the job, report the context anyway

The pattern that works keeps the trigger firing on every pull request and
moves the decision inside the job: check out with history, diff against the
PR's base, and skip the expensive steps when nothing relevant changed. The
job still completes — in seconds — and still posts its required context.

    - name: Detect component changes
      id: changes
      run: |
        set -euo pipefail
        if [ "${{ github.event_name }}" != "pull_request" ]; then
          echo "relevant=true" >> "$GITHUB_OUTPUT"; exit 0
        fi
        if git diff --name-only "${{ github.event.pull_request.base.sha }}" HEAD \
           | grep -qE '^(frontend/|\.azure/)'; then
          echo "relevant=true" >> "$GITHUB_OUTPUT"
        else
          echo "relevant=false" >> "$GITHUB_OUTPUT"
        fi

    - name: Test
      if: steps.changes.outputs.relevant == 'true'
      run: npm test

Three rules make this safe rather than merely fast:

1. **The filter is a dependency map, not a directory name.** Our functions
   suite asserts against Terraform source and a machine-readable API
   contract; our scripts suite pins workflow files. Their filters include
   those paths. Scope a filter to the component's own tree and you quietly
   disarm exactly the cross-tree assertions you added on purpose — the same
   class of silent-skip that justified one of these checks in the first
   place.
2. **Merges and schedules bypass the filter.** The push to the default
   branch runs everything — a merge is when the *combined* result needs
   confirming — and the weekly security scan analyzes the whole repository,
   so a newly published CodeQL query never waits for a PR to touch the
   affected language.
3. **Write the doctrine where the next editor will trip on it.** Our
   workflows carry a comment that says, in effect: *do not re-add `paths:`
   to `pull_request` without first removing these contexts from the ruleset,
   in that order.* A pattern that only lives in one engineer's head reverts
   itself within a quarter.

## The refund, in FinOps terms

- **Rate optimization, not usage reduction — then usage reduction too.** You
  keep 100% of the control coverage (every context still gates every merge)
  while cutting the metered usage behind it by ~80% on the dominant PR
  shape. That's the same shape as rightsizing: same workload served,
  smaller meter.
- **The unit economics become legible.** Once checks run only when they can
  fail, "CI minutes per merged change" becomes a metric worth tracking,
  because movement in it means something changed in the code, not in the
  paperwork mix.
- **The savings compound where you can't see them on the bill.** Faster
  feedback on docs changes means tracker and runbook updates actually get
  made — and a repository whose operational records are current is the
  cheapest incident-response tool you will ever own.

The honest ledger has a debit side: those filters are hand-maintained. Add a
new cross-tree dependency to a test suite without updating the filter, and
that suite silently skips until the merge-time full run catches it. We wrote
that risk into the architecture decision record alongside the decision — an
accepted risk you've written down is a maintenance task; one you haven't is
next quarter's incident.

Keep every check. Run each one only when it can earn its keep. That's the
refund.
