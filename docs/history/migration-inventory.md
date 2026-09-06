# Firebase-to-Azure Migration Inventory

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


**Status:** Architecture inventory; implementation mapping remains to be completed
**Source of truth:** `C:\Users\saulp\Workspace\Personal-Site_HCW`

The migration unit is a user-visible or operational contract, not an individual file or cloud
resource. Each domain must preserve its entry point, persisted state, consumer, authorization,
failure semantics, and verification signal.

## Capability domains

| Domain | Source contract | Azure target | Acceptance evidence |
| --- | --- | --- | --- |
| Public rendering | Vike prerendered routes, metadata, CSP-safe HTML, public data generation | Static Web Apps artifact behind Cloudflare | Route parity, metadata/CSP diff, screenshots, Lighthouse and accessibility checks |
| Dynamic/admin UI | React Router admin, reports and previews | Same frontend with Entra admin client and Azure API adapter | Route/auth matrix, admin component tests, browser smoke |
| Authentication | Firebase Auth, admin claims and allowlists | Entra SPA/API, admin app role/group | Admin/non-admin token tests; bootstrap and revocation evidence |
| Editorial workflow | `content`, queue, editor, review, publish, schedule, archive | Cosmos editorial domain plus API/worker state machine | State-transition matrix, optimistic concurrency, audit and rollback tests |
| Public content | Browser/public reads and generated snapshots | Build-time projections and static public artifacts | Counts, canonical URLs, content samples and no live-data dependency |
| Media | Firebase Storage paths and download URLs | Private Blob Storage plus controlled publication | Object count, size/checksum, metadata/content type, reference rewrite |
| Scheduled work | Firebase schedules for RSS, publishing, cleanup, monitoring and forge | Worker timer triggers and queues | Schedule inventory, idempotent rerun and missed-run recovery |
| Firestore triggers | Document-written inspection, image, snapshots, alerts and labs | Cosmos change feed plus worker queues | Replay/duplicate tests and terminal failure visibility |
| AI | Vertex and multi-provider routing, grading, drafts and images | Azure OpenAI default behind existing provider adapter | Golden dataset, model/version record, safety filter and fallback tests |
| Social publishing | Publer proxy, create/update/delete, calendar reconciliation | Worker-owned Publer integration and Cosmos sync state | Controlled disposable mutation test with stable external IDs |
| Recording ingestion | Manual/Plaud ingestion and source metadata | API/webhook to editorial queue | Plaud-to-content boundary test, deduplication and source trace |
| Notifications | Telegram alerts and health notifications | Worker integration with queue and Key Vault | Test alert, retry, rate-limit and redaction evidence |
| Mailing | Klaviyo proxy and newsletter subscription | Worker/API split with Key Vault secret | Subscribe/unsubscribe contract and provider reconciliation |
| Link and social utilities | Linkie and related APIs | Worker integration | Contract fixtures and live read-only check |
| Cloud tools | Catalog, cache, comparisons, migration workspaces, reports | Cosmos domain plus API and Blob exports | Query parity, ownership authorization and export validation |
| Labs | Firestore jobs/agents/quotas and Hostinger Docker runner | Labs broker, Cosmos jobs, outbound VPS agent | Claim/lease/TTL/quota tests and sandbox smoke |
| Configuration | Site settings, prompt sets, providers, MCP servers | Cosmos configuration domain and public projections | Schema validation, admin authorization and static rebuild propagation |
| Audit and health | Admin audit logs, workflow alerts, dashboard and ops health | Cosmos audit domain plus App Insights/Log Analytics | Correlation from request to state, worker, deployment and alert |
| CI/CD | Firebase deploy, quality, security and runner workflows | GitHub OIDC, AVM/Terraform, immutable app delivery | Protected PR plan, approved apply, artifact provenance and rollback |

## Data inventory requirements

Before container creation, generate a machine-readable inventory with one row per Firestore
collection and subcollection:

| Field | Purpose |
| --- | --- |
| Collection and owner | Establish migration and operational responsibility |
| Document count and size distribution | Estimate transfer, storage and RU behavior |
| Public/admin/backend visibility | Define API and RBAC boundary |
| Read/query shapes | Choose container and partition key |
| Write rate and concurrency | Choose optimistic concurrency and retry behavior |
| Indexes and order/filter combinations | Rebuild only necessary Cosmos indexes |
| TTL/retention/legal value | Control storage and recovery cost |
| References and joins | Preserve IDs and denormalization contracts |
| Timestamp/value types | Normalize Firestore-specific representations |
| Trigger consumers | Preserve event and side-effect behavior |

The existing Azure attempt currently models only a subset of collections and uses several low-cardinality
partition keys. No container is approved until this inventory is complete.

## Migration mechanics

### Firestore documents

1. Export a consistent source snapshot and record its timestamp.
2. Transform Firebase timestamps, references, geo values, sentinel fields, nested objects, and IDs into
   an explicit JSON contract.
3. Pre-create Cosmos containers with approved partition keys and indexing policies.
4. Bulk-load with bounded concurrency and reduced indexing only where safe.
5. Reconcile counts, IDs, samples, aggregates, and required query results.
6. Run an incremental delta pass.
7. Freeze mutations briefly or dual-write only if a tested conflict policy exists.
8. Perform final delta, switch readers/writers, and retain the source for rollback.

### Storage objects

1. Inventory bucket paths, object counts, bytes, content types, metadata, and public-access behavior.
2. Copy with AzCopy's Google Cloud source support or an equivalent checksummed transfer.
3. Rewrite Firebase download URLs through a deterministic mapping table.
4. Reconcile counts, sizes, checksums, metadata, and sampled rendering.
5. Run incremental copy and final cutover copy.

### Functions and triggers

Each exported Firebase function receives an inventory record containing:

- trigger type and schedule/document path;
- authentication and CORS behavior;
- secrets and runtime configuration;
- collections and storage paths touched;
- external APIs and side effects;
- timeout, memory and concurrency assumptions;
- retry/idempotency behavior;
- caller and downstream consumer;
- targeted unit, contract, integration and production verification.

Functions are migrated by domain rather than copying the current large files into one Azure entry
point.

## Cutover gates

| Gate | Required evidence |
| --- | --- |
| Build parity | All intended public routes generated; no unexpected console/build errors |
| Data parity | Counts and required query results reconcile within documented exceptions |
| Media parity | Object checksum/sample rendering and reference rewrites pass |
| Auth | Admin and non-admin matrices pass; break-glass procedure tested |
| Editorial | Create, inspect, edit, schedule, publish, unpublish and soft-delete pass |
| Async | Duplicate, retry, poison and partial-failure tests pass |
| Integrations | Read-only checks plus approved disposable mutation tests for write contracts |
| Labs | Quota, claim, heartbeat, completion, timeout and sandbox evidence pass |
| Operations | Dashboards, alerts, runbooks, restore and rollback exercises pass |
| Cost | Calculator estimate and observed burn rate remain within threshold |
| DNS | TTL, certificate, origin, cache, redirect and rollback checks pass |

## Decommission gates

Firebase/GCP resources and the source repository are not decommissioned or archived until:

- the rollback window has expired;
- no production read or write depends on Firebase/GCP;
- secrets and service identities have a revocation plan;
- backups and migration evidence are retained;
- actual Azure cost is acceptable;
- the owner explicitly approves decommissioning and repository archival.
