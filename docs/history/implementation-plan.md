# HCW Azure Migration Implementation Plan

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


**Status:** Architecture plan approved; Terraform generation not yet started

**Production model:** One production workload state

**Repository model:** This repository becomes the source of truth; `Personal-Site_HCW` is archived
only after cutover and rollback acceptance.

This plan sequences delivery after the [approved architecture](../architecture/architecture.md) is
approved. No phase authorizes a production apply, DNS change, external mutation, Firebase
decommission, or repository archive by itself.

## Phase 0: Architecture and contracts

- [x] Inventory both repositories and identify the incomplete Azure prototype.
- [x] Establish the five-pillar target architecture.
- [x] Approve the preliminary Azure resource list.
- [x] Create the draft infrastructure plan.
- [x] Approve the draft infrastructure plan.
- [x] Establish the canonical [Architecture Decision Record register](../decisions/index.md).
- [ ] Complete the Firestore collection/query/partition inventory.
- [ ] Complete the Function/trigger/integration inventory.
- [ ] Select the primary region and verify service/SKU/model availability.
- [ ] Refresh the Azure Pricing Calculator estimate.

## Phase 1: Repository consolidation

- [ ] Define the source-import strategy and history/provenance record.
- [ ] Reconcile the current `frontend/` copy with the newer source application.
- [ ] Establish the final repository layout for app, functions, infrastructure, migrations, and docs.
- [ ] Remove or quarantine obsolete prototype paths only after their replacement is verified.
- [ ] Port the source quality, test, accessibility, route, CSP, and security checks.

## Phase 2: Bootstrap and foundation

- [ ] Bootstrap remote state, recovery, OIDC trust, and plan/apply identities.
- [ ] Compose pinned AVMs for resource group, network, identities, Key Vault, monitoring, and budget.
- [ ] Run Terraform formatting, backend-free init, validation, tests, policy, and security scans.
- [ ] Review the complete plan for creates, replacements, destroys, RBAC, state, and exposure.
- [ ] Obtain explicit approval before the first Azure apply.

## Phase 3: Empty platform and observability

- [ ] Provision Static Web Apps, Function Flex boundaries, host storage, App Insights, and Log Analytics.
- [ ] Deploy only health/readiness endpoints.
- [ ] Verify managed identity, network ACLs, diagnostics, budgets, and alerts.
- [ ] Exercise artifact rollback and state recovery before data migration.

## Phase 4: Data and media

- [ ] Create approved Cosmos containers and indexes.
- [ ] Export, transform, and bulk-load Firestore data.
- [ ] Copy Storage objects and rewrite URLs through a deterministic map.
- [ ] Reconcile counts, IDs, hashes, sizes, metadata, samples, and required queries.
- [ ] Run incremental synchronization and document rollback.

## Phase 5: Application contracts

- [ ] Move the current frontend into the target layout without losing static rendering.
- [ ] Replace Firebase Auth with Entra for administrators.
- [ ] Replace direct Firebase reads/writes with public projections or authenticated Azure APIs.
- [ ] Port editorial operations domain by domain.
- [ ] Port background schedules, queues, change feed, media, AI, and integration workers.
- [ ] Port the labs broker and rotate the Hostinger agent contract.

## Phase 6: GitHub delivery

- [ ] Implement PR quality, test, security, policy, and Terraform plan workflows.
- [ ] Protect the production environment and default branch.
- [ ] Pin all third-party actions to immutable SHAs.
- [ ] Build once and promote immutable frontend and Function artifacts.
- [ ] Add provenance/attestation, release notes, concurrency, smoke tests, and rollback jobs.

## Phase 7: Parallel verification and cutover

- [ ] Validate public route, metadata, CSP, accessibility, and performance parity.
- [ ] Validate admin auth and full editorial state transitions.
- [ ] Validate duplicate/retry/poison/partial-failure behavior.
- [ ] Run approved disposable external mutation tests.
- [ ] Validate labs quota, claim, timeout, heartbeat, sandbox, and output redaction.
- [ ] Review actual Azure burn rate against the USD 150 ceiling.
- [ ] Obtain explicit DNS-cutover approval and execute the rollback-ready runbook.

## Phase 8: Stabilization and decommission

- [ ] Complete the agreed stabilization window with no Firebase production dependency.
- [ ] Export final Firebase/GCP backups and migration evidence.
- [ ] Obtain explicit approval to revoke GCP credentials and decommission resources.
- [ ] Confirm the old repository is clean, tagged, and documented.
- [ ] Obtain explicit approval to archive `Personal-Site_HCW`.

## Definition of done

The migration is complete only when code, data, media, identity, integrations, labs, delivery,
operations, recovery, and cost have verified evidence in Azure, and the owner has approved both GCP
decommissioning and archival of the old repository.
