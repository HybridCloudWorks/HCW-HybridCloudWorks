# ADR 0023: Retire the migration-era estate, grants and reverse path

**Status:** Accepted
**Decision date:** 2026-08-24
**Owners:** Workload owner

## Context

[ADR 0016](../decisions/0016-reversible-migration.md) committed this platform to a reversible
migration with explicit decommission gates. This is the record of that gate
being passed, deliberately, rather than eroding.

Three things outlived the job they were for. `rg-db-site-sbx-cus` held the
migration rehearsal: a Cosmos account with 73 containers and a measured **77,763
documents**, a storage account, and four role assignments — a full copy of
production in a sandbox with none of production's controls. The CI deploy
identity held three production-write grants (Cosmos data-plane at database scope
`dbs/hcw`, Storage Blob Data Contributor and Storage Account Contributor on the
production content account) behind a `migration_writer_enabled` gate whose
checked-in default read `false` while all three assignments were **live**. And
the Cutover Runbook still ordered a delta import at step 4.

The reverse path had already stopped existing in code: `59e471b` deleted
`migrate-data.yml` and all five migration scripts in the same commit that added
the wiki pages documenting them. The estate and the grants were the last live
remnants asserting otherwise.

The removal is declared on `fix/go-live-remediation` and **has not been
applied**.

## Purpose and decision drivers

- **A rehearsal that has finished is a liability, not an asset.** A second full
  copy of production data doubles the surface without doubling the controls.
- **A standing production-write grant for a job that cannot run** is blast
  radius bought with nothing.
- **A checked-in default that disagrees with the live estate is not a control.**
  `migration_writer_enabled = false` in the repository, all three assignments
  live in Azure — whatever that gate was doing, it was not gating.
- **Documentation that orders an impossible step** teaches an operator to
  distrust the runbook, which is worse than the missing step.

## Decision

**1. The three production-import grants are revoked by deleting the
declarations and the gate variable, not by setting the gate to `false`.** The
gate already read `false` while the grants were live, so the checked-in default
was demonstrably not the effective value. Deleting the declarations means the
configuration *cannot* grant them whatever the workspace holds — a value
supplied for an undeclared variable is a warning, not a re-grant — and an apply
that finds them in state destroys them. `infra/oidc.tf` keeps a removal record
naming what survives and why.

**2. The rehearsal estate is destroyed.** `infra/scratch.tf` becomes a removal
record: an inventory of what an apply destroys, and a plain statement that it is
irreversible.

**3. The delta import is retired.** [Cutover Runbook](../history/cutover-runbook.md) step 4 is
headed RETIRED with the cost stated rather than deleted, and
[Phase-4-Data-Migration](../history/phase-4-data-migration.md) carries the evidence row.

**4. The two `data-migration` federated credentials are deliberately NOT
retired here.** No workflow references that environment, and with the grants
gone such a token inherits the same reduced role set as a branch token — so it
is a tidy-up, not an incident. Retiring a trust relationship is an identity
change, and it was escalated as an owner decision (`TODO.md`) rather than
folded into a Terraform cleanup. Tracked as TODO **T-524**.

The owner's authorisation, the live confirmation, and the itemised inventory are
in `TODO.md` under *Authorised: the migration-era teardown (2026-08-24)*. They
are not restated here; this record is the reasoning, that one is the
authorisation.

## Consequences and accepted risks

- **Irreversible.** `scratch.tf` never carried `prevent_destroy` — deliberately;
  it was built to be thrown away — so there is no lifecycle guard to trip and no
  confirmation beyond reading the plan. The account's `Continuous7Days` backup
  does not help: a continuous backup belongs to its account and dies with it.
  After the apply the only route back to that data is a fresh copy from
  production.
- **The reverse path to Firebase is closed.** Anything written on the Firebase
  side after the 2026-08-21 import does not come across, and DNS moves without a
  second pass. That is the substance of what ADR 0016's reversibility was
  protecting, and it is now spent.
- **The deploy identity keeps exactly what has a consumer**, and nothing else.
  Every surviving grant was traced to the workflow or script that uses it, and
  every revoked one to none; the list is in `infra/oidc.tf`. Dropping the
  database-scoped Cosmos grant does not affect the two container-scoped
  assignments — they are separate assignments, and the database scope was a
  superset sitting alongside them rather than their parent.
- **The 77,763 versus 69,979 document gap is unexplained** and is recorded as
  unexplained. `TODO.md` declines to treat it as a reason to keep the copy,
  because both imports reconciled at 8,023/8,023 with zero field mismatches. An
  accepted unknown with the reasoning written down is not the same as a resolved
  one, and this record does not claim otherwise.
- Three GitHub repository variables — `COSMOS_SCRATCH_ENDPOINT`,
  `STORAGE_SCRATCH_ACCOUNT`, `SCRATCH_RESOURCE_GROUP` — lose their last
  producer and become orphans to delete (TODO **T-525**).

## Alternatives considered

- **Set `migration_writer_enabled = false` and leave the declarations** —
  rejected. That is the state the estate was already in, and it was not the
  effective one.
- **Keep the sandbox with a `prevent_destroy` guard and a stated lifetime** —
  rejected: the sandbox is the thing being retired, and a guard on a copy of
  production only makes the copy harder to remove later. The lesson is recorded
  in the removal record instead — a future rehearsal estate should carry its
  lifetime *next to the resource*, not in a workspace variable that nobody
  re-reads.
- **Count per container on both accounts before destroying**, to convert the
  document gap from unexplained to explained — recommended twice in review and
  not done. It is a free read-only query and remains available until the apply
  runs.
- **Export the sandbox first** — rejected: it is a copy of production, and
  production is the authoritative copy. The only thing an export would preserve
  that production does not already hold is the unexplained surplus, which is
  what the count above would identify more cheaply.

## Validation and revisit triggers

- `terraform state list` (read-only, queues no run) confirmed all 90 addresses
  are Terraform-managed before the plan, which is the question a plan could not
  be trusted to answer: an orphaned estate would leave the configuration unable
  to manage resources that still exist.
- The apply is approved against the destroy **addresses**, not the count. The
  dangerous near-miss is 89 — the scratch estate in state while the three grants
  are not, which tears down the sandbox and leaves production database write in
  place.
- **Revisit when:** a future migration or rehearsal is proposed. ADR 0016's
  reversibility does not survive this apply, so the next one writes its own ADR
  rather than inheriting that one's decommission gates.

## Related decisions and references

- Closes the decommission gate of [ADR 0016](../decisions/0016-reversible-migration.md); that
  ADR's reversibility guarantee does not extend past this apply
- `TODO.md` — *Authorised: the migration-era teardown (2026-08-24)*
- [Cutover Runbook](../history/cutover-runbook.md) step 4 ·
  [Phase-4-Data-Migration](../history/phase-4-data-migration.md) P6 ·
  [Migration Runbook](../history/migration-runbook.md) (archived)
- `infra/scratch.tf` and `infra/oidc.tf` — the removal records
