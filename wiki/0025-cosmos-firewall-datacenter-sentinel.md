# ADR 0025: Keeping the Cosmos datacenter-IP sentinel

**Status:** Proposed
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
