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
| Region | `scus` (southcentralus) | See the region table below |
| Instance | `01`, `02` | Only when more than one of a kind exists in the same scope |

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
| `sub-plat-ident-prod-scus` | `mg-hcw-platform-identity` |
| `sub-plat-mgmt-prod-scus` | `mg-hcw-platform-management` |
| `sub-plat-conn-prod-scus` | `mg-hcw-platform-connectivity` |
| `sub-app-site-prod-scus` | `mg-hcw-landingzones-online` |

All four names above are live as written, verified 2026-08-19 against
`az account list`. The application subscription briefly carried
`sub-app-hcwsite-prod-scus`, which embedded the org token this scheme drops;
it was renamed rather than documented as an exception, which is the right
call while a display name is still free to change.

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
| Resource group | `rg-id-plat-prod-scus` |
| Key Vault | `kv-plat-id-prod` |
| Managed identity | `id-hcw-<purpose>-prod` |
| Log Analytics workspace | `log-plat-id-prod-scus` |
| Domain controller VM *(only if AD DS)* | `vmhcwdc01` |

The VM name breaks the pattern on purpose: a Windows computer name is capped
at **15 characters**, and the full scheme does not fit. Name the Azure
resource `vm-hcw-dc-prod-scus-01` and the OS computer name `vmhcwdc01`.

## Platform — Management

| Resource | Name |
| --- | --- |
| Resource group | `rg-mgmt-plat-prod-scus` |
| Log Analytics workspace *(central)* | `log-plat-prod-scus` |
| Automation account | `aa-plat-prod-scus` |
| Recovery Services vault | `rsv-plat-prod-scus` |
| Storage account *(archive/logs)* | `stplatprodscus` |
| Data collection rule | `dcr-plat-vminsights-prod` |
| Action group | `ag-plat-prod-scus` |
| Container Apps environment *(CI runner)* | `cae-plat-ci-prod-scus` |
| Container Apps job *(CI runner)* | `caj-plat-ci-prod-scus` |

`caj` is a **local** abbreviation, recorded here to be a convention at all:
CAF publishes `cae` for a Container Apps environment and `ca` for a container
app, but nothing for a Container Apps *job*.

`log-plat-prod-scus` is the workspace Runbook §7 step 5 re-points
diagnostics to. Additive — it does not replace the workload's local workspace.

## Platform — Connectivity

Connectivity resources take `plat` in the workload slot, like every other
platform resource: the org token appears in management-group IDs only (the
component table above), and an earlier revision of this table that embedded
`hcw` contradicted it. `plat` is the reading the Management table already
uses (`log-plat-prod-scus`), so it is the one that survives.

| Resource | Name |
| --- | --- |
| Resource group | `rg-conn-hub-prod-scus` |
| Hub virtual network | `vnet-plat-hub-prod-scus` |
| Azure Firewall | `afw-plat-hub-prod-scus` |
| Firewall policy | `afwp-plat-prod-scus` |
| Public IP (firewall) | `pip-plat-afw-prod-scus` |
| Bastion | `bas-plat-hub-prod-scus` |
| Public IP (bastion) | `pip-plat-bas-prod-scus` |
| VPN gateway | `vgw-plat-hub-prod-scus` |
| ExpressRoute gateway | `ergw-plat-hub-prod-scus` |
| Route table | `rt-plat-spoke-prod-scus` |
| Network security group | `nsg-plat-<subnet>-prod-scus` |
| DDoS protection plan | `ddos-plat-prod-scus` |

**Two categories here cannot be named by this scheme.**

*Reserved subnet names.* Azure requires these exact strings — a prefixed name
makes the service undeployable:

`GatewaySubnet` · `AzureFirewallSubnet` · `AzureFirewallManagementSubnet` ·
`AzureBastionSubnet` · `RouteServerSubnet`

Every other subnet takes `snet-plat-<purpose>-prod-scus`.

*Private DNS zones.* The name **is** the resolution target and is dictated by
the service: `privatelink.documents.azure.com`,
`privatelink.vaultcore.azure.net`, `privatelink.blob.core.windows.net`. Never
prefix them.

## Application landing zone — HCWSite

