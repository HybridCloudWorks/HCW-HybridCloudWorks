# Architecture Decision Records

This directory is the canonical record of HybridCloudWorks architecture decisions. The architecture
describes the system as a whole; an ADR explains why a material choice was made, its purpose, its
tradeoffs, and when it must be reconsidered.

## Policy

Create an ADR before implementing a decision that changes any of the following:

- cloud service, hosting model, data store, network boundary, identity model, or trust boundary;
- availability, recovery, security, performance, observability, or cost posture;
- Terraform state, module strategy, deployment authority, or GitHub governance;
- migration, compatibility, cutover, decommission, or repository ownership;
- external integration contract or irreversible operational behavior.

ADR numbers are never reused. Accepted ADRs are immutable except for spelling, links, and status. A
changed decision gets a new ADR that supersedes the old one. Pull requests implementing architecture
must link the applicable ADRs. If no ADR applies, the pull request must say why the change is not
architecturally significant.

## Status lifecycle

`Proposed` → `Accepted` → `Superseded` or `Deprecated`

- **Proposed:** under review and not authorized for implementation.
- **Accepted:** approved direction; implementation may still be incomplete.
- **Superseded:** replaced by a newer ADR, which must be linked.
- **Deprecated:** retained for history but no longer applicable.

## Required sections

Every ADR includes:

1. status and decision date;
2. context and problem;
3. purpose and decision drivers;
4. decision;
5. consequences and accepted risks;
6. alternatives considered;
7. validation and revisit triggers;
8. related decisions and references.

## Decision register

| ADR | Decision | Status | Primary purpose |
| --- | --- | --- | --- |
| [0001](0001-single-repository) | Consolidate HCW into one repository | Accepted | Prevent application/platform drift |
| [0002](0002-cloudflare-edge) | Retain Cloudflare as the initial edge | Accepted | Preserve edge capability within budget |
| [0003](0003-cosmos-serverless) | Start with Cosmos DB Serverless | Accepted | Match document workload and spiky demand |
| [0004](0004-functions-boundaries) | Separate API, worker, and labs Function Apps | Superseded by 0019 | Enforce trust and permission boundaries |
| [0005](0005-github-terraform-delivery) | Use AVM Terraform and GitHub OIDC delivery | Accepted; module clause superseded by 0020 | Make infrastructure changes reviewable and credentialless |
| [0006](0006-admin-identity) | Use Entra ID for administrators only | Accepted | Protect administration without requiring public accounts |
| [0007](0007-static-first-frontend) | Preserve static-first rendering on Static Web Apps | Accepted | Keep public content fast and backend-independent |
| [0008](0008-selective-private-link) | Use selective Private Link | Accepted | Secure sensitive data while containing network cost |
| [0009](0009-production-state) | Use one production workload state | Accepted | Match current operating scale without environment sprawl |
| [0010](0010-observability) | Centralize bounded observability | Accepted | Make health and change outcomes measurable |
| [0011](0011-single-region-recovery) | Use single-region, zone-aware recovery | Accepted | Balance reliability with the USD 150 ceiling |
| [0012](0012-asynchronous-workflows) | Use queues and idempotent workers for side effects | Accepted | Make publishing and integrations retry-safe |
| [0013](0013-ai-provider-strategy) | Use Azure OpenAI as a feature-gated default | Accepted; provisioning gate ratified by 0018 | Remove the Vertex dependency without making AI critical path |
| [0014](0014-storage-and-media) | Keep source media private in ZRS Blob Storage | Accepted; ZRS amended to LRS by 0018 | Protect and recover media economically |
| [0015](0015-cost-governance) | Enforce a USD 150 monthly design ceiling | Accepted | Make cost an implementation constraint |
| [0016](0016-reversible-migration) | Use reversible migration and explicit decommission gates | Accepted | Prevent premature data or rollback loss |
| [0017](0017-repository-history-remediation) | Re-root the default branch after credential rotation | Accepted | Remove reachable secret-bearing Git history |
| [0018](0018-as-built-plan-v02) | Supersede plan v0.1 with the as-built v0.2 plan | Accepted | Make the approved plan describe the real system; disposition every deviation |
| [0019](0019-single-function-app) | One Function App execution boundary | Accepted | Ratify least-privilege-by-contract over process separation |
| [0020](0020-native-terraform-root-module) | Flat native-provider Terraform root module (no AVM) | Accepted | Keep resource addresses stable on a live state |
| [0021](0021-container-apps-ci-runner) | Container Apps self-hosted CI runner failover | Accepted | Keep delivery alive through GitHub-hosted runner outages |

## Template

Copy the [ADR template](ADR-Template) for new decisions. Do not edit an accepted ADR to represent a new
decision; create the next numbered record and mark the earlier ADR superseded.
