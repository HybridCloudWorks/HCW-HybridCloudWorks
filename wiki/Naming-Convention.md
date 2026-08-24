# Naming convention — CAF, for the ALZ target estate

The scheme for the Azure Landing Zone the platform is expected to move under
(Deployment Runbook §7). It covers the three platform landing zones —
Identity, Management, Connectivity — and the first application landing zone,
**HCWSite**.

> **This repository does not implement any of it.** The IaC Repository Standard
> forbids creating management groups, subscription-level policy assignments,
> or deny assignments in-repo. Management groups and subscriptions here are the
> *target* an ALZ platform repository (or the ALZ accelerator) creates. What
> `infra/` owns is the resource-level naming in the HCWSite column.

## The pattern

```
<resource-abbreviation>-<workload>-<environment>-<region>[-<instance>]
```

Sourced from Microsoft CAF, *Define your naming convention* and *Abbreviation
examples for Azure resources*.

| Component | This tenant | Notes |
| --- | --- | --- |
| Organization token | `hcw` | Used in management-group IDs only. Subscriptions and resource groups drop it — they already sit inside exactly one tenant |
| Workload token | `plat` for platform resources, `site` for the application | The workload slot, not the org. Never reuse a category segment here — see the note under HCWSite |
| Environment | `prod` · `dev` · `test` · `stage` · `dr` · `sbx` | |
| Region | `cus` (centralus) | See the region table below |
| Instance | `01`, `02` | Per resource type — see "Which resources take an instance number" below. Not a judgement call per resource |

### Which resources take an instance number

The old rule here was "only when more than one of a kind exists in the same
scope." That sounds disciplined and is unworkable: it makes the name depend on
a fact that changes after the name is fixed, so the first instance is
`kv-site-prod-cus` until a second appears — at which point the first cannot be
renamed, because Azure names are immutable.

CAF answers this differently, and better: the instance number is assigned **per
resource type**, decided once, in the *Define your naming convention* example
tables. Follow those tables. Where CAF is silent, apply the instance number if
the name is **global scope** (it can be taken by an unrelated Azure customer)
or a second instance is plausible — which is the same reasoning CAF used to
build its own table.

| Takes `-01` | Does **not** take an instance number |
| --- | --- |
| Function app `func`, web app `app`, static web app `stapp` | Resource group `rg` |
| Storage account `st` (unseparated: `stsiteprodcus01`), container registry `cr` | Cosmos DB account `cosmos` |
| Virtual network `vnet`, subnet `snet`, NSG `nsg` | Route table `rt` |
| Managed identity `id`, Key Vault `kv` | Azure SQL database `sqldb`, API Management `apim`, Service Bus `sbns`/`sbq`/`sbt` |
| App Service plan `asp`, Log Analytics `log`, App Insights `appi`, action group `ag`, Container Apps `cae`/`caj` | |

Two consequences worth stating outright:

- **Storage accounts take no hyphens**, so the number runs straight on:
  `stsiteprodcus01`. CAF names this shape itself (`st<workload><###>`), so this
  is the convention followed, not abandoned.
- **Cosmos carries no instance number**, on CAF's instruction — even though its
  name is global scope and therefore *can* collide the way
  `kv-site-prod-scus` did. If that ever happens, append `-01` knowingly. That
  is different from carrying the suffix by default.

### On including the region

The live estate omits it (`hcw-functions-prod`, `rg-hybridcloudworks-prod`).
This scheme includes it, for three reasons: platform connectivity is the
component most likely to go multi-region; the ALZ-readiness checklist already
requires the region to be explicit; and the standard grandfathers existing
names ("never rename live resources to chase convention"). The result is
deliberately two schemes — legacy workload names, and region-qualified names
for everything new. Do not retrofit the old ones.

**Region abbreviations are not published by Microsoft.** They are a local
convention and must be recorded here to be a convention at all.

| Region | Abbreviation |
| --- | --- |
| southcentralus | `scus` |
| eastus | `eus` |
| eastus2 | `eus2` |
| westus2 | `wus2` |
| centralus | `cus` |
| northeurope | `neu` |
| westeurope | `weu` |

---

## Management groups

Management group **IDs are immutable** — the display name can be changed
later, the ID cannot be. Get these right the first time.

