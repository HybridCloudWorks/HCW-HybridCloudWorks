# ADR 0034: AI model selection — one priority list, per-task overrides, a live model catalogue

**Status:** Accepted 2026-10-04 (owner brief and acceptance the same day; design only). Implementation: #856 (task registry and recommendations), #857 (model catalogue and refresh), #858 (selection v2, resolver, migration), #859 (Priority list and Tasks tab), #860 (audio and image tasks), on the board at P2, slice 5 at P3.

## Context

The AI Engine page grew its controls one need at a time, and on 2026-10-04 the
owner's screenshots showed what that produced. Three mechanisms decide which
provider serves a call, and they overlap:

1. **The global order** — the provider cards' `order`, draggable on AI
   Services. The owner's list read NVIDIA 1, Foundry 2, Claude 3 (off),
   Gemini 4, OpenAI 5 (off).
2. **Per-feature placement** — `first | order | off` per feature, but only
   for the providers code lists in `PER_FEATURE_PROVIDERS` (NVIDIA since
   #701, Foundry since #849). Under Content Inspector both NVIDIA and Foundry
   read "First — tried before every other provider", and nothing on the page
   says that two Firsts are settled by the global order, so the free trial
   tier won over the paid provider the owner had just chosen.
3. **Per-task routing** (ADR 0033 §4, the Routing tab) — `{provider, model,
   fallbacks[]}` per feature, applied after placement.

Model choice has four layers of its own: an explicit model from the call
site, the route's model, the card's pin (`defaultModel`, one model for every
purpose), then a code table by purpose (`draft | analysis | multimodal |
general`) with environment overrides. Model lists are typed into the seed
(`frontend/src/lib/aiEngine/seed.js`), so a new deployment, a retired id or a
price change is a pull request, and the OpenAI card offered two models the
router would never choose. The non-text tasks — Listen & Learn speech (Gemini
TTS), the podcast voice (ElevenLabs), cover art (Replicate / Imagen) — are
configured on other pages and never appear here, so "which model does the
site use for X" has no single answer.

The owner's brief (2026-10-04) asks for: a global preference list (Priority
1, 2, 3 …) that is the default; a per-task override independent of it; no
hard-coded model names, with dropdowns populated dynamically; every modality
exposed as its own task (image generation, text-to-speech, speech-to-text,
OCR, embeddings); a recommended model per task with the reason; a "Use
recommended model" option that overrides the priority list for that task
only; and Priority 1 as the editable default.

## Purpose and decision drivers

- One precedence rule a reader can hold in their head, shown on the page as
  the effective model per task, not inferred from three controls.
- A model catalogue the providers populate, so onboarding a model is a
  refresh and a pricing row, and retiring one is visible before it fails.
- Every modality a task, so the audio and image choices live where the text
  ones do, with the same recommendation and override.
- Safety invariants that no toggle can undo: a trial tier never serves the
  anonymous public route; a provider with no key or switched off is never
  added; budgets alert and nothing here pretends they stop spend.
- Migration without a reset: today's stored order, placements and routes map
  onto the new shape; nothing an administrator chose is lost.

## Decision

### 1. Architecture

Three documents and two code tables replace the three overlapping controls.

| Piece | Where | Role |
|---|---|---|
| **Model catalogue** | `admin_config/ai-model-catalog` (Cosmos) | Every model the site may select, per provider, with capabilities, pricing, context and status. Populated by a timer from each provider's list endpoint, enriched from a code table, editable only for `hidden` and `pinnedLabel`. |
| **Task registry** | `functions/src/lib/ai/tasks.js` (code) | Every AI task the site runs, with its modality, the capability it needs, whether it is public-facing, and its recommended model with the reason. Replaces `AI_FEATURES` as the unit of configuration; the feature switches stay. |
| **Selection document** | `admin_settings/ai-routing` v2 (Cosmos) | The global priority list and the per-task mode and chain. Replaces provider `order`, per-feature placement and the v1 routes. |
| **Provider adapters** | `functions/src/lib/ai/providers/<id>.js` | Today's rows in `router.js` made explicit: how to call, how to list models, which capabilities the provider can carry, policy flags (`trialTier`, `metered`), and `recommendedByModality` — the provider's own best model per modality (`text`, `json`, `vision`, …), with a reason and an `asOf` date, reviewed like any other code table. |
| **Resolver** | `functions/src/lib/ai/select.js` | One pure function: (task, selection, catalogue, availability) → ordered chain of `{provider, model, why}`. The router calls it and nothing else decides. |

