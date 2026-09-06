# ADR 0025: The Cosmos datacenter-IP sentinel — kept, then removed

> The title said "Keeping" until 2026-08-30. The decision below recommended
> exactly that, and was then reversed by the Addendum at the end of this
> document. A reader who stopped at the heading would have taken the opposite
> conclusion, which is why the heading changed rather than the analysis.

**Status:** Accepted — decision REVERSED before ratification, see Addendum
**Decision date:** 2026-08-29
**Owners:** Workload owner

## Context

The Cosmos account's firewall carries the documented `0.0.0.0` sentinel —
"accept connections from within Azure datacenters" — enabled by default through
`var.cosmos_allow_azure_datacenter_ips`. Its effect is to admit any workload in
any Azure tenant at the network layer, leaving Entra ID as the only control.

That is a real control: `local_authentication_enabled` is false, so keys do not
work and every caller must present a token for a principal holding an explicit
data-plane role assignment. Architecture review T-718 says so itself — "the
finding is the inconsistency rather than the exposure" — and recommends applying
the T-503 per-run firewall window used on the Functions host storage account,
then setting the variable to `false`.

Scoping that recommendation found two errors in it, both of which change the
shape of the problem.

**The named workflow does not need the data plane.** T-718 says to put the
window in `heal-computed-properties`. That workflow's automatic path (push and
schedule, `--apply`) sets `computedProperties`, which is a **control-plane**
operation: an ARM `PUT` on the container resource, deliberately moved there
after the data-plane SDK call was refused with an AAD token (`oidc.tf`, run
32420399977). ARM is not gated by this firewall. Only the `--inspect` mode reads
documents, and that mode is `workflow_dispatch`-only.

**The actual consumer is not mentioned.** `publish-content-manifest.yml` queries
published articles from Cosmos daily at 06:15 UTC and commits the result. It is
the workload that keeps the sentinel open, and neither the finding nor
`variables.tf`'s description of the variable mentions it. That description —
"Required while heal-computed-properties runs on GitHub-hosted runners" — is
wrong about the path that actually runs.

## Purpose and decision drivers

- **Every available fix trades a network allowance for a write capability.**
  Microsoft's guidance is explicit: "Modifying an Azure Cosmos DB account
  requires an Azure role with at least the
  `Microsoft.DocumentDb/databaseAccounts/*/write` permission." There is no
  narrower action for the firewall. That grant also sets `disableLocalAuth` and
  `ipRules` — so the identity that can open the window for one run can re-enable
  key authentication, or reopen the firewall permanently.
- **Job isolation is the only real boundary, and a window does not respect it.**
  Separate jobs get separate runners with separate egress IPs, so a window
  opened in one job admits the wrong address. The open, the read and the close
  must share a job — which means that job holds both the account-write
  credential and the data credential, whatever identity split exists on paper.
  This is why the pattern composes on storage (where the same identity uploads
  the package) and does not compose here.
- **The Cosmos firewall is materially worse to drive than the storage one.**
  Two verified differences from T-503's window:
  - **Propagation.** Microsoft: "Firewall changes might take up to 15 minutes to
    propagate, and the firewall might behave inconsistently during this period."
    T-503's window sleeps 30 seconds.
  - **No add/remove verb.** `az storage account network-rule add/remove` accepts
    `--ip-address`. Every `az cosmosdb network-rule` variant takes `--subnet` and
    `--vnet-name` and manages **virtual network** rules only. IP rules go through
    `az cosmosdb update --ip-range-filter`, which replaces the entire list — a
    read-modify-write against a list Terraform owns, racing any concurrent apply.
- **Cost discipline is a standing requirement.** Any option that gives CI a
  stable egress IP means infrastructure that does not exist today.
- **T-728 has already removed the compounding risk.** The manifest build now runs
  as `github_reader` with Cosmos Data **Reader** and no write anywhere. The
  finding's original severity partly came from that job sharing an identity with
  deploys; that is closed independently.

## Considered options