```
mg-hcw                              "HybridCloudWorks"     (intermediate root)
├── mg-hcw-platform                 "Platform"
│   ├── mg-hcw-platform-identity        "Identity"
│   ├── mg-hcw-platform-management      "Management"
│   └── mg-hcw-platform-connectivity    "Connectivity"
├── mg-hcw-landingzones             "Landing Zones"
│   ├── mg-hcw-landingzones-corp        "Corp"     (internal, hub-routed)
│   └── mg-hcw-landingzones-online      "Online"   (internet-facing)  ← HCWSite
├── mg-hcw-sandbox                  "Sandbox"
└── mg-hcw-decommissioned           "Decommissioned"
```

Three points worth stating:

- **The full path is repeated in the child IDs** (`mg-hcw-platform-identity`,
  not `mg-hcw-identity`). This matches the Microsoft ALZ accelerator defaults,
  where a flat `alz-platform-identity` shape is used. The accelerator itself
  omits the `mg-` prefix; CAF's abbreviation list specifies it. Keep `mg-` —
  it costs three characters and makes the ID self-describing in the portal,
  in policy scopes, and in Terraform addresses.
- **HCWSite belongs under `Online`, not directly under the root.** It is a
  public website with no dependency on corporate connectivity. `Corp` is for
  workloads that require routed access back to the hub. Putting an application
  directly under the intermediate root is the most common ALZ deviation and it
  breaks the policy inheritance the two-tier split exists to provide.
- **`Sandbox` and `Decommissioned` are not optional decoration.** Sandbox is
  where a subscription lives while it is exempt from production policy;
  Decommissioned is where it goes before deletion so policy still applies to
  it. Without them, both cases get solved by exempting production.

## Subscriptions

```
sub-<tier>-<function>-<environment>-<region>
```

`tier` is `plat` or `app` — it answers "is this the platform or a workload?"
before the name says anything else, which is the question that decides who
owns the subscription and what policy applies to it. The org token is dropped:
a subscription is already inside exactly one tenant, so repeating the
organization in every name buys nothing.

These four exist:

| Subscription | Management group |
| --- | --- |
| `sub-plat-ident-prod-cus` | `mg-hcw-platform-identity` |
| `sub-plat-mgmt-prod-cus` | `mg-hcw-platform-management` |
| `sub-plat-conn-prod-cus` | `mg-hcw-platform-connectivity` |
| `sub-app-site-prod-cus` | `mg-hcw-landingzones-online` |

All four names above are live as written, verified 2026-08-19 against
`az account list`. The application subscription briefly carried
`sub-app-hcwsite-prod-scus`, which embedded the org token this scheme drops;
it was renamed rather than documented as an exception, which is the right
call while a display name is still free to change.

All four were renamed from `-scus` to `-cus` on 2026-08-19, by hand in the
portal, as the last step of the centralus consolidation. Subscription display
names are editable where management-group IDs are not — which is the whole
reason this page insists on getting the IDs right the first time and treats
display names as recoverable.

The `<function>` segment uses the same category vocabulary as resource groups
below (`conn`, `mgmt`, `ident`), so one abbreviation means one thing at every
level of the hierarchy.

---

## Resource groups

```
rg-<segment>-<workload>-<environment>-<region>
```

A subscription is the blast-radius, quota and policy boundary. A **resource
group is the lifecycle and RBAC boundary** — it is what someone deletes when
they mean "remove this". `<segment>` names the Azure service category it
groups:

| Azure category | Segment | | Azure category | Segment |
| --- | --- | --- | --- | --- |
| AI + Machine Learning | `ai` | | Management & Governance | `mgmt` |
| Analytics | `log` | | Migration | `mig` |
| Compute | `comp` | | Monitor | `mon` |
| Containers | `cont` | | Networking | `conn` |
| Databases | `db` | | Security | `sec` |
| DevOps | `dev` | | Storage | `stor` |
| Hybrid + Multicloud | `hyb` | | Web & Mobile | `web` |
| Identity | `id` | | Integration | `int` |
| Internet of Things | `iot` | | | |

`conn` and `web` cover most of what this workload deploys. The rest of the
table exists so the less obvious services have a defined home rather than an
improvised one — the point is that two engineers reach the same answer for
Azure OpenAI (`ai`) or Key Vault (`sec`) without discussing it.