### 2. Data model

**Catalogue** (`admin_config/ai-model-catalog`):

```json
{
  "id": "ai-model-catalog",
  "refreshedAt": "2026-10-04T21:00:00Z",
  "providers": {
    "foundry": {
      "listedAt": "2026-10-04T21:00:00Z",
      "models": [
        {
          "id": "gpt-5-nano",
          "label": "GPT-5 nano",
          "capabilities": ["text", "json", "vision"],
          "context": 400000,
          "pricing": { "input": 0.05, "output": 0.40, "unit": "1M tokens", "asOf": "2026-10-04" },
          "status": "live",
          "source": "api",
          "firstSeen": "2026-10-04",
          "lastSeen": "2026-10-04",
          "hidden": false
        }
      ]
    }
  }
}
```

`status` is `live | retired | unknown`: `retired` when a model the catalogue
knew is absent from two consecutive *successful* refreshes, `unknown` only
for a model never confirmed by a provider list (a manual entry awaiting its
first refresh). A refresh that fails changes no model's status: each
provider carries `refresh: { lastOk, lastAttempt, lastError }`, the page
shows the age from `lastOk`, and a model whose provider's `lastOk` is older
than two refresh periods is treated as `stale` — still eligible, badged on
the page, never recommended until the next successful refresh.
`capabilities` come from the enrichment table keyed by id pattern, never from
the provider's free text; a model with no row is `["text"]` and **unpriced**,
and an unpriced model is selectable only by explicit choice, never by
recommendation. The weekly probe (`probeAiProviders`) already runs the
Test per provider; it gains the list step.

**Task registry** (code, `tasks.js`):

```js
forgeDrafting: {
  label: 'Forge drafting',
  modality: 'text',             // text | json | vision | image | tts | stt | ocr | embedding
  needs: ['text'],              // capabilities a model must carry
  public: false,                // true for the anonymous explain route
  recommended: {
    provider: 'foundry', model: 'gpt-5-mini',
    reason: 'Quality: reads a whole brief; cost: $0.25/$2.00 per 1M tokens; latency: 2–6 s measured by the weekly probe',
    asOf: '2026-10-04',
  },
}
```

Every call site names a task (the existing `ai-call-sites.test.js` keeps
that honest). The non-text paths — `listenAndLearnSpeech` (tts),
`podcastVoice` (tts), `coverArt` (image), `recordingTranscript` (stt),
`pageOcr` (ocr), `embeddings` (embedding) — become tasks with their own
`needs`, and their current settings pages read the selection document
instead of their own fields.

**Selection** (`admin_settings/ai-routing`, version 2):

```json
{
  "id": "ai-routing",
  "version": 2,
  "global": {
    "priority": [
      { "provider": "foundry", "model": null },
      { "provider": "gemini",  "model": null },
      { "provider": "anthropic", "model": null }
    ]
  },
  "tasks": {
    "forgeDrafting": { "mode": "recommended" },
    "inspector":     { "mode": "global", "exclude": ["nvidia"] },
    "podcastVoice":  { "mode": "custom", "chain": [{ "provider": "elevenlabs", "model": "eleven_v3" }], "thenGlobal": false },
    "pricingExplain": { "mode": "global" }
  },
  "updatedAt": "2026-10-04T21:05:00Z",
  "updatedBy": "owner"
}
```

`global.priority` is the editable Priority 1, 2, 3 … list; a `model` of
`null` means "that provider's recommended model for the task's modality",
read from the adapter's `recommendedByModality` table (code, reviewed, with
a reason and an `asOf` date per entry, refreshed in the same pull request as
a pricing row), so one list serves text and vision alike. A provider whose
table has no entry for the task's modality is skipped for that task and the
page says so; the owner can always name a concrete model in the list
instead. A task's `mode` is
`recommended | global | custom`; `chain` exists only for `custom`;
`thenGlobal` says whether the global list follows the chain (default true,
so a custom chain can never leave a task with fewer options than the list).
`exclude` lists providers that never serve this task whatever the mode or
the global list says — the administrator's "off" for one task, kept apart
from the code-level locks, which no document can lift.