1. **Per-run Cosmos IP window (the review's recommendation).** Add the runner IP
   to `ipRules`, read, remove it in an `always()` step, then set the variable to
   `false`. Requires `databaseAccounts/write` on a CI identity in the same job as
   the data read; up to 15 minutes of propagation on each side, with documented
   inconsistent behaviour meanwhile, on a job that runs daily; and a
   read-modify-write of a Terraform-owned list. Closes the finding.
2. **Move the manifest out of CI's reach.** A Function App timer builds the
   manifest from inside the integration subnet and writes it to a blob; the
   workflow downloads the blob. Removes CI's Cosmos data-plane need entirely and
   lets `--inspect` fall back to the existing `cosmos_admin_ip_rules` operator
   window. But the content storage account is **also** `default_action = "Deny"`,
   so the workflow needs a storage window of its own — better mechanics than
   Cosmos (30-second propagation, real add/remove verbs, T-503 precedent) at the
   price of Storage Account Contributor on an account where `oidc.tf` records
   that CI deliberately holds no data-plane access at all. Adds a timer, a
   container, a grant and a workflow rewrite.
3. **Give CI a stable egress IP and allowlist it permanently.** The estate
   already runs a Hostinger VPS. Registering it as a self-hosted runner for the
   manifest job would make one fixed IP rule sufficient, with no window at all.
   Rejected: this repository is **public**, and a self-hosted runner on a public
   repository lets a fork pull request execute code on that host — a documented
   anti-pattern that trades a network-layer finding for a remote-execution one.
4. **Keep the sentinel, record why, and fix the documentation that is wrong
   about it.**

## Decision

**Option 4**, because every option that closes the finding gives a CI identity
the power to reopen the firewall permanently or re-enable key authentication,
and it must hold that power in the same job that reads the data — which is a
worse position than the one being fixed.

The exposure being accepted is bounded and its second control is intact: reaching
this account over the network still leaves a caller needing an Entra token for a
principal with an explicit container-scoped role assignment, and key
authentication is off. What the sentinel costs is the *defence in depth* the
design intended — one layer where two were meant — and that is the honest
statement of the risk.

Three things change with this decision, none of which touch the firewall:

1. `variables.tf`'s description of `cosmos_allow_azure_datacenter_ips` is
   corrected to name `publish-content-manifest.yml`, the workload that actually
   holds it open, instead of the healer, which does not.
2. The same correction lands in the `cosmos.tf` comment block.
3. T-718 moves to **owner-gated**, pointing here, rather than sitting open
   against a recommendation now known to be wrong.

## Consequences and accepted risks

- **The finding stays open by choice, not by omission.** Any workload in any
  Azure tenant can reach this account's network endpoint. Entra ID and the
  container-scoped role assignments are what stop it, and
  `cosmos_local_auth_disabled` must stay `true` — it is now load-bearing rather
  than defence in depth, and flipping it would be a genuine exposure rather than
  a posture change.
- **Option 2 is the path if this is revisited**, and its trigger is concrete: if
  a second CI consumer of Cosmos data appears, the cost of moving the manifest
  behind the Function App stops being disproportionate. Option 1 should not be
  revisited without also revisiting the job-isolation problem, which no amount
  of identity splitting solves.
- **The 15-minute propagation figure is the published worst case**, not an
  observed one. Nobody has measured it on this account, because no window was
  ever built. If Option 2 or 1 is ever taken up, measure it before designing a
  sleep around it.
- **This ADR does not license widening anything.** `cosmos_admin_ip_rules`
  remains empty in steady state, and the populate/apply/work/empty/apply
  procedure is unchanged.

## Addendum, 2026-08-30 — the decision changed, and why

This ADR recommended accepting the sentinel. The owner asked for Alternative A
instead, and scoping it produced a third option better than either, so the
sentinel is now **removed** and `cosmos_allow_azure_datacenter_ips` defaults to
`false`. The analysis above is left standing rather than rewritten — it is the
record of what was believed at the time, and two of its claims turned out to be
incomplete.

**What the options section got wrong about Alternative A.** It priced the blob
route as "Storage Account Contributor on an account where CI deliberately holds
no data-plane access". That was true and insufficient: the storage firewall
*ignores IP rules for requests from the account's own region*, which is why
`deploy-functions.yml` flips `default_action` to `Allow` for the length of its
upload. Alternative A therefore meant a **daily automated Allow-all window on
the content storage account** — time-boxed and on a lesser resource than the
database, but structurally the same kind of exposure this ADR set out to remove.
That cost was missing from the table when the choice was made.

**What neither option considered.** App Service honours IP rules normally, and
`deploy-functions.yml` already relies on that to probe `/api/health` from a
runner without widening any standing posture. So the manifest did not need to
become a blob at all: it became an HTTP route
(`GET /api/public/content-manifest`), and the workflow opens a per-run App
Service allow rule for its own address instead of touching storage or Cosmos.

**The shape that shipped.**

- The published-corpus query moved into the Function App, which reaches Cosmos
  over the integration subnet the firewall admits by `virtual_network_rule`.
- The route serves published documents only, asserted in the query, projected to
  the `ARTICLE_FIELDS` allowlist — every field of which `public/content` already
  serves. It deliberately does **not** rate-limit, because `anonymousKey()`
  throws for a request that did not arrive through Cloudflare and a rate-limited
  route would be unreachable from the origin window.
- CI holds no Cosmos data-plane role. The window is authorized by the reader
  identity's `HCW Function Config Refresh` role — `Microsoft.Web/sites/config/Write`
  with `config/list/action` excluded, so it can open and close the window and
  cannot read app settings back.

**What this costs, stated as plainly as the acceptance was.** The estate gains a
bulk public endpoint returning the whole published corpus in one request. That
is a convenience difference rather than a confidentiality one — every field is
already published through `public/content` — but it is a real change and the
reason the workflow reaches it through the origin rather than over Cloudflare.
And `heal-computed-properties --inspect`, a dispatch-only diagnostic, now needs
an operator window through `cosmos_admin_ip_rules` like every other live-data
inspection.

**What is still true from the original analysis.** Everything in *Purpose and
decision drivers* about the Cosmos firewall itself stands: there is still no
narrower control-plane action than `databaseAccounts/*/write`, a per-run Cosmos
window still cannot be isolated from the read, and propagation there is still up
to 15 minutes. Those are the reasons Option 1 was rejected and remain reasons
not to revisit it.