### Split by lifecycle, not by inventory

The segment names a group; it does not oblige you to create seventeen of them.
Two resources in the same category share a group. Two resources with different
**destroy semantics** do not, even in the same category.

That is the rule that matters, because a resource group is a deletion unit.
Anything carrying `prevent_destroy` — Cosmos, Key Vault, the storage accounts
— should not sit in the same group as things that get torn down and
redeployed, or the lifecycle protection on one blocks routine work on the
other.

---

## Platform — Identity

| Resource | Name |
| --- | --- |
| Resource group | `rg-id-plat-prod-cus` |
| Key Vault | `kv-plat-id-prod` |
| Managed identity | `id-hcw-<purpose>-prod` |
| Log Analytics workspace | `log-plat-id-prod-cus-01` |
| Domain controller VM *(only if AD DS)* | `vmhcwdc01` |

The VM name breaks the pattern on purpose: a Windows computer name is capped
at **15 characters**, and the full scheme does not fit. Name the Azure
resource `vm-hcw-dc-prod-cus-01` and the OS computer name `vmhcwdc01`.

## Platform — Management

| Resource | Name |
| --- | --- |
| Resource group | `rg-mgmt-plat-prod-cus` |
| Log Analytics workspace *(central)* | `log-plat-prod-cus-01` |
| Automation account | `aa-plat-prod-cus-01` |
| Recovery Services vault | `rsv-plat-prod-cus-01` |
| Storage account *(archive/logs)* | `stplatprodcus01` |
| Data collection rule | `dcr-plat-vminsights-prod` |
| Action group | `ag-plat-prod-cus-01` |
| Container Apps environment *(CI runner)* | `cae-plat-ci-prod-cus-01` |
| Container Apps job *(CI runner)* | `caj-plat-ci-prod-cus-01` |

`caj` is a **local** abbreviation, recorded here to be a convention at all:
CAF publishes `cae` for a Container Apps environment and `ca` for a container
app, but nothing for a Container Apps *job*.

`log-plat-prod-cus-01` is the workspace Runbook §7 step 5 re-points
diagnostics to. Additive — it does not replace the workload's local workspace.

## Platform — Connectivity

Connectivity resources take `plat` in the workload slot, like every other
platform resource: the org token appears in management-group IDs only (the
component table above), and an earlier revision of this table that embedded
`hcw` contradicted it. `plat` is the reading the Management table already
uses (`log-plat-prod-cus-01`), so it is the one that survives.

| Resource | Name |
| --- | --- |
| Resource group | `rg-conn-hub-prod-cus` |
| Hub virtual network | `vnet-plat-hub-prod-cus-01` |
| Azure Firewall | `afw-plat-hub-prod-cus-01` |
| Firewall policy | `afwp-plat-prod-cus-01` |
| Public IP (firewall) | `pip-plat-afw-prod-cus-01` |
| Bastion | `bas-plat-hub-prod-cus-01` |
| Public IP (bastion) | `pip-plat-bas-prod-cus-01` |
| VPN gateway | `vgw-plat-hub-prod-cus-01` |
| ExpressRoute gateway | `ergw-plat-hub-prod-cus-01` |
| Route table | `rt-plat-spoke-prod-cus` |
| Network security group | `nsg-plat-<subnet>-prod-cus-01` |
| DDoS protection plan | `ddos-plat-prod-cus-01` |

**Two categories here cannot be named by this scheme.**

*Reserved subnet names.* Azure requires these exact strings — a prefixed name
makes the service undeployable:

`GatewaySubnet` · `AzureFirewallSubnet` · `AzureFirewallManagementSubnet` ·
`AzureBastionSubnet` · `RouteServerSubnet`

Every other subnet takes `snet-plat-<purpose>-prod-cus-01`.

*Private DNS zones.* The name **is** the resolution target and is dictated by
the service: `privatelink.documents.azure.com`,
`privatelink.vaultcore.azure.net`, `privatelink.blob.core.windows.net`. Never
prefix them.

## Application landing zone — HCWSite

Subscription `sub-app-site-prod-cus`, under `mg-hcw-landingzones-online`.