### 3. Precedence

For one call, in order, and the first rule that yields a model wins:

1. **Explicit model from code** (a call site that passes `model`) — rare,
   and recorded in usage as `explicit`.
2. **Task mode `recommended`** → the registry's recommended model, if it is
   `live`, its provider is enabled and keyed, and it carries `needs`.
   Otherwise fall through to 3 and flag the task on the page.
3. **Task mode `custom`** → the chain in order, then the global list if
   `thenGlobal`.
4. **Task mode `global`** (the default for every task) → the global priority
   list, Priority 1 first.
5. **Always, applied to every candidate:** the provider is enabled and holds
   a key (or endpoint); the provider is not in the task's `exclude` list;
   the model is `live` or `stale` (below) and carries `needs`; and the
   policy locks hold — a `trialTier` provider never serves a `public: true`
   task, `sourceGrounding` is Gemini-only — so no document can place a
   provider where code forbids it. The page shows a locked candidate as
   "not eligible: trial tier on a public route" rather than hiding it.
6. **Failover** is unchanged: a candidate that fails for its own reasons
   hands on to the next; a bad request does not, except for the catalogue
   providers whose 400s are their own (NVIDIA).

A model pinned on a provider card today becomes that provider's `model` in
the global list; the card loses its dropdown.

### 4. UI

**AI Services tab** keeps the provider cards (key state, Test, latency,
switch) and gains one list above them: **Priority** — a drag list of
providers, each row showing the model the list will use for text and for
vision ("Foundry · gpt-5-nano / gpt-5-mini"), a "P1 — default" badge on the
first, and a model dropdown per row fed by the catalogue (filtered to that
provider, `live`, not hidden). No per-feature placements here.

**Tasks tab** (the Routing tab renamed) is a table, one row per task:

| Task | Modality | Mode | Effective model | Recommended |
|---|---|---|---|---|
| Forge drafting | text | ● Recommended ○ Global (P1) ○ Custom | gpt-5-mini via Foundry | gpt-5-mini via Foundry — quality, $0.25/$2.00, 2–6 s |
| Pricing explain | text, public | ○ Recommended ● Global ○ Custom | gemini-3.5-flash-lite via Gemini (Foundry: P1, not eligible on a public route) | … |
| Podcast voice | tts | ○ ○ ● Custom | eleven_v3 via ElevenLabs | … |

"Use recommended model" is the first radio. Choosing Custom expands the row:
a chain editor of (provider dropdown → model dropdown filtered by the task's
`needs`), up to four entries, a "then the Priority list" switch, and a Test
button that runs the task's prompt through the resolved chain and shows
which candidate answered and why the ones above it did not. Every row's
"Effective model" is computed by the same resolver the router uses, so the
page can never disagree with production.

**Catalogue panel** (a drawer from either tab): the models table —
provider, id, capabilities, price, status, first and last seen — with Hide,
a "refreshed 3 h ago · refresh now" line, and a banner listing retired
models that a task or the priority list still names.

### 5. Workflows

