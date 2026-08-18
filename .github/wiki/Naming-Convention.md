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
| Organization token | `hcw` | Matches the live globally-unique resources (`hcw-cosmos-prod`, `hcw-functions-prod`, `hcw-keyvault-prod`) |
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
sub-<org>-<function>-<environment>
```

| Subscription | Management group |
| --- | --- |
| `sub-hcw-identity-prod` | `mg-hcw-platform-identity` |
| `sub-hcw-management-prod` | `mg-hcw-platform-management` |
| `sub-hcw-connectivity-prod` | `mg-hcw-platform-connectivity` |
| `sub-hcw-hcwsite-prod` | `mg-hcw-landingzones-online` |

---

## Platform — Identity

| Resource | Name |
| --- | --- |
| Resource group | `rg-hcw-identity-prod-scus` |
| Key Vault | `kv-hcw-identity-prod` |
| Managed identity | `id-hcw-<purpose>-prod` |
| Log Analytics workspace | `log-hcw-identity-prod-scus` |
| Domain controller VM *(only if AD DS)* | `vmhcwdc01` |

The VM name breaks the pattern on purpose: a Windows computer name is capped
at **15 characters**, and the full scheme does not fit. Name the Azure
resource `vm-hcw-dc-prod-scus-01` and the OS computer name `vmhcwdc01`.

## Platform — Management

| Resource | Name |
| --- | --- |
| Resource group | `rg-hcw-management-prod-scus` |
| Log Analytics workspace *(central)* | `log-hcw-management-prod-scus` |
| Automation account | `aa-hcw-management-prod-scus` |
| Recovery Services vault | `rsv-hcw-management-prod-scus` |
| Storage account *(archive/logs)* | `sthcwmgmtprodscus` |
| Data collection rule | `dcr-hcw-vminsights-prod` |
| Action group | `ag-hcw-platform-prod` |

`log-hcw-management-prod-scus` is the workspace Runbook §7 step 5 re-points
diagnostics to. Additive — it does not replace the workload's local workspace.

## Platform — Connectivity

| Resource | Name |
| --- | --- |
| Resource group | `rg-hcw-connectivity-prod-scus` |
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

Subscription `sub-hcw-hcwsite-prod`, under `mg-hcw-landingzones-online`.

| Resource | Name | Global? |
| --- | --- | --- |
| Resource group | `rg-hcwsite-prod-scus` | |
| Spoke virtual network | `vnet-hcwsite-prod-scus` | |
| Subnet (Functions integration) | `snet-hcwsite-func-prod` | |
| Static Web App | `stapp-hcwsite-prod-scus` | |
| Function App | `func-hcwsite-prod-scus` | ✔ |
| App Service plan | `asp-hcwsite-prod-scus` | |
| Cosmos DB account | `cosmos-hcwsite-prod` | ✔ |
| Key Vault | `kv-hcwsite-prod-scus` | ✔ |
| Storage account | `sthcwsiteprodscus` | ✔ |
| Application Insights | `appi-hcwsite-prod-scus` | |
| Log Analytics workspace | `log-hcwsite-prod-scus` | |
| Managed identity (Function App) | `id-hcwsite-func-prod` | |
| Private endpoint (Cosmos) | `pep-hcwsite-cosmos-prod-scus` | |
| Network security group | `nsg-hcwsite-func-prod-scus` | |
| Route table | `rt-hcwsite-prod-scus` | |

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
