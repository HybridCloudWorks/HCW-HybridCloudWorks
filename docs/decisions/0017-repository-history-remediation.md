# ADR 0017: Re-root the default branch after credential rotation

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The current repository tree was cleaned and the affected credentials were rotated, but one reachable
historical commit on `main` still contained secret values in
`frontend/platform/terraform/gcp-secrets/secrets.auto.tfvars` and
`frontend/documentation/security-audit-2026-06-07.md`. Before remediation, the remote contained only
the `main` branch: there were no tags, pull requests, forks, or additional remote branches. A separate
scan of the GitHub Wiki history found no secret-bearing commits.

The repository is intended to become the clean landing repository for the new HybridCloudWorks
architecture. The owner explicitly approved a coordinated history rewrite after confirming that all
identified credentials had been rotated or revoked.

## Purpose and decision drivers

- Remove secret-bearing objects from reachable default-branch history.
- Establish the current approved landing state as the repository's true first commit.
- Avoid retaining a remote backup reference that would defeat the purge.
- Preserve clean architectural decision history in the Wiki.
- Keep deployment workflows disabled while repository trust is re-established.

This decision primarily supports the Security and Operational Excellence pillars and reduces future
recovery ambiguity.

## Decision

Replace remote `main` with a single parentless commit containing the verified current tree. Push the
new root with an exact `--force-with-lease` expectation against the previously audited remote commit.
Do not create a remote backup branch or bundle containing the superseded secret-bearing objects.

Preserve the Wiki's existing history because its full-history scan found no secret values. Record this
decision and the completed credential-rotation evidence in the Wiki after the main rewrite succeeds.
Any clone made before 2026-07-22 must be replaced with a fresh clone; old history must not be merged
back into the new root.

## Consequences and accepted risks

- The default branch presents one clean first commit, and old commit identifiers are no longer
  reachable through repository branches or tags.
- Previous commit links, comparisons, and local clones no longer describe the authoritative history.
- Existing clones can retain the removed objects and must be replaced rather than merged or pushed.
- GitHub may retain cached views or unreachable objects for a period of time. GitHub Support may be
  required if complete server-side cached-view removal is necessary.
- Actions and dependency services may re-evaluate the new root commit.
- The Wiki retains its useful clean decision history and is not rewritten unnecessarily.

## Alternatives considered

- **Filter only the two affected paths:** rejected because the owner requested a true first commit for
  the landing repository, and the repository had no collaboration topology that justified preserving
  the incomplete prototype history.
- **Leave rotated values in history:** rejected because rotation limits use but does not remove
  sensitive material or establish a clean baseline.
- **Delete and recreate the GitHub repository:** rejected because a targeted default-branch rewrite
  achieves the required result while preserving repository settings, issues, Actions, and the Wiki.
- **Rewrite the Wiki too:** rejected because the Wiki history scan found no secrets.

## Validation and revisit triggers

Validation requires all of the following:

- remote `main` has exactly one commit and that commit has no parent;
- its tree matches the verified pre-rewrite current tree;
- no remote branch or tag retains the prior history;
- current-tree and reachable-history secret scans return no identified values;
- repository policy succeeds and deployment workflows remain disabled;
- live Dependabot severity remains at zero critical and high findings.

Revisit this decision if an old-history reference becomes remotely reachable, another credential is
found, a stale clone pushes prior history, or GitHub Support identifies additional cleanup steps.

## Related decisions and references

- [ADR 0001: Consolidate HCW into one repository](../decisions/0001-single-repository.md)
- [ADR 0005: Use AVM Terraform and GitHub OIDC delivery](../decisions/0005-github-terraform-delivery.md)
- [ADR 0016: Use reversible migration and explicit decommission gates](../decisions/0016-reversible-migration.md)
- [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