Six resource groups, drawn on destroy semantics rather than on the number of
categories in play (the split `infra/main.tf` implements). The `web` group is
redeployable; the others hold things whose deletion is a decision.

| Resource group | Segment rationale | Contents |
| --- | --- | --- |
| `rg-web-site-prod-cus` | Web & Mobile | Static Web App, Function App, App Service plan, Application Insights, deploy identity, and the Functions host storage account, which is recreated with the app |
| `rg-db-site-prod-cus` | Databases | Cosmos account, SQL database, containers — `prevent_destroy` |
| `rg-stor-site-prod-cus` | Storage | Content storage account and its blob containers — `prevent_destroy` |
| `rg-sec-site-prod-cus` | Security | Key Vault — `prevent_destroy` |
| `rg-conn-site-prod-cus` | Networking | Spoke VNet, Functions integration subnet |
| ~~`rg-ai-site-prod-cus`~~ | AI + Machine Learning | **RETIRED 2026-08-19.** Held the Azure OpenAI account; that account was removed entirely (zero gpt-4o quota in this subscription, no consumer in the codebase). Row kept so the decision is not silently re-litigated |

| Resource | Name | Global? |
| --- | --- | --- |
| Spoke virtual network | `vnet-site-prod-cus-01` | |
| Subnet (Functions integration) | `snet-site-func-prod-cus-01` | |
| Static Web App | `stapp-site-prod-cus-01` | |
| Function App | `func-site-prod-cus-01` | ✔ |
| App Service plan | `asp-site-prod-cus-01` | |
| Cosmos DB account | `cosmos-site-prod-cus` § | ✔ |
| Key Vault | `kv-site-prod-cus-01` ‡ | ✔ |
| Storage account (content) | `stsiteprodcus01` | ✔ |
| Storage account (Functions host) | `stsitefuncprodcus01` | ✔ |
| ~~Azure OpenAI account~~ | ~~`oai-site-prod-cus`~~ | **RETIRED 2026-08-19** — model calls go to external provider APIs keyed from Key Vault |
| Application Insights | `appi-site-prod-cus-01` | |
| Managed identity (Function App) | `id-site-func-prod-cus-01` | |
| Managed identity (GitHub deploy) | `id-site-github-deploy-prod-cus-01` | |
| Private endpoint (Cosmos) | `pep-web-cosmos-prod-cus-01` | |
| Network security group | `nsg-web-func-prod-cus-01` | |
| Route table | `rt-site-prod-cus` | |

Subnets and managed identities omit the region: both are children of (or bound
to) a resource that already carries it. Everything else region-qualifies,
including Cosmos — an earlier revision listed `cosmos-site-prod`, an
unexplained exception this page no longer makes.

‡ **The instance suffix, used in earnest.** `kv-site-prod-scus` is taken by an
unrelated Azure customer — vault names are global — and it is not soft-deleted
in this tenant, so it cannot be recovered. This is precisely the case the
"Global" note below anticipates, and `-01` is the fallback: it stays on the
pattern and reads as the first of its kind. Discovered at apply time on
2026-08-19, which is the expensive way to find out; for any globally-unique
name, check availability before the first apply, not during it.

### The region exceptions are gone — and why the checks that found them are not

For a period this estate ran in `southcentralus` with two resources stranded
outside it: the Static Web App (not offered there) and Cosmos DB (no
subscription region access). Each was discovered at apply time, and each
produced a name that disagreed with its neighbours.

**Both exceptions were retired on 2026-08-19 by moving the whole estate to
`centralus`**, the nearest region that hosts every service this workload uses.
There is now one region, one abbreviation, and no resource whose name has to
explain itself.

The rule that came out of that period still stands, and applies to the next
region decision rather than this one: **name a resource for the region only
when the region is a fact about the resource, not an accident of where the
service is offered.** Cosmos earns its region token because a database's region
*is* data residency. A Static Web App's does not — the site serves from the
global edge — which is why, while the exception lasted, the right call was to
leave the Static Web App named for the estate rather than for its control
plane.

The checks below are the lasting part of this section. Picking `centralus`
required two that **disagree with each other**, and either one alone gives a
confident wrong answer:

| Check | Owner | southcentralus | southcentralus2 | centralus |
| --- | --- | --- | --- | --- |
| Resource type deployable in region | ARM | ✅ | ❌ | ✅ |
| Subscription cleared for region | Cosmos | ❌ | ✅ | ✅ |

Trusting only the second sent the first attempt to `southcentralus2`, which
ARM then rejected outright. Both must pass.

Check region and name constraints **before** the first apply, not during it:

```bash
# 1. is the resource type deployable there at all?
az provider show --namespace Microsoft.DocumentDB \
  --query "resourceTypes[?resourceType=='databaseAccounts'].locations"
# 2. is this subscription cleared for the region?
az cosmosdb locations list \
  --query "[?properties.isSubscriptionRegionAccessAllowedForRegular].name"
# 3. is the global name free?  (false = free)
az cosmosdb check-name-exists --name <name>
# and for AI, model + version availability is regional AND time-limited:
az cognitiveservices model list -l <region>
```

There is no application Log Analytics workspace: telemetry goes to the central
one in Management (`log-plat-prod-cus-01`), and Application Insights is
workspace-based against it across the subscription boundary. Split the
workspace out only when a second workload onboards or app and platform logs
need different RBAC.

Azure OpenAI *would* take `rg-ai-site-prod-cus` on the same rule — a separate
category, holding deployed models whose recreation is not free. The rule is
recorded because it is right; the group is not deployed, because Azure OpenAI
was retired on 2026-08-19.

The workload token is `site`. The org token belongs in the management-group
names; repeating it per-resource inside a subscription already scoped to one
workload adds characters and no information.

`site` rather than `web` deliberately, and the reason generalizes. **The
workload token and the category segment occupy different slots of the same
name, so they must not draw from the same vocabulary.** `web` is already the
segment for Web & Mobile, so a `web` workload produces `rg-web-web-prod-cus`
— a name that repeats a word for two unrelated reasons and teaches the reader
nothing about either. `rg-web-site-prod-cus` reads unambiguously: `web` is
the category, `site` is the workload.

The rule to carry forward: **never name a workload after an Azure service
category.** A data-processing workload called `db`, or an event pipeline
called `int`, breaks in exactly the same way.

**These are not the live names.** Today's estate is `hcw-functions-prod`,
`hcw-cosmos-prod`, `hcw-keyvault-prod`, `hcwstorageprod` in
`rg-hybridcloudworks-prod`. Renaming them is destroy-and-recreate for every
globally-unique resource in the list, which ADR 0018 already rejected. This
column applies when a resource is created, not retroactively.

---

## Constraints that override the pattern

Where a platform limit and the pattern disagree, the limit wins. These are the
ones that actually bite:

| Resource | Limit | Consequence |
| --- | --- | --- |
| Storage account | 3–24, **lowercase alphanumeric only**, global | No hyphens at all — `stsiteprodcus01`, not `st-site-prod-cus` |
| Key Vault | 3–24, alphanumeric + hyphen, must start with a letter, global | `kv-hcw-connectivity-prod-cus` is 29 — it does not fit |
| Cosmos DB | 3–44, lowercase, global | |
| Function / Web App | 2–60, global across `azurewebsites.net` | |
| Container registry | 5–50, **alphanumeric only**, global | |
| Windows computer name | **15** | Shorter than most Azure VM resource names |
| Management group ID | 1–90, **immutable** | Cannot be renamed after creation |
| Resource group | 1–90 | |
| Log Analytics workspace | 4–63 | |

"Global" means the name must be unique across all of Azure, not just this
tenant — so it can be taken by an unrelated customer, and the fallback must be
decided before deployment rather than improvised during it.

## Tags

Naming identifies; tags govern. The seven-tag contract is defined in the IaC
Repository Standard and is already the ALZ contract — `workload`,
`environment`, `owner`, `costCenter`, `managedBy`, `criticality`,
`dataClassification`. Do not fork the schema per-resource, and do not encode in
a name what a tag already carries.

The one name-versus-tag case worth calling out: `managedBy` distinguishes
`terraform` from `bootstrap-script`. `rg-mgmt-boot-prod-cus` and `id-plat-terraform-prod-cus-01`
are outside Terraform state deliberately, and that tag is the only signal of it
in the portal.
