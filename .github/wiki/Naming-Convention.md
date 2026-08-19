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
| Workload token | `hcw` for platform, `hcwsite` for the application | The workload slot, not the org, for application resources |
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
| `sub-app-hcwsite-prod-scus` | `mg-hcw-landingzones-online` |

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
| Resource group | `rg-id-platform-prod-scus` |
| Key Vault | `kv-platform-id-prod` |
| Managed identity | `id-hcw-<purpose>-prod` |
| Log Analytics workspace | `log-platform-id-prod-scus` |
| Domain controller VM *(only if AD DS)* | `vmhcwdc01` |

The VM name breaks the pattern on purpose: a Windows computer name is capped
at **15 characters**, and the full scheme does not fit. Name the Azure
resource `vm-hcw-dc-prod-scus-01` and the OS computer name `vmhcwdc01`.

## Platform — Management

| Resource | Name |
| --- | --- |
| Resource group | `rg-mgmt-platform-prod-scus` |
| Log Analytics workspace *(central)* | `log-platform-prod-scus` |
| Automation account | `aa-platform-prod-scus` |
| Recovery Services vault | `rsv-platform-prod-scus` |
| Storage account *(archive/logs)* | `stplatformprodscus` |
| Data collection rule | `dcr-platform-vminsights-prod` |
| Action group | `ag-platform-prod-scus` |

`log-platform-prod-scus` is the workspace Runbook §7 step 5 re-points
diagnostics to. Additive — it does not replace the workload's local workspace.

## Platform — Connectivity

| Resource | Name |
| --- | --- |
| Resource group | `rg-conn-hub-prod-scus` |
| Hub virtual network | `vnet-hcw-hub-prod-scus` |
| Azure Firewall | `afw-hcw-hub-prod-scus` |
| Firewall policy | `afwp-hcw-prod-scus` |
| Public IP (firewall) | `pip-hcw-afw-prod-scus` |
| Bastion | `bas-hcw-hub-prod-scus` |
| Public IP (bastion) | `pip-hcw-bas-prod-scus` |
| VPN gateway | `vgw-hcw-hub-prod-scus` |
| ExpressRoute gateway | `ergw-hcw-hub-prod-scus` |
| Route table | `rt-hcw-spoke-prod-scus` |
| Network security group | `nsg-hcw-<subnet>-prod-scus` |
| DDoS protection plan | `ddos-hcw-prod-scus` |

**Two categories here cannot be named by this scheme.**

*Reserved subnet names.* Azure requires these exact strings — a prefixed name
makes the service undeployable:

`GatewaySubnet` · `AzureFirewallSubnet` · `AzureFirewallManagementSubnet` ·
`AzureBastionSubnet` · `RouteServerSubnet`

Every other subnet takes `snet-hcw-<purpose>-prod-scus`.

*Private DNS zones.* The name **is** the resolution target and is dictated by
the service: `privatelink.documents.azure.com`,
`privatelink.vaultcore.azure.net`, `privatelink.blob.core.windows.net`. Never
prefix them.

## Application landing zone — HCWSite

Subscription `sub-app-hcwsite-prod-scus`, under `mg-hcw-landingzones-online`.

Four resource groups, drawn on destroy semantics rather than on the number of
categories in play. The `web` group is redeployable; the other three hold
things whose deletion is a decision.

| Resource group | Segment rationale | Contents |
| --- | --- | --- |
| `rg-web-hcwsite-prod-scus` | Web & Mobile | Static Web App, Function App, App Service plan, Application Insights, the Function App's managed identity |
| `rg-db-hcwsite-prod-scus` | Databases | Cosmos account, SQL database, containers — `prevent_destroy` |
| `rg-sec-hcwsite-prod-scus` | Security | Key Vault, and the storage accounts whose contents outlive a redeploy — `prevent_destroy` |
| `rg-conn-hcwsite-prod-scus` | Networking | Spoke VNet, Functions integration subnet, NSG, route table |

| Resource | Name | Global? |
| --- | --- | --- |
| Spoke virtual network | `vnet-hcwsite-prod-scus` | |
| Subnet (Functions integration) | `snet-hcwsite-func-prod` | |
| Static Web App | `stapp-hcwsite-prod-scus` | |
| Function App | `func-hcwsite-prod-scus` | ✔ |
| App Service plan | `asp-hcwsite-prod-scus` | |
| Cosmos DB account | `cosmos-hcwsite-prod` | ✔ |
| Key Vault | `kv-hcwsite-prod-scus` | ✔ |
| Storage account | `sthcwsiteprodscus` | ✔ |
| Application Insights | `appi-hcwsite-prod-scus` | |
| Managed identity (Function App) | `id-hcwsite-func-prod` | |
| Private endpoint (Cosmos) | `pep-hcwsite-cosmos-prod-scus` | |
| Network security group | `nsg-hcwsite-func-prod-scus` | |
| Route table | `rt-hcwsite-prod-scus` | |

There is no application Log Analytics workspace: telemetry goes to the central
one in Management (`log-platform-prod-scus`), and Application Insights is
workspace-based against it across the subscription boundary. Split the
workspace out only when a second workload onboards or app and platform logs
need different RBAC.

Azure OpenAI would take `rg-ai-hcwsite-prod-scus` on the same rule — it is a
separate category *and* holds deployed models whose recreation is not free.

The workload token is `hcwsite`, not `hcw-hcwsite`. The org token belongs in
the subscription and management-group names; repeating it per-resource inside
a subscription that is already scoped to the workload adds four characters and
no information.

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
| Storage account | 3–24, **lowercase alphanumeric only**, global | No hyphens at all — `sthcwsiteprodscus`, not `st-hcwsite-prod-scus` |
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
