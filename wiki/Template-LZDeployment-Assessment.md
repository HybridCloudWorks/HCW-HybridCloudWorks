# Template-LZDeployment — pre-flight risk assessment

**Date**: 2026-08-30 · **Status**: assessment only — no change was made to
either repository
**Question asked**: *if the [Template-LZDeployment](https://github.com/HybridCloudWorks/Template-LZDeployment)
landing-zone factory were run beside `HCW-HybridCloudWorks`, against the same
tenant and the same subscriptions, would the deployment succeed?*

**Short answer: not on a first run, and a first run should not be attempted
against the live HCW tenant without the pre-flight work in §6.** Two findings
are hard blockers (§1), five are material risks to the running site (§2), and
one is a standing cost exposure roughly six times the platform's entire monthly
budget (§3).

Every finding below was read out of the two repositories and out of the pinned
upstream Azure Landing Zones library at its exact ref. Nothing was executed:
no `az`, no `terraform`, no discovery run, no plan. Each item therefore carries
a confidence marker:

| Marker | Meaning |
| --- | --- |
| **Confirmed** | Read directly from a file in one of the three sources; cited by path |
| **Likely** | Follows from what was read, but the exact runtime behaviour depends on a provider version this assessment could not execute |
| **Verify** | Cannot be settled from source at all — depends on live tenant, billing, or GitHub-plan state |

Sources read: `HCW-HybridCloudWorks@43baa46` · `Template-LZDeployment@main`
(factory 0.11.0) · `Azure/Azure-Landing-Zones-Library@platform/alz/2026.04.2`
(the ref the factory pins).

---

## Verdict summary

| # | Finding | Severity | Confidence |
| --- | --- | --- | --- |
| 1.1 | 13 of the 14 policy default values the pinned ALZ library declares are never supplied by the emitted `global` layer | **Blocker** | Confirmed (behaviour: Likely) |
| 1.2 | The factory has never completed a live run — all five of its own release gates are `false` | **Blocker** | Confirmed |
| 2.1 | Placing the HCW subscriptions moves them into a new management-group hierarchy and inherits 70 policy assignments | High | Confirmed |
| 2.2 | `Enable-DDoS-VNET` is enforced, is a `Modify` effect, and carries a placeholder DDoS plan ID | High | Confirmed |
| 2.3 | Default hub address space `10.0.0.0/16` is *exactly* HCW's existing hub | High | Confirmed |
| 2.4 | Bootstrap needs Entra Application Administrator — the rights `infra/oidc.tf` was deliberately designed to avoid needing | High | Confirmed (rights held: Verify) |
| 2.5 | Second Log Analytics workspace and DINE diagnostic settings land beside HCW's own | Medium | Confirmed |
| 3.1 | Azure Firewall is hard-wired on with no way to disable it; Bastion defaults on | **Cost** | Confirmed |
| 4.1 | Management-group IDs cannot match the `mg-hcw-*` scheme the Naming Convention declares immutable | Medium | Confirmed |
| 4.2 | `sandbox_management_group_id` default is `sandboxes`; the pinned library defines `sandbox` | Medium | Confirmed |
| 4.3 | The workload subscription lands directly under `landingzones`, not under `Online` | Medium | Confirmed |
| 4.4 | The wizard's whole `security.*` and `governance.*` answer set is recorded but never deployed | Medium | Confirmed |
| 4.5 | Tag key vocabularies do not match between the two repositories | Low | Confirmed |
| 4.6 | Subscription vending requires EA or MCA billing | Medium | Verify |
| 4.7 | Two independent state systems — HCP Terraform here, `azurerm` blob there | Low | Confirmed |
| 5.1 | Brownfield exclusion cannot be used for the subscriptions that fill required slots | Medium | Confirmed |

---

## 1. Blockers — a first run is expected to fail

### 1.1 The ALZ policy default values are almost entirely unsupplied

**Confirmed.** The pinned library declares 14 policy default values in
`platform/alz/alz_policy_default_values.json` at ref `platform/alz/2026.04.2`:

```
private_dns_zone_subscription_id        private_dns_zone_resource_group_name
private_dns_zone_region                 ama_user_assigned_managed_identity_id
ama_user_assigned_managed_identity_name ama_vm_insights_data_collection_rule_id
ama_mdfc_sql_data_collection_rule_id    ama_change_tracking_data_collection_rule_id
ddos_protection_plan_id                 log_analytics_workspace_id
resource_group_location                 resource_group_name_service_health_alerts
resource_group_name_mdfc                email_security_contact
```

The emitted `global` layer supplies exactly **one** of them —
`log_analytics_workspace_id` — in
`factory/templates/terraform/live/global/main.tf.tmpl`:

```hcl
policy_default_values = {
  log_analytics_workspace_id = jsonencode({
    value = data.terraform_remote_state.management.outputs.log_analytics_workspace_id
  })
}
```

There is no other `policy_default_values` entry anywhere in the corpus, and
`factory/renderer/variable-map.json` confirms it: the `global` layer maps
seventeen variables, none of which is a policy default value. No wizard
question feeds one.

**Likely — two possible runtime outcomes, both failures:**

- The `Azure/alz` provider errors at plan time on the unsupplied names, and
  `terraform plan` on the `global` layer never completes. This is the outcome
  to expect first.
- Or the provider falls back to the literal placeholder values that sit in the
  library's own assignment files — which are placeholders in the most literal
  sense. `Deploy-MDFC-Config-H224` ships
  `emailSecurityContact = "security_contact@replace_me"` and
  `logAnalytics = "/subscriptions/00000000-0000-0000-0000-000000000000/resourcegroups/placeholder/…"`.
  `Enable-DDoS-VNET` ships a `ddosPlan` value pointing at the same all-zeroes
  subscription. Policy assignments created from those either fail ARM
  validation or, worse, are accepted and then misbehave at remediation time
  (see §2.2).

**This is the single most likely reason a first `terraform plan` on the
`global` layer fails.** It is also cheap to settle: render a config, then run
`terraform plan` on `terraform/live/global` and read the first error.

### 1.2 The factory has never completed a live run — by its own record

**Confirmed.** `factory-version.json` in the template repo declares
`"status": "pre-release"` and five release gates, **all five false**:

```json
"releaseGates": {
  "schemaVariableDriftCheckPasses": false,
  "endToEndGenerationProofPasses": false,
  "oidcTokenExchangeVerifiedLive": false,
  "avmPinsVerifiedByInit": false,
  "siteMakesZeroNetworkRequests": false
}
```

`avmPinsVerifiedByInit: false` means no one has run `terraform init` against
the four pinned AVM module versions and the pinned library ref. Those pins are
a "verified snapshot of 2026-08" by the file's own comment, not an executed
result.

`docs/USER-CHECKLIST.md` says the same thing in prose for every stage: *"Stage
13 … implemented without executing a render, Terraform plan/apply, Azure login,
OIDC exchange, or state operation."* `REVIEW.md` §3 and §4 are open, and the
template's own README lists first under Known Issues: *"CI/CD pipeline has no
recorded successful run yet."*

Running this against the tenant that hosts the live site would be the
template's first end-to-end execution anywhere. That is a reasonable thing to
do — in a throwaway tenant.

---

## 2. Risk to the running HCW estate

### 2.1 Subscription placement moves the estate under 70 policy assignments

**Confirmed.** The emitted `global` layer's `subscription_placement` block
takes each supplied subscription ID and places it under a management group
(`factory/templates/terraform/live/global/main.tf.tmpl`). The four HCW
subscriptions are the only ones that exist, so they are what would be
supplied.

Read from the pinned library at `platform/alz/2026.04.2`, the archetypes carry:

| Management group | Archetype | Policy assignments |
| --- | --- | --- |
| `alz` (root) | `root` | **17** |
| `landingzones` | `landing_zones` | **53** |
| `platform` → `management` | `management` | 0 |
| `platform` → `connectivity` | `connectivity` | 1 (`Enable-DDoS-VNET`) |
| `platform` → `identity` | `identity` | 0 |
| `landingzones` → `corp` | `corp` | 5 |
| `landingzones` → `online` | `online` | 0 |

`sub-app-site-prod-cus` would land under `landingzones` and inherit **70**
assignments (17 root + 53 landing-zone).

**Materially better news than that number suggests**, and it should be said
plainly: most of the aggressive ones are shipped disarmed. Spot-checked at the
pinned ref:

- `Enforce-GR-Storage0` — `enforcementMode: DoNotEnforce`
- `Enforce-Subnet-Private` — `enforcementMode: DoNotEnforce`, effect `Audit`
- `Deploy-MDFC-Config-H224` — enforced, but **every** Defender plan parameter
  defaults to `Disabled` (all 12 checked), so it costs nothing at defaults

The `Enforce-GR-*` family (Storage, KeyVault, CosmosDb, Network, AppServices,
OpenAI and ~15 others) is the part that would otherwise deny HCW's
public-endpoint-plus-firewall posture on Cosmos, Storage and Key Vault, and it
is off. **Verify** that on the actual assignments after apply rather than
trusting this table — the library ships defaults, and the module's
`policy_assignments_to_modify` input can change them, though the template
exposes no way to.

The genuine exposure is second-order: the estate becomes governed by a policy
set nobody in this repository chose, whose enforcement modes change on every
library bump, and there is no in-repo control over them (see §4.4).

**Note for later**: HCW's own `wiki/Naming-Convention.md` puts HCWSite under
`mg-hcw-landingzones-online`. The `corp` archetype — which the wiki assigns to
routed workloads — carries `Deny-Public-Endpoints`, `Deny-Public-IP-On-NIC`
and `Deny-HybridNetworking`. If the subscription is ever moved to Corp, those
three would break the static-first architecture immediately. `Online` carries
zero assignments and is the correct target, which is what the wiki already
says.

### 2.2 `Enable-DDoS-VNET` is enforced, is a `Modify`, and has a placeholder plan

**Confirmed** from the assignment at the pinned ref:

```
enforcementMode: Default            ← enforced, not DoNotEnforce
effect:          Modify
ddosPlan:        /subscriptions/00000000-0000-0000-0000-000000000000/
                 resourceGroups/placeholder/providers/Microsoft.Network/ddosProtectionPlans/…
```

It is assigned to **both** the `landing_zones` and the `connectivity`
archetypes, so it would cover HCW's spoke VNet *and* the existing hub VNet.
`ddos_protection_plan_id` is one of the 13 unsupplied defaults from §1.1.

A `Modify` policy attempts to write `ddosProtectionPlan` onto virtual networks
at create/update. Pointed at a resource ID in a subscription that does not
exist, the remediation cannot succeed. The realistic failure is that the next
`terraform apply` from `infra/` — any change touching
`azurerm_virtual_network.hcw` or `azurerm_virtual_network.hub` — starts
failing or drifting.

Supplying a real `ddos_protection_plan_id` is not a fix either: DDoS Network
Protection is roughly **$2,944/month**, about twenty times the whole platform
budget. The correct handling is to override this assignment's effect to
`Disabled`, which the emitted layer provides no mechanism to do.

### 2.3 The default hub address space collides exactly with the existing hub

**Confirmed.** Both sides:

| | Value | Source |
| --- | --- | --- |
| HCW existing hub VNet | `10.0.0.0/16` | `infra/variables.tf` — `hub_address_space` default |
| Factory wizard default | `10.0.0.0/16` | `site/app.js` — `primaryHubAddressSpace` |

The new ALZ hub would be created in the connectivity subscription
(`sub-plat-conn-prod-cus`), which is where `vnet-plat-hub-prod-cus-01` already
lives. Two VNets with identical address space in one subscription is legal in
Azure and will apply cleanly — and then can never be peered, to each other or
to any common spoke. HCW's existing `peer-hub-to-site` / `peer-site-to-hub`
pair in `infra/hub.tf` would stay bound to the old hub, leaving two disjoint
hubs.

The factory's connectivity layer also carves `AzureFirewallSubnet`,
`AzureBastionSubnet` and `GatewaySubnet` out of the front of that space
(`cidrsubnet` calls in `platform-connectivity/main.tf.tmpl`) — the same ranges
`infra/hub.tf` documents as deliberately reserved-but-uncreated. This is the
one finding where the two repositories are visibly describing the same intent
from opposite ends.

Change the wizard answer, or expect a permanently un-peerable second hub.

### 2.4 Bootstrap needs Entra rights this estate was designed not to need

**Confirmed** in the template: `docs/runbooks/go-live-opening.md` line 133 —
*"Rights needed on the confirmed tenant: **Entra application administrator**
(app registrations + federated credentials) and **management-group root**."*
`factory/bootstrap/LZFactory.Bootstrap.psm1` carries
`Get-LzEntraApplication` / `Set-LzFederatedCredential` / `Set-LzRoleAssignment`
and assigns `Management Group Contributor` + `Resource Policy Contributor` at
the configured root.

**Confirmed** in HCW: `infra/oidc.tf` opens with a header explaining, at
length, why it uses a user-assigned managed identity instead of an app
registration —

> *"That requires directory permissions in Entra ID — Application Administrator
> or the tenant's 'users may register applications' setting. Azure **Owner**
> does not grant it… everything here is creatable by an Azure Owner with no
> Entra role at all, which matches the permissions this deployment is expected
> to run under."*

That is a designed-around constraint, written down because it bit before. The
factory requires precisely the rights that note says are not held, plus write
at the tenant root management group (needed unless `managementGroups.rootId`
names an existing intermediate MG — the schema's own escape hatch, "assumption
A7").

**Verify** whether those rights are actually available today. If they are not,
bootstrap stops at readiness checks R01/R02/R03 before anything is created —
which is the safe failure, and is the factory behaving correctly.

### 2.5 A second Log Analytics workspace, and diagnostic settings from policy

**Confirmed.** The `platform-management` layer deploys
`avm-ptn-alz-management` 0.9.0, creating
`log-<org>-management-<region>` plus an Automation Account in
`rg-<org>-management-<region>` — in the **management subscription**, which is
`sub-plat-mgmt-prod-cus`, where HCW already runs
`log-plat-prod-cus-001` in `rg-mgmt-plat-prod-cus`.

No name collision (different names, different resource groups), so this
applies cleanly. The consequences are quieter:

- **Two workspaces, two bills.** HCW's has a deliberate `daily_quota_gb = 0.25`
  cost ceiling (`infra/main.tf`, T-505). The new one has none — its retention
  comes from the wizard's `observability.logAnalytics.retentionDays` and
  nothing caps ingestion.
- **DINE diagnostic settings.** The `root` archetype assigns
  `Deploy-AzActivity-Log`, `Deploy-Diag-LogsCat` and `Deploy-ASC-Monitoring`.
  These create diagnostic settings on resources in scope, pointed at the ALZ
  workspace. HCW manages its own named settings (`diag-kv-to-logs`,
  `diag-cosmos-to-logs`, `diag-content-blob-to-logs` in
  `infra/observability.tf`). Azure permits multiple settings per resource with
  distinct names, so this is duplication and double ingestion rather than a
  conflict — but it is unbudgeted duplication, and a `terraform plan` from
  `infra/` will not show it.

HCW's own `wiki/Deployment-Runbook.md` §7 step 5 already prescribes the right
answer here: *"Re-point diagnostics … additive diagnostic settings, not
replacement of the local workspace."*

---

## 3. Cost

### 3.1 Azure Firewall cannot be turned off

**Confirmed**, and this is the finding most likely to be missed, because the
wizard makes it look like a choice. `factory/renderer/variable-map.json`:

```json
"firewall_enabled": "literal:true",
```

with the comment *"Firewall type narrowed to Azure Firewall by ADR 0017 — the
AVM connectivity patterns deploy Azure Firewall, so `firewall_enabled` maps to
`literal:true` and the wizard's tier answer flows through."* The wizard asks
which **tier**; it never asks **whether**. Selecting
`connectivity.model: "none"` skips the layer entirely, but any hub-and-spoke
or Virtual WAN render deploys a firewall.

Approximate list prices, **all estimates to confirm against the Azure pricing
calculator for `centralus` before committing**:

| Resource | Trigger | Approx. USD/month |
| --- | --- | --- |
| Azure Firewall Standard | forced on, 3 zones (wizard default) | ~$900–950 + data |
| Azure Firewall Premium | if tier = Premium | ~$1,800–1,900 + data |
| Azure Bastion Standard | `bastion.enabled: true` — **wizard default** | ~$140 |
| DDoS Network Protection | only if §2.2 is "fixed" with a real plan | ~$2,944 |
| Automation Account + 2nd LAW | management layer | tens, usage-dependent |

`infra/budget.tf` sets `budget_amount_usd = 150` for the whole platform, and
`infra/hub.tf` contains an explicit, itemised argument for why none of these
were bought:

> *"The monthly budget for this entire platform is USD 150 … so any one of
> those is between roughly one and twenty times the whole budget. More to the
> point, none of them has a job to do yet."*

Nothing in that reasoning has changed. There are still no VMs to reach through
Bastion, no on-premises network to terminate a VPN against, and the Function
App egresses through App Service's outbound addresses rather than through the
hub. A default render would spend **six to seven times the platform budget on
a firewall inspecting traffic that does not traverse it.**

Note also that the HCW budget is scoped to the *application* subscription
(`infra/budget.tf`); the firewall lands in the *connectivity* subscription, so
the existing budget alerts would not fire on it at all.

---

## 4. Contract mismatches with the documented HCW standard

### 4.1 The management-group IDs cannot be the ones the wiki declares immutable

**Confirmed.** `wiki/Naming-Convention.md` specifies the hierarchy and opens
with *"Management group **IDs are immutable** … Get these right the first
time."*:

```
mg-hcw · mg-hcw-platform · mg-hcw-platform-{identity,management,connectivity}
mg-hcw-landingzones · mg-hcw-landingzones-{corp,online}
mg-hcw-sandbox · mg-hcw-decommissioned
```

The factory cannot produce those IDs. `global/main.tf.tmpl` passes only
`architecture_name` (defaulted to `"alz"`) and `parent_resource_id`; the IDs
come from the pinned library, and at `platform/alz/2026.04.2` they are:

```
alz · platform · management · connectivity · identity · security
landingzones · corp · online · local · sandbox · decommissioned
```

Unprefixed, generic, tenant-globally unique, and immutable once created.

The wizard *does* ask for a hierarchy — `azure.managementGroups.strategy`
(`caf-standard` / `caf-minimal` / `custom`) and a full `customHierarchy` array
of `{id, displayName, parentId}`. **Neither is ever rendered into Terraform.**
`variable-map.json` maps only `azure.managementGroups.rootId`; a repository-wide
grep finds `customHierarchy` referenced only in `site/app.js` and `strategy`
only in `site/app.js` and `docs/GOVERNANCE.md.tmpl`. The answers reach the
generated documentation and stop there.

So the wizard will accept `mg-hcw-*`, print them in `GOVERNANCE.md`, and
create `alz`/`platform`/`management`/… instead. Because the IDs are immutable,
this is a one-shot mistake.

### 4.2 The sandbox management-group ID default does not exist in the library

**Confirmed.** `global/variables.tf`:

```hcl
variable "sandbox_management_group_id" {
  default = "sandboxes"
}
```

The pinned library defines the management group as **`sandbox`** (singular) —
verified against
`platform/alz/architecture_definitions/alz.alz_architecture_definition.json`
at ref `platform/alz/2026.04.2`. The other four defaults (`management`,
`connectivity`, `identity`, `landingzones`) match exactly.

If `azure.subscriptions.sandbox` is populated, placement targets a management
group that will not exist. Latent today (no sandbox subscription in the HCW
estate) and it will bite the day one is added. `REVIEW.md` §6 already tracks
`-SandboxSubscriptionId` as an open per-engagement item without noticing this.

### 4.3 The workload subscription lands one level too high

**Confirmed.** `global/variables.tf` defaults
`landing_zones_management_group_id = "landingzones"`, and both
`workload_prod_subscription_id` and `workload_nonprod_subscription_id` are
placed there in `main.tf.tmpl`. Nothing in the wizard targets `corp` or
`online`.

`wiki/Naming-Convention.md` is explicit about why that is wrong:

> *"**HCWSite belongs under `Online`, not directly under the root.** … Putting
> an application directly under the intermediate root is the most common ALZ
> deviation and it breaks the policy inheritance the two-tier split exists to
> provide."*

The factory commits exactly the deviation the wiki names. It is fixable —
the variables are operator-overridable in the generated repository — but the
generated repo's own workflow forbids hand-editing generated files, and
regeneration would revert it.

### 4.4 The security and governance answers are recorded, not deployed

**Confirmed** from `variable-map.json`, which is the authoritative list of what
each layer consumes. Across all four layers it maps subscriptions, org prefix,
regions, hub address spaces, firewall tier, the four `deploy_*` booleans,
private DNS zones, availability zones, log retention, tags, and the state
account trio. **Nothing from `security.*` or `governance.*` is mapped at all.**

So these wizard answers change nothing about the deployment:

- `governance.policyBaseline.enforcementMode` — the audit-vs-deny question,
  arguably the most consequential answer in the whole wizard
- `governance.policyBaseline.requiredTags`, `enforceAllowedLocations`,
  `enforceTlsMinimum`, `enforceNsgOnSubnets`, `enforceDiagnosticSettings`,
  `enforceEncryptionAtRest`
- `azure.allowedLocations`
- `security.defender.*`, `security.sentinel.*`, `security.nsgFlowLogs.*`,
  `security.backup.*`, `security.keyVault.*`
- `connectivity.privateEndpoints.denyPublicNetworkAccessPolicy`

Governance comes wholly from the pinned ALZ library's defaults. Guards G02 and
G03 warn about Sentinel and CMK specifically, and ADR 0017 documents the
"recorded-not-deployed" model — but `enforcementMode` gets no warning, and the
wizard gives no signal that answering `audit` versus `deny` is inert.

**Practical consequence**: to change any enforcement mode you must edit the
generated `global/main.tf` to add `policy_assignments_to_modify` — a file
headed *"GENERATED FILE. Do not hand-edit."*

### 4.5 The tag vocabularies do not match

**Confirmed.**

| HCW (`infra/variables.tf`, `var.tags`) | Factory default (`site/app.js`, `requiredTags`) |
| --- | --- |
| `workload`, `environment`, `owner`, `costCenter`, `managedBy`, `criticality`, `dataClassification` | `owner`, `application`, `environment`, `cost_center` |

`application` vs `workload`, `cost_center` vs `costCenter`. Only `owner` and
`environment` are common. Low impact today precisely because §4.4 means
`requiredTags` is never enforced — but if a tag policy is ever wired up, HCW's
entire estate is non-compliant on two of four required keys.

Guard G06 checks that `naming.defaultTags` covers `requiredTags` *within the
config*; it cannot see the existing estate.

### 4.6 Subscription vending needs EA or MCA billing

**Verify.** `scripts/New-LzSubscriptions.ps1` resolves a billing scope for
`az account alias create` and supports Enterprise Agreement (enrollment
account) or Microsoft Customer Agreement (invoice section) only. Its own
documentation:

> *"Agreement types that cannot create subscriptions programmatically (CSP,
> pay-as-you-go, sponsorship) are detected as 'no usable billing scope'."*

If HCW is on Pay-As-You-Go, CSP, or a sponsorship, `mode: "create"` is
unavailable and the fallback is `-Manual` (portal-created, IDs pasted back) or
`mode: "existing"` with the four subscriptions that already exist — which is
what leads to §2.1 and §5.1.

### 4.7 Two state systems

**Confirmed.** `infra/backend.tf` pins HCP Terraform (`organization = "hcw"`,
workspace `hcw-azure`, project `Site`). The factory emits `azurerm` blob state
only — ADR 0015, *"the only backend in the schema, wizard, and templates"* —
and the emitted `backend.tf` is a bare `terraform { backend "azurerm" {} }`
fed by `backend.hcl` at init.

Not a conflict; they are separate root modules with separate state. Worth
recording because it means two state systems, two credential paths (HCP dynamic
provider credentials via `id-hcw-terraform` versus GitHub OIDC to Entra app
registrations), and two places to look when something drifts. The
`backend.tf` header in `infra/` already warns that pointing at the wrong
workspace proposes destroying 85 unrelated resources — the same class of
mistake is available on the new side.

Minor, related: emitted layers pin `azurerm ~> 4.0` and
`required_version >= 1.12.0`; `infra/` pins `azurerm ~> 5.0` and
`required_version ~> 1.5`. Independent modules, so no direct clash, but the
operator's workstation needs Terraform ≥ 1.12 and the two halves of the estate
will be on different major provider versions.

---

## 5. Structural problem with the brownfield model

### 5.1 You cannot exclude the subscriptions you must also supply

**Confirmed.** The template's brownfield model is exclude-and-create
(ADR 0018): `deploymentStrategy.brownfield.excludedSubscriptionIds` lists
subscriptions that *"stay outside the new management-group hierarchy and are
never planned, imported, or modified."* Render guard G26 refuses to render if
an excluded ID also appears in an `azure.subscriptions` slot.

But `azure.subscriptions` **requires** `management`, `connectivity` and
`workloadProd` (schema `required` array), and guard G25 refuses to render while
a required slot is empty. The HCW tenant's four subscriptions are exactly
those three roles plus identity.

So there are two possible configurations, and no third:

1. **Supply the HCW subscriptions.** They are placed into the new hierarchy and
   everything in §2 applies. Exclusion protects nothing, because nothing is
   excluded.
2. **Exclude the HCW subscriptions.** The required slots must then be filled by
   *new* subscriptions — which needs EA/MCA billing (§4.6) and produces a
   second, parallel platform estate: a second management LAW, a second hub, a
   second connectivity subscription with a firewall in it, all beside the
   existing one, with the live site governed by none of it.

Neither is "run the landing zone next to HCW and absorb it." The template says
so directly: *"integration of existing deployments is out of scope for the
factory"* (ADR 0018), and `docs/USER-CHECKLIST.md` — *"Treat integration of
existing deployments into the landing zone as a separate engagement."*

HCW's `wiki/Deployment-Runbook.md` §7 already describes that separate
engagement, and it is the right sequence: inventory in audit mode → remediate
or exempt in-repo via PR + ADR → move the subscription → verify budget, RBAC,
OIDC and a zero-drift plan → re-point diagnostics additively. The factory
automates none of those five steps.

---

## 6. What to do before running anything

Ordered so that each step can stop the sequence cheaply.

**Settle on paper, no execution required**

1. Decide which of the two §5.1 configurations is actually wanted. If the
   answer is "absorb HCW into a landing zone", the factory is the wrong tool
   and `wiki/Deployment-Runbook.md` §7 is the right one.
2. Fix the wizard answers that are wrong by inspection: hub address space away
   from `10.0.0.0/16` (§2.3); `bastion.enabled: false` (§3.1); confirm the
   Azure Firewall tier and accept that it is unavoidable, or choose
   `connectivity.model: "none"` and keep the existing hub.
3. Accept or reject the management-group ID scheme (§4.1). These are immutable.
   If `mg-hcw-*` is a real requirement, that is a change to the factory, not a
   wizard answer.

**Prove it renders and plans, in a throwaway tenant**

4. Render a config and run `terraform plan` on `terraform/live/global`. This
   settles §1.1 — the single most likely first failure — for the cost of one
   plan. Do this before touching the HCW tenant.
5. Run `terraform init` on all three layers to settle
   `avmPinsVerifiedByInit` (§1.2). Four module pins and one library ref have
   never been fetched.
6. Confirm the sandbox MG ID (§4.2) and whether `Enable-DDoS-VNET` appears in
   the plan with a placeholder `ddosPlan` (§2.2).

**Confirm live state that cannot be read from source**

7. Whether Entra Application Administrator and management-group-root write are
   available (§2.4). Run `factory/discovery/Invoke-Discovery.ps1` — it is
   read-only by design and answers R01/R02/R03 without mutating anything.
8. The billing agreement type (§4.6).
9. Whether the HybridCloudWorks GitHub org's plan tier supports protected
   environments and branch protection on private repositories — readiness check
   R09, and required by the emitted apply workflow's `environment:` gates.
   Also note the factory's own single-owner caveat (`REVIEW.md` §2): the
   wizard defaults `branchProtection.requiredApprovals: 1`, which deadlocks
   self-merges on a solo repository.
10. Confirm `scaffold-copy` targets a **new** repository. `github.repositoryName`
    names the repo it creates and pushes to; it must not be pointed at
    `HCW-HybridCloudWorks`.

**Do not skip**

11. Run the post-render validation gate (`validate-render.ps1`) with
    `LZ_VALIDATE_STRICT=true`, and never set `LZ_SCAFFOLD_ALLOW_UNVALIDATED`.
12. Keep every plan/audit artifact. `bootstrap-plan.json`,
    `validate-report.json` and `scaffold-plan.json` are the only record of what
    a first-ever live run actually did.

---

## Evidence index

| Claim | Source |
| --- | --- |
| Policy default values declared | `Azure-Landing-Zones-Library@platform/alz/2026.04.2` → `platform/alz/alz_policy_default_values.json` |
| Only `log_analytics_workspace_id` supplied | `Template-LZDeployment` → `factory/templates/terraform/live/global/main.tf.tmpl`; `factory/renderer/variable-map.json` |
| Release gates all false | `Template-LZDeployment` → `factory-version.json` |
| MG IDs and archetype assignment counts | `…/platform/alz/architecture_definitions/alz.alz_architecture_definition.json`; `…/archetype_definitions/*.alz_archetype_definition.json` |
| `Enable-DDoS-VNET` enforced + placeholder plan | `…/policy_assignments/Enable-DDoS-VNET.alz_policy_assignment.json` |
| MDFC plans all `Disabled`; guardrails `DoNotEnforce` | `…/policy_assignments/{Deploy-MDFC-Config-H224,Enforce-GR-Storage0,Enforce-Subnet-Private}.alz_policy_assignment.json` |
| Firewall forced on | `Template-LZDeployment` → `factory/renderer/variable-map.json` (`"firewall_enabled": "literal:true"`) |
| Wizard defaults (hub CIDR, bastion, tags) | `Template-LZDeployment` → `site/app.js` |
| `sandboxes` vs `sandbox` | `Template-LZDeployment` → `factory/templates/terraform/live/global/variables.tf` vs library architecture definition |
| Entra rights required | `Template-LZDeployment` → `docs/runbooks/go-live-opening.md`; `factory/bootstrap/LZFactory.Bootstrap.psm1` |
| Entra rights deliberately avoided | `HCW-HybridCloudWorks` → `infra/oidc.tf` (header) |
| Existing hub `10.0.0.0/16`, budget $150 | `HCW-HybridCloudWorks` → `infra/variables.tf`, `infra/hub.tf`, `infra/budget.tf` |
| Existing LAW + daily cap + diagnostics | `HCW-HybridCloudWorks` → `infra/main.tf`, `infra/observability.tf` |
| Documented MG scheme and Online placement | `HCW-HybridCloudWorks` → `wiki/Naming-Convention.md` |
| Absorption sequence | `HCW-HybridCloudWorks` → `wiki/Deployment-Runbook.md` §7; `wiki/IaC-Repository-Standard.md` ALZ-readiness checklist |
| Brownfield is exclude-and-create | `Template-LZDeployment` → `docs/decisions/0018-brownfield-exclude-and-create.md`; `docs/USER-CHECKLIST.md` |

---

*Assessment only. No file in `infra/` and no file in `Template-LZDeployment`
was modified. Nothing was executed against Azure, Entra, GitHub, or HCP
Terraform.*
