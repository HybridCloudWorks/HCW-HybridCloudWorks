# Architecture Plan — HCW on Azure

> **ARCHIVED 2026-08-24.** This document records the architecture decisions
> and cost reasoning that shaped the current website platform. It is retained
> for traceability, not as an implementation checklist. Use [README.md](README.md)
> for the current website and [TODO.md](TODO.md) for pending engineering work.
>
> **Reading convention.** A ~~struck-through~~ heading or bullet is **done**, not
> deleted — the reasoning under it is the point of keeping this file, and a plan
> whose completed entries disappear cannot show which decisions were taken
> deliberately. Completion itself is recorded in [CHANGELOG.md](CHANGELOG.md);
> anything still open here says so in bold. This differs from
> [TODO.md](TODO.md) and [REVIEW.md](REVIEW.md), which carry open work only and
> drop an item once its CHANGELOG entry exists.

**Audience:** engineers implementing the Azure platform in
[HCW-HybridCloudWorks](https://github.com/saulpatinojr/HCW-HybridCloudWorks). **Status:**
recommendation, **now largely built** — see the box below. Written 2026-07-30 against the approved
`.azure/infrastructure-plan.json` and the measured state of this repository; status box added
2026-08-20. **Companion:** [Migration_Plan.md](Migration_Plan.md) — sequencing and execution.

This document exists to do one thing the approved plan does not: reconcile it with the **USD 150 per
month design ceiling**. The plan is architecturally sound and enterprise-shaped. The problem is that
enterprise shape and this budget are in direct conflict, and the conflict is resolvable only by
choosing which properties to keep.

> ## ✅ BUILT — what this document recommended, and what was actually deployed
>
> **The infrastructure recommended below exists.** 129 resources in `centralus`, applied
> 2026-08-19, `terraform plan` clean. Every §3 recommendation was adopted. Read the rest of this
> document for the *reasoning*; read this box for what is running.
>
> | §3 recommendation | Built? |
> | --- | --- |
> | 3.1 Flex Consumption instead of three Elastic Premium plans | **Yes** — one Flex Consumption app, 2048 MB, max 20 instances, zero always-ready |
> | 3.2 Collapse three Functions apps to two | **Went further — one app.** ADR-0019 supersedes ADR-0004 |
> | 3.3 Defer Private Endpoints | **Yes** — service endpoints + VNet rules instead (ADR-001) |
> | 3.4 Cosmos serverless, single region, session consistency | **Yes** — `cosmos-site-prod-cus`, serverless, `zone_redundant = false` |
> | 3.5 Four storage accounts to two | **Yes** — `stsiteprodcus01` (content), `stsitefuncprodcus01` (Functions host) |
> | 3.6 Keep Static Web Apps and the frontend architecture | **Yes** |
>
> **Three things were decided differently from the options §7 offered:**
>
> - **AI inference goes to external provider APIs, not Azure OpenAI and not Vertex.** Forced at
>   apply time: this subscription holds zero gpt-4o TPM quota in every SKU, and DALL-E was not
>   offered in the region at all. Requesting quota would have unblocked a path nothing consumed —
>   `openai-client.js` had no importers. The account, its resource group and the module were all
>   removed; the model router was already provider-abstracted, which is what made this cheap.
> - **The topology is cross-origin, by construction rather than by preference.** The Function App
>   origin is restricted to Cloudflare IP ranges, so the API is reachable only at
>   `https://api-azure.hybridcloudworks.com/api`. §7's "two apps or three" and the same-origin
>   option are both closed by this.
> - **The estate is single-region `centralus`.** `southcentralus` was the original choice and cost
>   three apply-time failures — Cosmos has no subscription region access there and Static Web Apps
>   is not offered there. Region availability is now checked before an apply, not during one.
>
> ~~**What is NOT built:** the application. The Function App holds zero deployed functions, all 73
> Cosmos containers are empty, and no data has been migrated. §5's three hard problems are all
> still ahead.~~ **Historical snapshot only.** The current application and Azure backend are implemented in this repository; live deployment and owner-only configuration checks are tracked in `REVIEW.md`.

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

### ~~3.1 Replace the three Elastic Premium plans with Flex Consumption~~

Flex Consumption supports VNet integration and scales to zero. At 1,395 documents and a
single-operator admin surface, the workload is idle nearly all the time — which is precisely the
shape Flex Consumption prices well and Premium prices badly.

**Cost:** cold starts on infrequently used endpoints. Mitigate with a small always-ready instance
count on the API app only if measurement shows it matters. **Do not** pre-emptively buy always-ready
capacity on the worker or labs apps.

### ~~3.2 Collapse three Functions apps to two~~

`api` (public + admin HTTP) and `worker` (scheduled + change-feed + labs dispatch). Three apps was a
reasonable isolation boundary under per-app-plan billing assumptions; under consumption billing the
isolation is nearly free but the operational surface is not — three deployment pipelines, three sets
of app settings, three cold-start profiles.

Keep them separate **only** if the labs runner genuinely needs a different network posture or a
longer timeout ceiling than the rest. That is a real possibility given the self-hosted agent; decide
it on that basis, not on cost.

### ~~3.3 Defer Private Endpoints — ACCEPTED DECISION (ADR-001, 2026-07-30)~~

**Decision:** Service firewalls + managed identity is the permanent network security model for this workload. Private Endpoints will not be provisioned unless the threat model changes materially (second operator joining, regulated data arriving, or a corporate network peering requirement).

**What was removed from the plan:**
- `snet-private-endpoints` subnet (10.40.1.0/24)
- 4 Private Endpoints (Cosmos, Blob, Queue, Key Vault) — saves **$29.20/month**
- 4 Private DNS Zones — saves **$2.00/month**
- Total saving: **$31.20/month**

**What replaces them:**
- Cosmos DB: service firewall scoped to `snet-site-func-prod` CIDR
- Storage (Blob + Queue): storage firewall scoped to `snet-site-func-prod` CIDR
- Key Vault: Key Vault firewall scoped to `snet-site-func-prod` CIDR + trusted-services bypass for Azure Monitor
- Authentication boundary: managed identity + Entra RBAC — unchanged

**Why this is defensible:**
Traffic from Functions still travels the Azure backbone via VNet integration — it never touches the public internet. The difference between service firewalls and Private Endpoints is whether the PaaS service has a private IP on the VNet. Private IP isolation defends against attackers who already have network adjacency inside a corporate estate. This workload has no corporate estate, no peered networks, and no network-adjacent threat to defend against.

The plan's own tradeoff note already conceded origin-bypass risk is "documented for later hardening." Spending $31/month — 21% of the total budget — on a control whose threat doesn't exist here is incoherent.

**Revisit if:** a second operator joins and corporate VPN/peering is required, any regulated data (PII, PCI, HIPAA) arrives in the system, or the workload's budget grows to the point where the cost is immaterial.

### ~~3.4 Cosmos DB in serverless mode, single region, session consistency~~

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

### ~~3.5 Reduce four storage accounts to two~~

`content` (public media, the only account needing anonymous or CDN read) and `platform` (function
state, queues, artefacts). Per-app storage accounts are a scaling-and-blast-radius pattern; at this
size they mostly multiply configuration and private-endpoint cost.

### ~~3.6 Keep Static Web Apps, and keep the current frontend architecture exactly~~

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
| AI inference         | Vertex / `@google/genai`                     | **External provider APIs**, keyed from Key Vault — neither Vertex nor Azure OpenAI | Medium      |
| Labs runner          | Self-hosted agent + `lab_jobs` polling       | Same pattern; agent re-pointed at Azure queue    | Medium      |
| Edge                 | Cloudflare                                   | Cloudflare retained                              | Low         |

---

## 5. The three genuinely hard problems

Everything else is porting. These are re-architecture, and they should drive the schedule.

> **All three are solved, 2026-08-21.** They are struck through below rather than
> deleted: the reasoning is what makes the next re-architecture cheaper, and 5.1
> in particular named the failure mode (*losing `firestore.rules` silently*) that
> the server-side guard suite was then built to prevent. Entries in
> [CHANGELOG.md](CHANGELOG.md); the per-item evidence is Migration_Plan §3.1–3.5.

### ~~5.1 Browser-direct database access has no Azure equivalent~~ — SOLVED

> `frontend/src` has zero `firebase/*` imports; every read is an authenticated
> HTTP call through `lib/api.js`. `firestore.rules` did not port — it was
> re-implemented as server-side authorisation in the API, and the guard suite
> that replaced it is what `route-inventory.test.js` and the per-route role
> tests hold in place. This was the migration's most dangerous silent-loss
> risk and it is closed by tests rather than by assertion.

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

### ~~5.2 Authentication changes shape~~ — SOLVED, MSAL as recommended

> MSAL sits behind `frontend/src/lib/auth/`; the API validates the token and
> holds the control point, with SWA route rules as defence in depth exactly as
> recommended below. `firebase/auth` is gone from the admin surface. What is
> left is not code: the Entra `Admin` app-role assignment is an owner action in
> [REVIEW.md](REVIEW.md).

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

### ~~5.3 Firestore trigger semantics differ from the Cosmos change feed~~ — SOLVED

> The audit was done and all 11 were ported: eight as change-feed functions
> unchanged, and the three that depended on a delete the feed never delivers as
> explicit delete endpoints. The per-trigger disposition is the table in
> Migration_Plan §4.3.

11 `onDocumentWritten` triggers assume before/after document images and fire on delete. The Cosmos
change feed (standard mode) delivers current-state documents and **does not surface deletes**. Any
trigger that depends on the prior value or on deletion must be redesigned — typically via
soft-delete flags or explicit API-side orchestration.

Audit all 11 before estimating. This is where silent behaviour loss hides.

---

## ~~6. Do not change the build tooling~~ — HELD

> **The recommendation held and the build tooling never changed.** Vite + Vike +
> React 19 still produce the static output Static Web Apps serves. The one
> correction to the reasoning below is the page count: the 90-document figure
> belonged to the source repository, and this repository's build produced three
> until `frontend/scripts/prerender.mjs` (T-515) made the pre-render real. It
> now renders every route in its manifest through the real application and
> **fails the build** on one that throws or comes back shell-sized.

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

**All six are now closed.** Kept with their outcomes rather than deleted, because the
reasoning is what makes the next similar decision cheaper. This paragraph read
"four of these six" until 2026-08-28, while every one of the six beneath it was
already struck through as decided — an accurate-when-written count that nobody
updated when the list moved past it, which is the most common way a document
like this goes quietly stale.

1. ~~**Two Functions apps or three?**~~ **DECIDED — one.** ADR-0019 supersedes ADR-0004. The labs
   runner's needs did not justify a second app, and one app is one cold-start budget, one
   deployment, one identity.
2. ~~**Private endpoints now or later?**~~ **DECIDED — later** (ADR-001, 2026-07-30). Service
   endpoints and VNet rules carry the posture at zero monthly cost. Revisit if the workload ever
   holds regulated data.
3. ~~**Auth model — MSAL or SWA built-in?**~~ **DECIDED — MSAL.** Implemented; `firebase/auth` is
   gone from the admin surface. The remaining work is Entra registration, not code — REVIEW.md §2.2.
4. ~~**AI provider — Vertex or Azure OpenAI?**~~ **DECIDED — neither.** External provider APIs,
   keyed from Key Vault. The decision was forced by quota rather than chosen: zero gpt-4o TPM in
   every SKU, no DALL-E in region. The provider-abstracted model router is what kept the cost of
   being wrong low, which is the transferable lesson.
5. ~~**Cosmos partition-key strategy per collection**~~ — **DECIDED and implemented** in the
   generated container contract consumed by Terraform and the current API.
6. ~~**What happens to `blogs`**~~ — **DECIDED: retain it** for the current website compatibility
   surface; retirement is not an open engineering task.

---

## 8. What good looks like at the end

Four of the five are met. Struck through rather than deleted, so the one that is
not stays visible next to the four that are.

- Monthly spend under USD 150 with headroom, dominated by consumption rather than idle capacity.
  **Structurally true — the estate is consumption-billed throughout — but the
  cost gate has never been run.** Migration_Plan §7 names it; measuring one full
  week of actual spend is still owed.
- ~~No connection strings or account keys anywhere; managed identity throughout.~~
  Cosmos key auth is disabled at the account, storage SAS is user-delegation
  signed, and every credential resolves from Key Vault by managed identity.
- ~~Server-side authorisation tested to at least the coverage `firestore.rules` has today.~~
  §5.1 — the guard suite and `route-inventory.test.js` are what hold it.
- ~~Public site pre-rendered and served statically, indistinguishable from today to a visitor.~~
  T-515; the deploy workflow asserts the document count independently, because a
  shell deploys perfectly well and is visible only to a crawler.
- ~~A real 404 for unknown URLs (see Migration_Plan §3.4 — currently a soft 404 returning HTTP 200).~~
  Migration_Plan §3.4 — `responseOverrides.404` now returns `statusCode: 404`.
