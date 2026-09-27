---
title: Build a landing zone you can read
subtitle: Management groups, policy, management and a hub — what each one is for, assembled in the Landing Zone Builder and downloaded as nine Terraform files.
date: 2026-09-27
track: how-to
part: 1 of 3
tags: [azure, terraform, iac, landing-zone]
reading: 11
---

The platform half of an Azure landing zone — the management group tree, its
policy baseline, central logging and a hub network — comes out of the Landing
Zone Builder as **411 lines of Terraform in nine files**. That is small enough
to read in one sitting, and the files are written to be read: the comments say
why each call looks the way it does, not only what it is.

This part builds it one component at a time in the
[Landing Zone Builder](https://hybridcloudworks.com/tools/landing-zone), reads
what each component is for, and downloads the zip.
[Part 2](blog-lab-02-one-container.md) initialises that zip with the network
switched off, inside one container. [Part 3](blog-lab-03-agent-explains.md)
hands it to an agent.

Nothing in this series is applied to a tenant. The builder makes no Azure call,
and the README in the zip says the files "have never been applied".

## What you'll have at the end

This build:

```landing-zone
lz=mg,policy,mgmt,hub&corp=0&online=0
```

| Component | What it is for | File | Module, pinned |
| --- | --- | --- | --- |
| Management groups | The tree every subscription is placed in. Policy assigned to a group applies to every subscription beneath it | `alz.tf` | `Azure/avm-ptn-alz/azurerm` 0.21.0 |
| Policy baseline | The `alz` architecture's assignments, enforced, with their parameters pointed at real resources | `alz.tf`, the same call | None of its own |
| Management | The Log Analytics workspace every subscription reports to, the monitoring agent's data collection rules and identity, and an Automation account | `management.tf` | `Azure/avm-ptn-alz-management/azurerm` 0.9.0 |
| Connectivity hub | One hub network holding Bastion, the Private Link DNS zones and a DNS resolver, for spokes to peer into later | `connectivity.tf` | `Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm` 0.17.5 |

Around those three files, the zip carries `terraform.tf` (Terraform
`>= 1.12, < 2.0` and six providers), `providers.tf`, `subscriptions.tf` (the
two subscriptions this build places, refused at plan time if they are the
same), `variables.tf`, `terraform.tfvars.example` and a `README.md`. One zip,
`landing-zone.zip`.

## What it costs

**Nothing, to build and read.** The builder runs in your browser, the download
is text, and there is no sign-in and no tenant anywhere in this part.

Applying it is a different number, and not one this series asks you to spend.
The zip's README names what bills every hour it exists: Azure Firewall,
Bastion, the Log Analytics workspace, and the DDoS plan if you enable one. Two
of those four are already out of this build. The firewall is a component you
leave unticked below, and `connectivity.tf` turns the DDoS plan off with its
reason written beside it:

```hcl
  # A DDoS protection plan is a fixed monthly charge; the learning build leaves it out.
  hub_and_spoke_networks_settings = {
    enabled_resources = {
      ddos_protection_plan = false
    }
  }
```

---

## Why these four

The section that matters. Every choice below names what it beat and the
constraint that decided it.

### The validated pattern's modules, not a hand-drawn approximation

The files mirror HashiCorp's validated pattern for an Azure landing zone and
call the Azure Verified Modules it uses, each pinned to the latest release the
Terraform Registry listed on 2026-09-25. Two modules you might expect are
missing on purpose.

**`avm-ptn-hubnetworking`** is archived. The builder never emits it, and a
test fails if it ever does.

**The application landing zone pattern module**,
`avm-ptn-alz-application-landing-zone-identity-and-access`, had no release on
that date; its repository was still the unfilled AVM template. A landing zone
in this builder is a subscription placement plus a spoke from the virtual
network module instead.

The constraint is the same for both. A teaching tool that emits an archived
module teaches the wrong thing, and one that calls an unreleased module cannot
be initialised at all.

### Management groups first, because everything else is placed in them

A management group is a container above subscriptions. The `alz` architecture
defines a root named `alz`, with a Platform branch for the shared services and
a Landing zones branch for the workloads, and one call to `avm-ptn-alz` creates
the whole tree:

```hcl
module "alz" {
  source  = "Azure/avm-ptn-alz/azurerm"
  version = "0.21.0"

  architecture_name  = "alz"
  location           = var.location
  parent_resource_id = coalesce(var.parent_management_group_id, data.azapi_client_config.current.tenant_id)
```

The input worth reading is `subscription_placement`, because it is how every
other component's subscription arrives in the tree:

```hcl
  subscription_placement = {
    management = {
      subscription_id       = var.management_subscription_id
      management_group_name = "management"
    }
    connectivity = {
      subscription_id       = var.connectivity_subscription_id
      management_group_name = "connectivity"
    }
  }
```

Without the tree, each subscription is an island. Every guardrail has to be
assigned again for each one, and nothing stops the next subscription from
arriving with none.

One comment in `alz.tf` saves an afternoon: `parent_resource_id` is the parent
management group's **name**, not its resource id. The module rejects a value
containing `/` and adds the `/providers/Microsoft.Management/managementGroups/`
prefix itself. The tenant root group is named after the tenant id, which is why
that is the fallback.

### Policy is a switch on the same call, not a second module

This is the one that surprises people. The `alz` architecture carries its
policy baseline with it, so **ticking Management groups alone still deploys
every assignment**. The file the builder writes for that build lists 123 of
them across the tree, each overridden to:

```hcl
enforcement_mode = "DoNotEnforce"
```

The tree arrives with the baseline present and inert. Ticking **Policy
baseline** is what supplies the parameters and lets the assignments enforce;
in the builder's own words, it "turns the architecture's assignments from
DoNotEnforce to Default".

The alternative you might reach for, a policy layer of your own on top of a
bare tree, is not on offer here: the architecture that builds the tree brings
its assignments with it, so the only choice is whether they enforce. Enforcing
needs values the tree alone cannot supply — the workspace the diagnostic
policies send to, the resource group holding the private DNS zones, a security
contact. That is why **Policy baseline needs Management**, and the builder says
so on its row: `Needs Management groups and Management.`

With Policy selected, two assignments still stay off:

```hcl
  policy_assignments_to_modify = {
    landingzones = {
      policy_assignments = {
        "Enable-DDoS-VNET" = {
          enforcement_mode = "DoNotEnforce"
        }
      }
    }
    connectivity = {
      policy_assignments = {
        "Enable-DDoS-VNET" = {
          enforcement_mode = "DoNotEnforce"
        }
      }
    }
  }
```

This build has no DDoS plan, so it has no plan id to give that assignment. The
comment above the block states the rule: an assignment whose value the build
cannot supply "is kept but not enforced, so nothing is created from a library
placeholder."

### Management before the hub, because policy needs somewhere to send logs

`management.tf` names everything in locals rather than inside the module call:

```hcl
locals {
  management_resource_group_name  = "rg-alz-management-${var.location}"
  log_analytics_workspace_name    = "law-alz-${var.location}"
  automation_account_name         = "aa-alz-${var.location}"
  ama_user_assigned_identity_name = "uami-ama"
}
```

That looks fussy until you read `alz.tf`, which builds the policy parameters
from the same names:

```hcl
    log_analytics_workspace_id = jsonencode({ value = provider::azapi::resource_group_resource_id(var.management_subscription_id, local.management_resource_group_name, "Microsoft.OperationalInsights/workspaces", [local.log_analytics_workspace_name]) })
```

The obvious alternative is to read the id from the management module's
outputs. The file's comment says why it does not: the `alz` provider needs
these values at plan time, before the workspace exists, so the id is computed
from names both files agree on. The order is then made explicit, so the
workspace exists before any assignment names it:

```hcl
  policy_assignments_dependencies = [
    module.management.data_collection_rule_ids,
    module.management.resource_id,
    module.management.user_assigned_identity_ids,
  ]
```

Without central logging, each team keeps its own workspace or none, and the
first cross-subscription incident has no single place to ask what happened.

### A hub, and no firewall in it yet

The hub holds the things that are expensive or dangerous to duplicate in every
spoke. In this build that is Bastion, the private DNS zones for Private Link, a
DNS resolver, and the gateway subnet for a future ExpressRoute or VPN
connection, with both gateways off:

```hcl
      enabled_resources = {
        firewall                              = false
        firewall_policy                       = false
        bastion                               = true
        private_dns_zones                     = true
        private_dns_resolver                  = true
        dns_resolver_policy                   = true
        virtual_network_gateway_express_route = false
        virtual_network_gateway_vpn           = false
      }
```

The firewall is its own component in the builder, but in Terraform it is not a
module: it is these first two switches turned on, plus a SKU, in the same
object. It is out of this build for a constraint you can see in the diagram:
**there are no spokes yet**. Its job is to be the default route for corp and
identity spokes. With none, it would inspect nothing and still bill by the
hour. Add it with the first corp landing zone.

### No landing zones, for now

Corp, online and identity landing zones are what a platform exists for, and
they are out of this build on purpose.

The reason is order. The tree, the policy, the logging and the hub are built
once; every landing zone after them is a subscription placed into the tree and
a spoke peered to the hub. Read the platform first and the landing zones read
as what they are: one placement and one spoke each.

It is not that part 2 cannot take them. Every spoke calls
`Azure/avm-res-network-virtualnetwork/azurerm` 0.22.2, and the lab image
carries that version beside the three pattern modules, so the builder's full
default build, with all three spokes, passes the same offline `terraform init`
and `validate` that part 2 runs on this one. Read the platform first, then
open the full build.

---

## Prerequisites

- A browser. That is everything this part needs.
- **No Azure subscription, no sign-in, no `az login`.** Nothing here reaches a
  tenant, and nothing should.
- For parts 2 and 3: Docker.

---

## The steps

### 1. Open the builder

Go to <https://hybridcloudworks.com/tools/landing-zone>. With nothing after
the path, it opens on the full landing zone: every platform component, one
corp and one online landing zone.

**Verify:** the Build panel has two groups, **Platform, built once** and
**Application landing zones, one per team**, and every box is ticked.

### 2. Take out what this build does not need

Before you untick anything, read the **Connectivity hub** row:

```text
Unticking it also removes Azure Firewall, Identity, Corp landing zone and Online landing zone.
```

That sentence is the dependency graph, printed where you need it. Leave the hub
and untick the four it names instead: **Online landing zone**, **Corp landing
zone**, **Identity** and **Azure Firewall**. Nothing depends on any of them, so
each leaves on its own.

**Verify:** the address ends `?lz=mg%2Cpolicy%2Cmgmt%2Chub&corp=0&online=0`
(`%2C` is an encoded comma). The whole build is in the URL. **Copy link**
copies it, and
<https://hybridcloudworks.com/tools/landing-zone?lz=mg,policy,mgmt,hub&corp=0&online=0>
opens the same build from anywhere.

### 3. Read each component, then test the rule

Press **Read about** on each of the four, top to bottom. The panel shows the
builder's own explanation, and under **Deployed by** the module and version:
`avm-ptn-alz` 0.21.0 for the management groups, `avm-ptn-alz-management` 0.9.0
for management, `avm-ptn-alz-connectivity-hub-and-spoke-vnet` 0.17.5 for the
hub. Policy has no module; the panel says it is configuration of the
`avm-ptn-alz` call instead.

Then run the dependency rule backwards. Untick **Management**, and **Policy
baseline** leaves with it, because it needs the workspace. Its row now reads:

```text
Needs Management groups and Management. Ticking it also adds Management.
```

Tick **Policy baseline**, and Management comes back.

**Verify:** the address is the same as at the end of step 2.

### 4. Read the files before you download them

Below the diagram, **Generated Terraform** has one tab per file. Read `alz.tf`,
then `management.tf`, then `connectivity.tf`. That is the order of the sections
above, and the order the references between the files run in.

**Verify:** the line under the tabs starts `9 files.`

### 5. Download the zip

Press **Download zip**. The browser saves `landing-zone.zip`. Unzip it into a
folder named `landing-zone`, because parts 2 and 3 work in that folder.

PowerShell:

```powershell
Expand-Archive landing-zone.zip -DestinationPath landing-zone
```

bash:

```bash
unzip landing-zone.zip -d landing-zone
```

**Verify:** the folder holds nine files, and no real subscription id is among
them. The two in `terraform.tfvars.example` are
`00000000-0000-0000-0000-000000000001` and
`00000000-0000-0000-0000-000000000002`, and the file says what they are:
"placeholders, not defaults: every one must be replaced with a real
subscription id before any plan."

---

## How to know it worked

Three checks, none of which needs a tenant.

**The card and the builder agree.** The card at the top of this post and the
builder show the same four components. The card is drawn from the build in its
own text, so they can only agree if the builds match.

**The README counts the same.** The zip's `README.md` lists four components
under "What is in this build" and eight files under "Files".

**The Policy switch, counted.** From inside the folder:

PowerShell:

```powershell
(Select-String -Path alz.tf -SimpleMatch 'enforcement_mode = "DoNotEnforce"').Count
```

bash:

```bash
grep -c 'enforcement_mode = "DoNotEnforce"' alz.tf
```

Both print `2`: the two DDoS assignments. A build with Management groups alone
prints `123`.

---

## When it doesn't work

**A box you did not untick is unticked.** Unticking a component removes
everything that needs it: Management takes Policy baseline with it, and
Connectivity hub takes the firewall and every landing zone. The row said so
before you clicked. Tick back the one you wanted, and its dependencies return
with it.

**A link you shortened opens with two landing zones in it.** `lz=` lists
platform components only. The landing zones travel as counts, and a count that
is absent is its default, which is one. So
`?lz=mg,policy,mgmt,hub` on its own opens this build **plus** one corp and one
online landing zone. It looks like the builder ignored your link; it read every
part of it. Keep `&corp=0&online=0`.

**A hand-edited link opens with more than it names.** The builder normalises
the way the page does. A component named without what it needs brings its
dependencies along, so `?lz=policy&corp=0&online=0` opens with Management
groups and Management ticked too. An unknown token is dropped, and a knob that
fails its check is its default.

**The hub address space will not change.** The field refuses anything that is
not an IPv4 range from /8 to /24 and says so beneath it: "Not applied. An
address space is an IPv4 range in CIDR form with a prefix from /8 to /24, such
as 10.0.0.0/16." A half-typed value never reaches the URL, so the build keeps
the last valid one.

**The zip does not download.** The builder builds the zip in your browser, and
when the browser cannot, it says so: "The zip could not be built in this
browser. Copy each file from its tab instead."

---

## What's next

[Part 2](blog-lab-02-one-container.md) takes this folder into the `hcw-lab`
container, runs `terraform init` with the network switched off, and reads what
the provider mirror is and why the site's lab runner cannot work without it.

## Try next: Explain this component

Open this build in the builder — the card's **Open in the Landing Zone
Builder** link carries it — press **Read about** on **Connectivity hub**, then
**Explain this component**. The builder sends the focused component, your build
and its own text about the hub to the site's AI provider, and shows two
paragraphs about the hub *in this build*, labelled "Generated by AI about this
build — check the module documentation before relying on it". The request
carries your selection, so a good answer knows there is no firewall. If it
describes one, `connectivity.tf` is the authority.

The labs built on this zip are at <https://hybridcloudworks.com/education/labs>.
A browser workspace for them is coming.
