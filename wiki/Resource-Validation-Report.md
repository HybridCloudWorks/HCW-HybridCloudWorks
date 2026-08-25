# Resource Validation Report — 2026-08-18

> **Superseded in part — annotated 2026-08-25.** This is a point-in-time record
> and is kept as written. Five of its conclusions no longer hold, and one of
> them was wrong when it was written:
>
> - **The addendum's "T-505 observability layer — Applied" verdict is wrong
>   about alert rules.** The action group, diagnostic settings, the 0.25 GB/day
>   daily cap and the 50/75/90/100-plus-forecast budget ladder all landed. **No
>   alert rule of any kind was ever created.** The Go-Live readiness review of
>   2026-08-24 found `az monitor metrics alert list`, `scheduledQueryRules`,
>   `webtests` and `activity-log alert list` all empty in both subscriptions,
>   while the workspace was simultaneously `OverQuota`. The first alert rules
>   are declared on `fix/go-live-remediation` and are not applied
>   ([ADR 0022](0022-alerting-fabric), [Alerting and support](Alerting-And-Support)).
> - **T-506 "keyless OpenAI — Applied" is superseded by removal.** The Azure
>   OpenAI account and its resource group were retired on 2026-08-19; model
>   calls go to external provider APIs keyed from Key Vault
>   ([Naming-Convention](Naming-Convention)).
> - **The plan-parity finding was dispositioned** the same day by
>   [ADR 0018](0018-as-built-plan-v02), which superseded plan v0.1 with the
>   as-built v0.2 and ratified or filed as debt every deviation in §2 below.
> - **§3 item 3 no longer stands.** Purge protection is a recorded accepted
>   risk, not a pending action ([ADR 0021](0021-key-vault-purge-protection)).
> - **§1's follow-up is answered.** The Cloudflare WAF skip rule was built,
>   applied and confirmed **inert** — Bot Fight Mode does not run on the Ruleset
>   Engine — so synthetic validation still ends at the edge, and the smoke half
>   of *Validate Deployed Surface* cannot pass from a GitHub-hosted runner. Do
>   not rebuild the skip rule expecting a different answer; see TODO **T-519**.

First execution of the resource validation pass ahead of permanent platform
deployment. Three layers were validated with the access available to an
engineering session (no Azure control plane, no HCP Terraform token):