Subscription `sub-app-site-prod-scus`, under `mg-hcw-landingzones-online`.

Six resource groups, drawn on destroy semantics rather than on the number of
categories in play (the split `infra/main.tf` implements). The `web` group is
redeployable; the others hold things whose deletion is a decision.

| Resource group | Segment rationale | Contents |
| --- | --- | --- |
| `rg-web-site-prod-scus` | Web & Mobile | Static Web App, Function App, App Service plan, Application Insights, deploy identity, and the Functions host storage account, which is recreated with the app |
| `rg-db-site-prod-scus` | Databases | Cosmos account, SQL database, containers — `prevent_destroy` |
| `rg-stor-site-prod-scus` | Storage | Content storage account and its blob containers — `prevent_destroy` |
| `rg-sec-site-prod-scus` | Security | Key Vault — `prevent_destroy` |
| `rg-conn-site-prod-scus` | Networking | Spoke VNet, Functions integration subnet |
| `rg-ai-site-prod-scus` | AI + Machine Learning | Azure OpenAI account and its model deployments — deployed models are not free to recreate |

| Resource | Name | Global? |
| --- | --- | --- |
| Spoke virtual network | `vnet-site-prod-scus` | |
| Subnet (Functions integration) | `snet-site-func-prod` | |
| Static Web App | `stapp-site-prod-scus` | |
| Function App | `func-site-prod-scus` | ✔ |
| App Service plan | `asp-site-prod-scus` | |
| Cosmos DB account | `cosmos-site-prod-scus` | ✔ |
| Key Vault | `kv-site-prod-scus-01` ‡ | ✔ |
| Storage account (content) | `stsiteprodscus` | ✔ |
| Storage account (Functions host) | `stsitefuncprodscus` | ✔ |
| Azure OpenAI account | `oai-site-prod-scus` | ✔ |
| Application Insights | `appi-site-prod-scus` | |
| Managed identity (Function App) | `id-site-func-prod` | |
| Managed identity (GitHub deploy) | `id-site-github-deploy-prod` | |
| Private endpoint (Cosmos) | `pep-web-cosmos-prod-scus` | |
| Network security group | `nsg-web-func-prod-scus` | |
| Route table | `rt-site-prod-scus` | |

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

**The Static Web App is the one resource that does not sit in
`azure_location`.** Static Web Apps is offered in five regions only —
`centralus`, `eastus2`, `westus2`, `westeurope`, `eastasia` — and
`southcentralus` is not among them, so `stapp-site-prod-scus` is created in
`centralus` (the nearest). The name keeps the `scus` token deliberately: it
names the estate the resource belongs to, not the control-plane region one
service happens to require. The site is served from Azure's global edge
regardless, so the region does not decide where users are served from.

There is no application Log Analytics workspace: telemetry goes to the central
one in Management (`log-plat-prod-scus`), and Application Insights is
workspace-based against it across the subscription boundary. Split the
workspace out only when a second workload onboards or app and platform logs
need different RBAC.

Azure OpenAI would take `rg-ai-site-prod-scus` on the same rule — it is a
separate category *and* holds deployed models whose recreation is not free.

The workload token is `site`. The org token belongs in the management-group
names; repeating it per-resource inside a subscription already scoped to one
workload adds characters and no information.

`site` rather than `web` deliberately, and the reason generalizes. **The
workload token and the category segment occupy different slots of the same
name, so they must not draw from the same vocabulary.** `web` is already the
segment for Web & Mobile, so a `web` workload produces `rg-web-web-prod-scus`
— a name that repeats a word for two unrelated reasons and teaches the reader
nothing about either. `rg-web-site-prod-scus` reads unambiguously: `web` is
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
| Storage account | 3–24, **lowercase alphanumeric only**, global | No hyphens at all — `stsiteprodscus`, not `st-site-prod-scus` |
| Key Vault | 3–24, alphanumeric + hyphen, must start with a letter, global | `kv-hcw-connectivity-prod-scus` is 29 — it does not fit |
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
`terraform` from `bootstrap-script`. `rg-hcw-bootstrap` and `id-hcw-terraform`
are outside Terraform state deliberately, and that tag is the only signal of it
in the portal.
