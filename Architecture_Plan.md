# Architecture Plan — HCW on Azure

**Audience:** engineers implementing the Azure platform in
[HCW-HybridCloudWorks](https://github.com/saulpatinojr/HCW-HybridCloudWorks). **Status:**
recommendation. Written 2026-07-30 against the approved `.azure/infrastructure-plan.json` and the
measured state of this repository. **Companion:** [Migration_Plan.md](Migration_Plan.md) —
sequencing and execution.

This document exists to do one thing the approved plan does not: reconcile it with the **USD 150 per
month design ceiling**. The plan is architecturally sound and enterprise-shaped. The problem is that
enterprise shape and this budget are in direct conflict, and the conflict is resolvable only by
choosing which properties to keep.

---

## 1. The measurement that should drive every decision

| Measure                                      | Value                                                             |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Firestore documents, **total**               | **1,395** across 16 populated collections                         |
| Largest collection                           | `content` — 947 docs                                              |
| Cloud Functions exported (source GCP repo)   | **117** (95 HTTP, 16 scheduled, 11 Firestore-trigger, 1 callable) |
| Functions source (source GCP repo)           | 22,943 lines / 26 files                                           |
| Azure Functions already ported (this repo)   | 10 files / 877 lines (7 HTTP, 4 Timer, 2 Cosmos triggers)         |
| Frontend source (measured 2026-07-30)        | **65,973 lines** across 244 source files                          |
| Files reading Firestore **from the browser** | **34** (imports `firebase/firestore` directly)                    |
| Pre-rendered public routes                   | 90 (from last full build; App.jsx registers ~105 lazy routes)     |
| Admin modules via `lazyPage()`               | **26** lazy-loaded admin routes in App.jsx; 43 admin .jsx files   |

**Note:** the Cloud Functions and source-line counts above are from the source GCP/Firebase
repository, not this Azure target repo. The Azure Functions porting is underway: 10 files and 877
lines already live under `functions/src/`.

**This is a very small dataset behind a very large amount of code.** Read it twice, because it
inverts the usual cost intuition. Nothing here is throughput-bound. The entire production dataset
would fit in a single Cosmos serverless container and be served for a few dollars a month.

**Therefore the budget is consumed by idle capacity, not by work.** Every resource billed per hour
rather than per request is the enemy of the USD 150 ceiling, and the approved plan contains several.

---

## 2. Where the approved plan collides with the ceiling

The plan provisions three dedicated App Service Plans (`asp-hcw-api-prod`, `asp-hcw-worker-prod`,
`asp-hcw-labs-prod`), a VNet with two subnets, four Private Endpoints, four Private DNS zones, and
four storage accounts.

VNet integration and Private Endpoints for Functions historically require **Elastic Premium (EP1)**
or a Dedicated plan. Three such plans plus four private endpoints is, on published list pricing,
comfortably **two to three times the entire monthly ceiling before a single request is served**.

### Pricing basis

Verified live against the Azure Retail Prices API (`eastus`, Consumption) on 2026-07-30:

| Meter                                         | Price                         |
| --------------------------------------------- | ----------------------------- |
| Flex Consumption — On Demand Execution Time   | **$0.000026 / GB-second**     |
| Flex Consumption — On Demand Total Executions | **$0.000004 / 10 executions** |
| Flex Consumption — Always Ready Baseline      | $0.000004 / GB-second         |
| Cosmos DB — Data Stored                       | **$0.25 / GB-month**          |
| Cosmos DB — 100 Multi-master RU/s             | $0.016 / hour                 |
| Standard IPv4 Static Public IP                | $0.005 / hour                 |
| Inter-Region Egress                           | $0.035 / GB                   |

**Four figures that decide this question could not be resolved through that API and must be priced
by the implementing team before any apply:** Elastic Premium (EP1) hourly rate, Private Endpoint
hourly rate and data-processing charge, Static Web Apps Standard monthly, and Private DNS zone
monthly.

> **The "two to three times the ceiling" claim above is therefore an estimate, not a quote.** It
> rests on published list pricing for those four items, which are exactly the four this document
> could not verify. Price them first — that single exercise either confirms or refutes the whole
> argument of §3.
>
> What does **not** depend on those figures is the structural claim: this workload is idle almost
> all the time, so hourly-billed resources dominate its cost and consumption-billed ones barely
> register. That holds regardless of the exact rates.

---

## 3. Recommended changes to the approved architecture

Each is stated as a change, its reason, and what it costs you.

### 3.1 Replace the three Elastic Premium plans with **Flex Consumption**

Flex Consumption supports VNet integration and scales to zero. At 1,395 documents and a
single-operator admin surface, the workload is idle nearly all the time — which is precisely the
shape Flex Consumption prices well and Premium prices badly.

**Cost:** cold starts on infrequently used endpoints. Mitigate with a small always-ready instance
count on the API app only if measurement shows it matters. **Do not** pre-emptively buy always-ready
capacity on the worker or labs apps.

### 3.2 Collapse three Functions apps to **two**

`api` (public + admin HTTP) and `worker` (scheduled + change-feed + labs dispatch). Three apps was a
reasonable isolation boundary under per-app-plan billing assumptions; under consumption billing the
isolation is nearly free but the operational surface is not — three deployment pipelines, three sets
of app settings, three cold-start profiles.

Keep them separate **only** if the labs runner genuinely needs a different network posture or a
longer timeout ceiling than the rest. That is a real possibility given the self-hosted agent; decide
it on that basis, not on cost.

### 3.3 Defer Private Endpoints — **ACCEPTED DECISION (ADR-001, 2026-07-30)**

**Decision:** Service firewalls + managed identity is the permanent network security model for this workload. Private Endpoints will not be provisioned unless the threat model changes materially (second operator joining, regulated data arriving, or a corporate network peering requirement).

**What was removed from the plan:**
- `snet-private-endpoints` subnet (10.40.1.0/24)
- 4 Private Endpoints (Cosmos, Blob, Queue, Key Vault) — saves **$29.20/month**
- 4 Private DNS Zones — saves **$2.00/month**
- Total saving: **$31.20/month**

**What replaces them:**
- Cosmos DB: service firewall scoped to `snet-functions-integration` CIDR
- Storage (Blob + Queue): storage firewall scoped to `snet-functions-integration` CIDR
- Key Vault: Key Vault firewall scoped to `snet-functions-integration` CIDR + trusted-services bypass for Azure Monitor
- Authentication boundary: managed identity + Entra RBAC — unchanged

**Why this is defensible:**
Traffic from Functions still travels the Azure backbone via VNet integration — it never touches the public internet. The difference between service firewalls and Private Endpoints is whether the PaaS service has a private IP on the VNet. Private IP isolation defends against attackers who already have network adjacency inside a corporate estate. This workload has no corporate estate, no peered networks, and no network-adjacent threat to defend against.

The plan's own tradeoff note already conceded origin-bypass risk is "documented for later hardening." Spending $31/month — 21% of the total budget — on a control whose threat doesn't exist here is incoherent.

**Revisit if:** a second operator joins and corporate VPN/peering is required, any regulated data (PII, PCI, HIPAA) arrives in the system, or the workload's budget grows to the point where the cost is immaterial.

### 3.4 Cosmos DB in **serverless** mode, single region, session consistency

1,395 documents. Serverless bills per request-unit consumed with no hourly floor. Provisioned
throughput — even the 400 RU/s minimum — is a permanent charge for capacity this workload will never
use. Multi-region write (the `100 Multi-master RU/s` meter above) must not be enabled.

**Note:** Cosmos DB Serverless does **not** support availability zones. The plan previously had
`availabilityZones: true` on a serverless account — this has been corrected to `false`. Zone
redundancy requires provisioned or autoscale throughput, which adds a minimum monthly floor (~$6–8).
For a single-operator content site on serverless, the cost is not justified.

**Watch:** serverless has a per-container storage ceiling and lower burst limits. Both are far above
this workload. Re-evaluate only if a collection passes roughly 50 GB or sustained heavy traffic
appears.

### 3.5 Reduce four storage accounts to **two**

`content` (public media, the only account needing anonymous or CDN read) and `platform` (function
state, queues, artefacts). Per-app storage accounts are a scaling-and-blast-radius pattern; at this
size they mostly multiply configuration and private-endpoint cost.

### 3.6 Keep Static Web Apps, and keep the current frontend architecture exactly

The plan already specifies `publicContent: "Vike-prerendered static output"` and
`adminShell: "Publicly downloadable SPA…"`. **That is what this repository already produces.** See
§6 — the build tooling is the one part of this migration that should not change.

---

## 4. Target architecture, service by service

| Concern              | Today (GCP/Firebase)                         | Target (Azure)                                   | Difficulty  |
| -------------------- | -------------------------------------------- | ------------------------------------------------ | ----------- |
| Static hosting       | Firebase Hosting                             | Static Web Apps (Standard)                       | Low         |
| Routing / rewrites   | `firebase.json` rewrites                     | `staticwebapp.config.json`                       | Low         |
| HTTP API             | 95 `onRequest` Gen2 functions                | Azure Functions HTTP triggers, Flex Consumption  | **High**    |
| Scheduled work       | 16 `onSchedule`                              | Timer triggers                                   | Medium      |
| Data-change triggers | 11 `onDocumentWritten`                       | Cosmos DB change feed triggers                   | **High**    |
| Database             | Firestore                                    | Cosmos DB (NoSQL API), serverless                | **High**    |
| Browser → DB reads   | Firestore Web SDK + security rules, 47 files | **No equivalent.** Must become API calls         | **Highest** |
| Auth                 | Firebase Auth                                | Entra ID (MSAL) or SWA built-in auth             | **High**    |
| Object storage       | Firebase Storage                             | Blob Storage                                     | Medium      |
| Secrets              | Secret Manager (+ `defineSecret`)            | Key Vault + managed identity                     | Medium      |
| Scheduling infra     | Cloud Scheduler                              | Timer triggers (no separate service)             | Low         |
| AI inference         | Vertex / `@google/genai`                     | Decide: keep Vertex cross-cloud, or Azure OpenAI | Medium      |
| Labs runner          | Self-hosted agent + `lab_jobs` polling       | Same pattern; agent re-pointed at Azure queue    | Medium      |
| Edge                 | Cloudflare                                   | Cloudflare retained                              | Low         |

---

## 5. The three genuinely hard problems

Everything else is porting. These are re-architecture, and they should drive the schedule.

### 5.1 Browser-direct database access has no Azure equivalent

**47 frontend files import `firebase/firestore` and query the database directly from the browser**,
with Firestore Security Rules as the authorisation boundary. Cosmos DB has no browser-safe
equivalent: there is no client SDK that can be given a scoped, rule-enforced, user-bound view.

Every one of those reads must become an authenticated HTTP call to the API. This is the single
largest work item in the migration and it changes the frontend's data-fetching architecture, not
just its imports.

It also **deletes an entire security artefact**: `firestore.rules` currently encodes the
authorisation model and is covered by an emulator test suite. That logic does not port — it must be
re-implemented as server-side authorisation in the API and re-tested there. Losing it silently is
the most dangerous failure mode in this migration.

### 5.2 Authentication changes shape

Firebase Auth is client-side with ID tokens verified in functions via `requireAdminClaims`. Entra ID
is the approved replacement. Two viable models:

- **SWA built-in auth** — platform-managed, `allowedRoles` on routes, least code. Attractive because
  it can gate `/admin/*` at the edge, which is strictly better than today.
- **MSAL in the SPA + JWT validation in the API** — more code, more control, portable off SWA.

**Recommendation: MSAL + API validation.** The plan's security model puts the API at the control
point, and SWA-only auth ties authorisation to the host. Use SWA route rules as defence in depth,
not as the boundary.

Admin role claims currently live in custom claims plus an `admins` collection; both need an Entra
group-to-role mapping.

### 5.3 Firestore trigger semantics differ from the Cosmos change feed

11 `onDocumentWritten` triggers assume before/after document images and fire on delete. The Cosmos
change feed (standard mode) delivers current-state documents and **does not surface deletes**. Any
trigger that depends on the prior value or on deletion must be redesigned — typically via
soft-delete flags or explicit API-side orchestration.

Audit all 11 before estimating. This is where silent behaviour loss hides.

---

## 6. Do not change the build tooling

The question was raised whether to move off Vite as part of this. **No.**

- The approved plan's own target is "Vike-prerendered static output" — the current output.
- Vite + Vike + React 19 produce 90 pre-rendered HTML files, which is exactly what Static Web Apps
  serves best.
- Azure SWA has no general Node SSR runtime, so any framework move toward SSR would force App
  Service or Container Apps and break both the plan and the ceiling.
- The build already works, is tested, and is the least risky component in the system.

**Changing the build tool would add risk to the migration while solving nothing in it.** The one
build-adjacent change required is the routing config (§4), and that is a new file, not a port.

**The corollary:** keep the 90-page pre-render and the client-side admin shell as they are. §3.6.

---

## 7. Decisions the team must make before implementation

1. **Two Functions apps or three?** Decide on the labs runner's network/timeout needs (§3.2).
2. **Private endpoints now or later?** §3.3 recommends later. This is a security posture decision
   and should be recorded as an ADR either way.
3. **Auth model** — MSAL or SWA built-in (§5.2). Recommendation: MSAL.
4. **AI provider** — keep Vertex cross-cloud, or move to Azure OpenAI. Note that the model router
   (`functions/lib/ai-model-router.js`) is already provider-abstracted, so this is a smaller
   decision than it looks; cross-cloud egress and a second cloud's credentials are the real
   considerations.
5. **Cosmos partition-key strategy per collection** — must be decided before any data is written.
   `content` (947 docs) is the only collection where it materially matters.
6. **What happens to `blogs`** — 242 documents, legacy, read only through a fallback path. Migrating
   it carries the legacy forward. Consider whether cutover is the moment to retire it instead.

---

## 8. What good looks like at the end

- Monthly spend under USD 150 with headroom, dominated by consumption rather than idle capacity.
- No connection strings or account keys anywhere; managed identity throughout.
- Server-side authorisation tested to at least the coverage `firestore.rules` has today.
- Public site pre-rendered and served statically, indistinguishable from today to a visitor.
- A real 404 for unknown URLs (see Migration_Plan §3.4 — currently a soft 404 returning HTTP 200).