| Layer | Method | Verdict |
| --- | --- | --- |
| External deployed surface | `validate-deployed.yml` run [#32083341003](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32083341003) from a GitHub-hosted runner | Live and TLS-healthy; **fully shielded by Cloudflare bot challenge**, which also blocks synthetic validation |
| Plan-vs-code parity | Full comparison of `.azure/infrastructure-plan.json` (v0.1-approved) against `infra/*.tf` | **~40% parity by resource count**; plan and implementation have diverged into two independently-evolved documents |
| Control plane (TFC plan, az inventory) | — | **Not validated — no credentials in this session.** See "What still needs an operator" |

## 1. External surface

- **DNS:** apex `hybridcloudworks.com` resolves (Cloudflare-proxied).
  `www.` and `api-azure.` do **NXDOMAIN** — consistent with the same-origin
  topology (REVIEW §0.1) and with `infra/main.tf` owning only the apex TXT
  and an `api-azure` CNAME that is evidently not applied or not resolving;
  the plan's `www` record exists nowhere.
- **TLS:** valid — `CN=hybridcloudworks.com`, issuer Google Trust Services
  (Cloudflare-managed), valid 2026-06-29 → 2026-09-28, auto-renewing.
- **Frontend and API:** every request from the GitHub runner — `GET /`,
  `/api/health`, `/api/public/content`, CORS preflights — returned **HTTP
  403 with a Cloudflare challenge page** (`challenges.cloudflare.com` CSP,
  `chlray` marker). Cloudflare is challenging datacenter-IP traffic before
  it reaches the Static Web App or Functions origin.

**What this proves:** the edge is up, TLS is healthy, DNS matches the
same-origin decision, and bot mitigation is aggressively on.
**What it cannot prove:** anything about the origin. The one smoke check
that "passed" (admin guards refuse anonymous callers) passed because a
Cloudflare 403 is indistinguishable from an app-level refusal — treat it as
unproven, not verified. The operator's 2026-08-14 smoke run from a
residential IP remains the only end-to-end origin evidence.

**Follow-up (human):** REVIEW §8.1 — decide whether to add a Cloudflare WAF
skip rule (secret header → bypass challenge) so `validate-deployed.yml` can
reach the origin; without it, synthetic validation ends at the edge.

## 2. Plan-vs-code parity

The approved plan (`hcw-azure-foundation-001`, v0.1-approved, 2026-07-22)
is resource-exact in intent; the Terraform implements roughly **40% of it
by resource count** and deviates most on the items that cost money or
reduce risk. Full detail is in the repository review trail; the material
findings:

### Missing from the implementation (plan says, Terraform doesn't)

- **The three-way isolation boundary** — the plan's most-repeated principle
  splits API / worker / labs into three Function Apps with their own plans,
  host storage, and App Insights. The implementation collapses all of it
  into one app, one plan, one host storage account, one shared App Insights
  — exactly the alternative the plan records rejecting.
- **The entire observability control layer** — no action group
  (`ag-hcw-ops-prod`), no diagnostic settings, no alert rules, no Log
  Analytics daily cap (plan: 0.25 GB/day). Budget alerts email a single
  address directly, at thresholds 50/80/100 instead of the approved
  50/75/90/100, with no forecast alert.
- **Plan-side identity split** — no read-only PR-plan identity; the deploy
  identity is federated to the `main` branch, not the protected
  `production` environment the plan requires.
- **Storage queues** (seven named queues incl. poison), **SWA custom
  domains** in Terraform, and the **`www` DNS record**.

### Security-posture deviations on shared resources

| Deviation | Plan | Implemented |
| --- | --- | --- |
| Cosmos network firewall | Deny public, allow Functions subnet | **No network rules at all — Cosmos answers the public internet**; this is the control ADR-0008/ADR-001 traded Private Link away *for* |
| Cosmos local (key) auth | Disabled | Enabled (ties to REVIEW §0.2's rotation question) |
| Cosmos backup | Continuous | Periodic default |
| Storage redundancy | ZRS (both accounts) | LRS (both) |
| Storage shared-key auth | Disabled | Enabled (provider default) |
| Key Vault purge protection | `true` | Variable defaulting `false` |
| Functions zone redundancy | `true` | Absent, argued against in code comments |
| Azure OpenAI | Feature-gated until capacity/filter/budget approved; keyless | Unconditionally provisioned; `primary_access_key` exported as a Terraform output; no RBAC data-plane grant |

### Implemented but never planned

71 Cosmos containers (the plan explicitly gated container design), two
hardcoded OpenAI model deployments (incl. DALL·E 3, unplanned), the HCP
Terraform backend, all RBAC assignments, and a naming scheme where **zero
resource names match the plan's CAF names**. The plan's stated
Azure-Verified-Modules requirement is unmet — no `module` blocks exist
(already tracked as TODO T-502).

### Disposition

The honest read: plan v0.1 was approved as a topology, the implementation
evolved past it with genuinely better-reasoned decisions in places (the
serverless/container-per-collection rationale, the subnet service-endpoint
fix the plan got wrong), and nobody re-versioned the plan. Continuing to
call `validate-repository-structure.ps1`'s "plan must remain approved"
check satisfied while the artifact no longer describes the system is the
kind of drift that reads as an audit finding at ALZ absorption. REVIEW §8.2
asks for the human decision: reconcile code toward plan, or supersede the
plan with an as-built v0.2 + ADRs. Engineering-tractable security deltas
are filed as TODO **T-504** (Cosmos hardening) and **T-505** (observability
control layer) regardless of that decision.

## 3. What still needs an operator

1. **Empty-plan check:** run a plan in the `hcw-azure` HCP
   Terraform workspace. Expected: empty (the standardization changes are
   plan-neutral: `lifecycle` blocks and fmt only). Anything non-empty is
   drift to investigate before any deploy.
2. **Smoke tiers 2–3** (Cosmos conditional patch; authenticated guard) —
   need `az login` / a bearer token, per the script header.
3. **Purge protection:** set the TFC variable `purge_protection_enabled =
   true` and apply before any production secret is seeded.
4. **REVIEW §8 decisions** (Cloudflare synthetic access; plan
   reconciliation) and the outstanding §0.2 (was a Cosmos key ever
   deployed?) — §0.2 gains urgency from Cosmos being network-open with key
   auth enabled (T-504).

---

## Addendum — apply verification, 2026-08-18

The operator applied the full T-503–T-506 hardening set in HCP Terraform and
ran a cold-start check. Verification state per control:

| Control | Evidence | Verdict |
| --- | --- | --- |
| T-503 host storage default-Deny (runtime + package-pull path) | Operator cold-start invocation passed after apply — the strongest available proof the VNet path serves host state and packages | **Verified** |
| T-504 Cosmos firewall — app path | Cold start healthy; app-path Cosmos reads implied but not directly probed | Applied; probe a Cosmos-backed endpoint from a browser to close |
| T-504 Cosmos firewall — GitHub-runner path (`0.0.0.0` sentinel) | **Unverifiable yet**: `heal-computed-properties` fails at Azure login because the `CLIENT_ID` / `TENANT_ID` / `SUBSCRIPTION_ID` repository variables were never set — run history shows this failure on every run predating the hardening (pre-existing provisioning gap, now CHECKLIST §7). One green heal run after setting them is the closing evidence | Applied; pending repo variables |
| T-505 observability layer | Applied with the same TFC run; alert ladder + forecast + diagnostics live per plan | Applied |
| T-506 keyless OpenAI | Account replaced with subdomain endpoint, keys off, RBAC grant live (TFC apply evidence); no runtime consumer to probe | Applied |
| External surface regression | Post-apply `validate-deployed` run [#32090414219](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/runs/32090414219): byte-identical to the pre-apply baseline — TLS/DNS green, same Cloudflare-challenge 403s (REVIEW §8.1 unchanged) | **No regression** |
| Everything else on `main` | Repository Policy, IaC Validation, CI, CodeQL all green on the latest merges | **Healthy** |

**Remaining to close the loop:** set the three OIDC repository variables (`CLIENT_ID`, `TENANT_ID`,
`SUBSCRIPTION_ID` — names per the variable naming standard) (values from the `client_id` Terraform output +
tenant + subscription) and watch one heal run go green; optionally probe a
Cosmos-backed endpoint (e.g. the public content list) from a browser; run
one more TFC plan and confirm it is empty.

*Generated by the resource validation pass, 2026-08-18. The DNS, TLS and
frontend-surface half of the external layer can be re-run any time via Actions →
Validate Deployed Surface; its smoke job cannot pass from a GitHub-hosted runner
— see the banner at the top of this page and
[Deployment Runbook](Deployment-Runbook#4-post-apply-verification) §4.*