- **Set the default.** Owner drags Foundry to Priority 1 and leaves its
  model on "recommended". Every task in `global` mode now resolves to
  gpt-5-nano or gpt-5-mini by modality; the public explain route resolves to
  Gemini because Foundry is `metered`, not `trialTier` — so it is eligible
  there too; only NVIDIA is locked out. (If the owner wants the public
  route cheaper still, that task's Custom chain names Gemini first.)
- **One task on its own model.** Owner opens Forge drafting, picks
  "Recommended": gpt-5-mini via Foundry with the reason shown. The row's
  effective model updates; nothing else changes.
- **A new model appears.** The Sunday refresh lists `gpt-5.4-nano` on
  Foundry as `live`, unpriced. It shows in the dropdowns with an "unpriced"
  badge and cannot be recommended until a pricing row lands in the
  enrichment table (a one-line PR). The usage page prices calls to it at the
  provider's `default` row and marks them estimated.
- **A model retires.** Two refreshes without `gemini-2.5-pro`: status
  `retired`; the Tasks table flags the one Custom chain naming it; the
  resolver skips it at call time and falls through, so nothing breaks
  between the retirement and the edit.
- **The budget alert fires.** Cost Management's 90 % mail arrives; the
  owner switches Foundry off on its card; every task falls to the next
  eligible candidate; the Tasks table shows the new effective models at a
  glance. (A budget alerts; it does not stop spend. Automatic demotion on a
  budget signal is a later decision, listed under revisit triggers.)

### 6. Edge cases and validation

- A `custom` chain with no eligible candidate and `thenGlobal: false` is
  rejected on save ("this task would have no model"); on read, the resolver
  treats it as `global` and flags it.
- Duplicate providers in a chain are collapsed to the first; a provider the
  router does not implement is dropped on save (today's `normalizeRoute`
  rule).
- A task whose `needs` no enabled provider can carry (for example `vision`
  with only NVIDIA keyed) shows "no eligible model" and the call fails with
  `AI_NOT_CONFIGURED` naming the capability, not a 500.
- `recommended` pointing at a retired or unpriced model falls through to
  `global` and is flagged; the registry's `asOf` makes a stale
  recommendation visible.
- Catalogue refresh failure keeps the last good list and every model's
  last-known status, records the error on the provider's `refresh` field,
  and the page shows the age; selection keeps working from the stored list,
  with `stale` models eligible but not recommended (§2).
- Concurrent edits: the selection document carries `updatedAt`, and a save
  sends the value it read; a mismatch returns 409 and the page reloads
  rather than overwriting.
- Policy locks are code, tested in both directions as the placement locks
  are today (`ai-config.test.js`): a trial-tier provider never reaches a
  public task through any document, and a document cannot enable a provider
  that holds no key.
- Migration (one-time, versioned like `PROVIDER_SCHEMA_VERSION`): provider
  `order` → `global.priority` in that order with each card's pin as its
  `model`; v1 routes → `custom` chains with `thenGlobal: true`; a placement
  of `first` → that provider prepended to the task's chain; `order` →
  nothing; `off` → the provider added to the task's `exclude` list, which
  `applyFeaturePlacement` removed it with today and the resolver's rule 5
  removes it with tomorrow (the code-level locks move to the task registry
  and need no document). Tasks not touched by any of these start in
  `global` mode.

### 7. Extensibility and model onboarding

- **A new provider** is one adapter file (call, listModels, capabilities,
  policy flags) plus a Key Vault reference or an endpoint; the catalogue,
  the resolver and the page need no change. The existing contract tests
  (`PROVIDERS` ↔ seed ↔ catalogue) extend to adapters.
- **A new model** is nothing until it has a price: the refresh lists it, the
  page shows it unpriced, and the enrichment row is the review point.
- **A new task** is one registry entry; the call site names it and
  `ai-call-sites.test.js` refuses an unnamed call, as now.
- **Recommendations** are reviewed by evidence: the weekly probe writes
  latency per model to the catalogue, and the usage page writes cost per
  task, so a recommendation's reason can cite measured numbers and the
  `asOf` date says when it was last checked.
- Model ids never appear in UI code; the seed's `models` arrays are deleted
  with the migration.

## Consequences and accepted risks

- Three controls become one list and one table; the placement concept and
  the per-provider pin go away, which is a visible change for the owner on
  a page they use often. The migration keeps every effective choice.
- A catalogue refresh is a network call per provider per week; a provider
  that lists hundreds of models (OpenAI) is filtered to chat-capable ids by
  the adapter before storage.
- The audio and image settings pages lose their own model fields to the
  Tasks table; their other settings (voices, prompt sets) stay where they
  are.
- Recommended models are a code table, so a change is a PR with a reason —
  deliberate, since a recommendation is a claim about cost and quality that
  the usage page can later contradict.
- **Amendment 2026-10-05 (slice 4, #859): a `null` model in the Priority
  list or a custom chain is the provider's default per purpose, not §2's
  modality recommendation.** §2 reads a null as "that provider's recommended
  model for the task's modality", which on a text task is the cheapest tier
  (nano on Foundry, Flash-Lite on Gemini). Applying that would have moved
  every drafting task to nano the day slice 3 merged, against the owner's
  2026-10-04 decision ("GPT-5 mini for anything that reads a whole draft or
  article, nano for short answers") and the contract the pre-ADR routing
  honoured: a step with no model took `DEFAULT_MODEL_TABLE` by the call's
  purpose (draft, analysis, multimodal, general), environment overrides
  included. So a null keeps that meaning; the resolver still judges a null
  step's *eligibility* on the modality recommendation (which is what keeps
  a vision task off a provider whose text model cannot read images) and
  reports it as `modalityModel`; and the Priority row's helper text says
  what the default resolves to for text and for vision, as the effective
  read (`GET cms/ai-routing/effective`) reports it. A task that should use
  the registry's recommendation — one model, chosen by evidence with a
  reason and a date — gets it through the Tasks tab's **Recommended** mode,
  which is the control §4 designed for exactly that. Revisit if the purpose
  table ever leaves the router; then §2's reading is one marked line in
  `select.js` (`NULL MODEL`).

- **2026-10-05 (slice 5, #860): landed; the media providers are
  keyed-is-enabled.** The audio and image tasks of §2 are rows of the
  registry and the selection document; ElevenLabs and Replicate are
  catalogue providers with no card — a key is what switches them on, there
  is no order to set and no Test to run on a card, and the catalogue drawer
  says so. Two things §2 and §3 did not say, decided here: a media task
  defaults to mode `recommended`, because the Priority list is the chat
  list and a media provider never joins it; and each media task carries
  `only`, a product rule in code no document lifts (the podcast voice is
  ElevenLabs-only, Listen & Learn speech Gemini-only, the images
  Replicate-only — ADR 0029 §2b), without which the list's Gemini step would
  have read the podcast. A media task's recommendation stands while the
  catalogue has not yet confirmed it (`unknown`, never `retired`): it has no
  list behind it, and the week between a deploy and the next refresh must
  not be a week of silence; a chat task keeps §3's strict reading. The
  per-task Test of a media task is a dry run that spends nothing. The
  settings pages lost their model fields as the consequences section says;
  `recordingTranscript`, `pageOcr` and `embeddings` are registered as planned
  with no provider, shown as "no eligible model".
## Alternatives considered

- **Keep the three mechanisms and document the tie-break.** Rejected: the
  owner's confusion was the symptom of the design, not of the docs.
- **Store recommendations in Cosmos, editable on the page.** Rejected for
  now: a recommendation without a reason the repository can review drifts
  into a second priority list.
- **A fully dynamic catalogue with pricing scraped from provider pages.**
  Rejected: prices are not published in a stable machine-readable form by
  every provider, and a wrong price silently misstates spend; a reviewed
  enrichment row is cheaper than a wrong number.

## Validation and revisit triggers

- Done when the Tasks table's effective model for every task equals what
  the router chose for the last call to that task (a contract test runs the
  resolver against recorded usage rows), the migration preserves every
  stored choice (a fixture from the 2026-10-04 documents), and the public
  route cannot be given a trial-tier provider by any document.
- Revisit if budgets gain a signal the router can act on (automatic
  demotion), if a provider exposes pricing by API, or if the owner wants
  recommendations editable on the page.

## Related decisions and references

- ADR 0013 (AI provider strategy), ADR 0033 §4 (per-task routing, the v1
  of the selection document).
- #701 (NVIDIA, per-feature placement), #849 and #850 (Foundry, the second
  per-feature provider and the screenshots that prompted this record).
- Implementation slices, in dependency order: #856, #857, #858, #859, #860.
- `functions/src/lib/ai/router.js`, `ai-config.js`, `features-catalogue.js`,
  `routing-table.js`, `select.js`; `frontend/src/lib/aiEngine/seed.js`,
  `frontend/src/components/admin/ai-engine/TasksTab.jsx` and
  `PriorityList.jsx` (the Routing tab until slice 4).
