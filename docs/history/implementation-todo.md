# HCW Azure Migration TODO

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


**Status:** Active

**Last updated:** 2026-07-22

**Budget ceiling:** USD 150 per month

**Environment:** One production workload state

This is the authoritative execution checklist for the approved Azure migration. Completing a checkbox
does not authorize a production apply, DNS change, external mutation, Firebase/GCP decommission, or
repository archival.

## P0: Immediate security and governance

- [x] Verify rotation and revocation of every credential identified by the historical security audit.
  The owner confirmed completion on 2026-07-22 for the Firebase Admin service-account key,
  Kubernetes administrator certificate/key, Notion token and downstream secrets, Publer API key, and
  Firebase deployment token.
- [x] Rotate and revoke the OpenAI and Anthropic API keys formerly tracked in
  `frontend/platform/terraform/gcp-secrets/secrets.auto.tfvars`. The owner confirmed completion on
  2026-07-22.
- [x] Re-root the default branch after credential rotation and explicit owner approval. Remote `main`
  now contains one parentless clean baseline commit; clones made before 2026-07-22 must be replaced.
  See [ADR 0017](../decisions/0017-repository-history-remediation.md).
- [x] Remediate the 83 Dependabot alerts reported on 2026-07-22. Commit `dc4615f` reduced the live
  GitHub alert count to three moderate findings with zero critical or high findings.
- [ ] Monitor the three remaining upstream-blocked alerts: `@hono/node-server` and
  `@opentelemetry/core` under Firebase CLI, and `uuid` under the legacy Firebase VPS agent. Do not
  force incompatible transitive majors merely to suppress the audit.
- [ ] Enable and verify default-branch protection and required status checks.
- [ ] Confirm GitHub Wiki edit permissions match repository governance expectations.
- [ ] Define owners and notification recipients for budgets and production incidents.

## Phase 0: Architecture and contracts

- [x] Inventory both repositories and identify the incomplete Azure prototype.
- [x] Establish the five-pillar target architecture.
- [x] Approve the preliminary Azure resource list.
- [x] Create and approve the infrastructure plan.
- [x] Establish the Architecture Decision Record register.
- [x] Move human-facing documentation to the GitHub Wiki.
- [ ] Complete the Firestore collection, query, and partition inventory.
- [ ] Complete the Function, trigger, and integration inventory.
- [ ] Select the primary Azure region and verify service, SKU, zone, and model availability.
- [ ] Refresh the Azure Pricing Calculator estimate.

## Phase 1: Repository consolidation

- [ ] Define the source-import strategy and history/provenance record.
- [ ] Reconcile the imported `frontend/` application with the authoritative old repository.
- [ ] Establish the final root layout for frontend, Functions, infrastructure, migrations, and agents.
- [ ] Reconcile or quarantine duplicate `frontend/functions`, `frontend/scripts`, and labs paths.
- [ ] Remove obsolete prototype paths only after their replacements are verified.
- [ ] Port quality, test, accessibility, route, CSP, and security checks.

## Phase 2: Bootstrap and foundation

- [ ] Bootstrap remote Terraform state, locking, recovery, and access controls.
- [ ] Create separate least-privilege GitHub OIDC identities for plan and production apply.
- [ ] Compose pinned Azure Verified Modules for the resource group, network, identities, Key Vault,
  monitoring, and budget.
- [ ] Run Terraform formatting, backend-free initialization, validation, tests, policy, and security scans.
- [ ] Review creates, replacements, destroys, RBAC, state, and network exposure.
- [ ] Obtain explicit approval before the first Azure apply.

## Phase 3: Empty platform and observability

- [ ] Provision Static Web Apps, Function Flex boundaries, host storage, App Insights, and Log Analytics.
- [ ] Deploy only health and readiness endpoints.
- [ ] Verify managed identity, network ACLs, diagnostics, budget controls, and alerts.
- [ ] Exercise artifact rollback and state recovery before data migration.

## Phase 4: Data and media

- [ ] Approve and create Cosmos DB containers, partition keys, and indexes.
- [ ] Export, transform, and bulk-load Firestore data.
- [ ] Copy Storage objects and rewrite URLs through a deterministic map.
- [ ] Reconcile counts, IDs, hashes, sizes, metadata, samples, and required queries.
- [ ] Run incremental synchronization and document rollback.

## Phase 5: Application contracts

- [ ] Move the frontend into the final layout without losing static rendering.
- [ ] Replace Firebase Auth with Entra ID for administrators.
- [ ] Replace direct Firebase access with public projections or authenticated Azure APIs.
- [ ] Port editorial operations domain by domain.
- [ ] Port schedules, queues, change feed, media, AI, and integration workers.
- [ ] Port the labs broker and rotate the Hostinger agent contract.

## Phase 6: GitHub delivery

- [ ] Implement pull-request quality, test, security, policy, and Terraform plan workflows.
- [ ] Protect the production GitHub Environment and default branch.
- [ ] Pin third-party actions to immutable commit SHAs.
- [ ] Build once and promote immutable frontend and Function artifacts.
- [ ] Add provenance, attestations, release notes, concurrency, smoke tests, and rollback jobs.

## Phase 7: Parallel verification and cutover

- [ ] Validate public routes, metadata, CSP, accessibility, and performance parity.
- [ ] Validate admin authentication and complete editorial state transitions.
- [ ] Validate duplicate, retry, poison-message, and partial-failure behavior.
- [ ] Run approved disposable external mutation tests.
- [ ] Validate labs quota, claim, timeout, heartbeat, sandboxing, and output redaction.
- [ ] Review actual Azure burn rate against the USD 150 ceiling.
- [ ] Obtain explicit DNS-cutover approval and execute the rollback-ready runbook.

## Phase 8: Stabilization and decommission

- [ ] Complete the stabilization window with no Firebase production dependency.
- [ ] Export final Firebase/GCP backups and migration evidence.
- [ ] Obtain explicit approval before revoking GCP credentials or decommissioning resources.
- [ ] Confirm the old repository is clean, tagged, and documented.
- [ ] Obtain explicit approval before archiving `Personal-Site_HCW`.

## Definition of done

The migration is complete only when code, data, media, identity, integrations, labs, delivery,
operations, recovery, and cost have verified Azure evidence, and the owner has approved both GCP
decommissioning and archival of the old repository.
