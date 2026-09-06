---
title: A production Azure platform for $150 a month
subtitle: Every resource, why it was chosen over the alternative, and the exact order to deploy it in.
date: 2026-08-19
track: how-to
part: 1 of 2
tags: [azure, terraform, github-actions, iac]
reading: 12
---

This builds the infrastructure for a small production web application on Azure:
a static site, an HTTP API, a document database, object storage, and a secret
store. Everything is defined in Terraform, deployed from CI, and holds **no
stored credentials anywhere** — not in a file, not in a variable, not in a
vault.

Part 2 deploys the application onto it.

## What you'll have at the end

| Resource | Purpose |
| --- | --- |
| Static Web App | The site itself, served from Azure's global edge |
| Function App (Flex Consumption) | The HTTP API and scheduled jobs |
| Cosmos DB (serverless, NoSQL) | The database |
| Two storage accounts | Uploaded content, and the Functions host's own state |
| Key Vault | Runtime secrets, resolved by managed identity |
| VNet + one delegated subnet | The only network path into the data stores |
| Log Analytics + Application Insights | Telemetry, in a separate subscription |
| Two managed identities | One for Terraform, one for the deploy workflows |

Roughly 130 resources once containers and role assignments are counted.

## What it costs

**A USD 150/month ceiling**, and that number does most of the architectural
work below. It is worth naming your ceiling before your services, because a
budget you cannot argue with is a budget that makes decisions for you.

Steady-state, with no traffic, this shape costs a few dollars: Cosmos serverless
bills per request unit, Flex Consumption bills per execution, storage bills for
what you store, and Static Web Apps Standard is a flat ~$9. There is no idle
compute anywhere, which is the entire point.

---

## Why these services

The section that matters. Every choice below names the alternative it beat and
the constraint that decided it.

### Flex Consumption, not Elastic Premium or classic Consumption

**Elastic Premium** bills for always-warm instances whether or not anything
runs. One instance is roughly the entire monthly budget. Rejected on cost.

**Classic Consumption** is cheap but cannot join a VNet, and VNet integration is
what lets every data store deny public traffic and admit exactly one subnet.
Rejected on architecture — it would have forced the databases open.

**Flex Consumption** scales to zero, bills per execution, and supports VNet
integration. It is the only one of the three that satisfies both constraints.

Two settings are worth setting explicitly rather than inheriting:

```hcl
instance_memory_in_mb  = 2048   # per-app, not per-function
maximum_instance_count = 20     # a public endpoint with no ceiling is a bill with no ceiling
# always-ready instances deliberately not configured — defaults to zero.
# One always-ready 2048 MB instance is ~$20/month whether or not it executes.
```

### Cosmos DB serverless, single region, session consistency

**Provisioned throughput** has a floor of 400 RU/s per container. With dozens of
containers that floor alone exceeds the budget several times over. Rejected on
cost.

**Serverless** bills per request unit consumed, with no floor. For a site whose
traffic is bursty and low, that is the difference between $10 and $400.

Single region and `zone_redundant = false` are consistent with that decision
rather than a compromise: a serverless single-region account has already
accepted the failure mode zone redundancy protects against, so paying for
redundancy on one axis while ignoring the other buys nothing.

Session consistency because it matches what the previous datastore provided —
consistency is a semantic the application depends on, so changing it during a
migration means changing application behaviour at the same time as
infrastructure. Do one at a time.

### Two storage accounts, not one and not four

**One** would mean the Functions runtime's own state — host locks, deployment
packages — sharing an account with user-uploaded content. Different lifecycles,
different blast radius: replacing the Functions host account takes the API down
until redeploy, and it should not be able to take your users' images with it.

**Four** (one per content type, the common enterprise shape) multiplies the
firewall rules, role assignments and network rules by four for no isolation you
actually need at this size.

Two, split on lifecycle rather than on content type.

### Static Web Apps, not Blob static hosting or App Service

**Blob static website** hosting has no built-in TLS for custom domains, no
staging environments, and no SPA routing fallback. You would rebuild all three.

**App Service** means paying for a plan to serve files.

Static Web Apps Standard gives global edge distribution, free managed
certificates, PR preview environments and SPA routing for ~$9/month.

### Key Vault with managed identity, not app settings

Secrets could sit directly in Function App settings. They would then be readable
by anyone with Contributor on the resource group, appear in ARM template
exports, and be invisible to any audit.

Key Vault references (`@Microsoft.KeyVault(SecretUri=…)`) resolve at runtime
through the app's own managed identity. The secret value never enters Terraform
state, never enters an app setting, and access is a role assignment you can
revoke.

**The consequence to plan for:** the vault must be reachable by the app. See the
service-endpoint trap in step 5 — it is the single most common way this design
fails silently.

### OIDC federation, not service principal secrets

A service principal client secret is a long-lived credential that must be
stored, rotated and eventually leaked. OIDC federation exchanges a short-lived
token, issued per run, for Azure access. Nothing is stored.

This applies twice, to two different identities that are easy to confuse:

| | Terraform → Azure | GitHub Actions → Azure |
| --- | --- | --- |
| Created by | A bootstrap script, by hand, once | Terraform |
| Identity | `id-plat-terraform-prod-cus-01` | `id-app-github-deploy-prod-cus-01` |
| Issuer | `app.terraform.io` | `token.actions.githubusercontent.com` |
| Exists | Before anything else | After the first successful apply |

### Managed identity, not app registration

Both identities are **user-assigned managed identities**, and this is not
stylistic. Creating an app registration requires Application Administrator in
Entra ID, and **Azure Owner does not grant that** — Azure RBAC and Entra
directory roles are separate permission planes.

A managed identity is an ordinary Azure resource. Entra supports federating one
to an arbitrary external issuer. So an Azure Owner can build the entire
credential chain with no directory role at all, which is usually the difference
between deploying today and filing a ticket.

---

## Prerequisites

- An Azure subscription where you hold **Owner** (needed to create role
  assignments, not just resources).
- Azure CLI, signed in: `az login`.
- Terraform ≥ 1.5, and an HCP Terraform organisation, project and workspace.
- A GitHub repository.
- **Nothing pre-created in the portal.** If you have been clicking, start from
  an empty resource group — Terraform importing a hand-made resource is a much
  worse first day than creating it.

**Check region availability before you write any configuration.** This is the
step everyone skips and it costs the most:

```bash
# 1. Does the region support Flex Consumption?
az functionapp list-flexconsumption-locations --query "sort_by(@, &name)[].name" -o tsv

# 2. Is Cosmos deployable in the region at all? (ARM's answer)
az provider show --namespace Microsoft.DocumentDB \
  --query "resourceTypes[?resourceType=='databaseAccounts'].locations" -o tsv

# 3. Is YOUR subscription cleared for Cosmos there? (Cosmos's answer — different question)
az cosmosdb locations list \
  --query "[?properties.isSubscriptionRegionAccessAllowedForRegular].name" -o tsv

# 4. Is Static Web Apps offered there? Only five regions:
#    centralus, eastus2, westus2, westeurope, eastasia
```

Checks 2 and 3 answer **different questions and routinely disagree**. A region
can be ARM-deployable while your subscription has no Cosmos access, and vice
versa. Both must pass.

**Check your globally-unique names, too.** Storage accounts, Key Vaults, Cosmos
accounts and Function Apps live in a namespace shared with every other Azure
customer:

```bash
az storage account check-name --name stappprodcus01
az keyvault check-name --name kv-app-prod-cus-01
az cosmosdb check-name-exists --name cosmos-app-prod-cus
```

Finding out a name is taken during an apply is considerably worse than finding
out in a terminal.

---

## The steps

### 1. Bootstrap the Terraform identity

**Terraform cannot create the credential Terraform authenticates with.** This
step exists to break that circle, runs once in the life of a subscription, and
is the only manual step in the whole deployment.

Create a user-assigned managed identity, federate it to HCP Terraform, and grant
it what it needs:

```bash
RG=rg-mgmt-boot-prod-cus
ID=id-plat-terraform-prod-cus-01
LOC=centralus

az group create -n $RG -l $LOC
az identity create -n $ID -g $RG -l $LOC
```

Now **two** federated credentials, not one. HCP Terraform stamps the run phase
into the token subject, and Entra matches subjects as exact, case-sensitive
strings with no wildcards:

```bash
for PHASE in plan apply; do
  az identity federated-credential create \
    --name "tfc-$PHASE" --identity-name $ID --resource-group $RG \
    --issuer "https://app.terraform.io" \
    --audiences "api://AzureADTokenExchange" \
    --subject "organization:acme:project:Platform:workspace:app-azure:run_phase:$PHASE"
done
```

Configure only `plan` and every run plans beautifully while every apply fails at
authentication — which reads as a permissions problem and is not one.

Grant it Contributor **and** Role Based Access Control Administrator on every
target subscription. Contributor alone cannot create the role assignments your
configuration declares; RBAC Administrator cannot grant Owner, so the identity
cannot escalate itself:

```bash
OID=$(az identity show -n $ID -g $RG --query principalId -o tsv)
for ROLE in "Contributor" "Role Based Access Control Administrator"; do
  az role assignment create --assignee-object-id $OID \
    --assignee-principal-type ServicePrincipal \
    --role "$ROLE" --scope "/subscriptions/<subscription-id>"
done
```

**Keep this identity out of Terraform state, deliberately.** If Terraform
managed the credential it authenticates with, one bad destroy would lock the
workspace out of the subscription with no way back in except re-running this by
hand.

**Verify:** `az identity federated-credential list --identity-name $ID -g $RG`
returns two credentials.

### 2. Set the workspace variables

In HCP Terraform, as **environment** variables — not Terraform variables. The
`ARM_*` and `TFC_AZURE_*` names are read from the process environment, and set
in the wrong category they are silently ignored while the run fails claiming no
credentials were supplied.

| Name | Value |
| --- | --- |
| `TFC_AZURE_PROVIDER_AUTH` | `true` |
| `TFC_AZURE_RUN_CLIENT_ID` | client id of `id-plat-terraform-prod-cus-01` |
| `ARM_TENANT_ID` | `<tenant-id>` |
| `ARM_SUBSCRIPTION_ID` | `<subscription-id>` |

Then your configuration's own variables — subscription ids, domain, alert email
— as **Terraform** variables, sensitive where they are credentials.

**Verify:** a speculative `terraform plan`. It should reach Azure and propose
creating resources. If it fails with `AADSTS70021`, the federated subject does
not match — compare it character by character against step 1.

### 3. Declare the provider with no credentials in it

```hcl
provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_app
  resource_provider_registrations = "none"
  resource_providers_to_register  = var.azure_resource_providers
}
```

There is no `client_id` and no secret, and that absence *is* the configuration.
HCP Terraform injects `ARM_CLIENT_ID`, `ARM_OIDC_TOKEN` and `ARM_USE_OIDC` per
run phase; the provider picks them up with no HCL.

`resource_provider_registrations = "none"` is a v4→v5 change worth knowing.
Older provider versions registered ~60 resource providers at startup. On a
subscription nobody has deployed to, turning that off surfaces at apply time as
`MissingSubscriptionRegistration`, which does not say what to do about it. List
exactly what you need instead:

```hcl
variable "azure_resource_providers" {
  type = list(string)
  default = [
    "Microsoft.App",                 # Flex Consumption subnet delegation
    "Microsoft.DocumentDB",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.ManagedIdentity",
    "Microsoft.Network",
    "Microsoft.OperationalInsights",
    "Microsoft.Storage",
    "Microsoft.Web",
  ]
}
```

### 4. Name everything before you create anything

Azure resource names are **immutable**. So are regions. There is no rename —
only destroy and recreate. Decide the convention now, while doing so is free.

Microsoft's Cloud Adoption Framework gives the shape:

```
<resource-abbreviation>-<workload>-<environment>-<region>[-<instance>]
```

The instance number is assigned **per resource type**, not to everything. CAF's
own tables give one to function apps, web apps, storage accounts, virtual
networks, subnets, NSGs and managed identities — and withhold it from resource
groups, Cosmos accounts and route tables.

Resist the tempting rule "add a number only when there is more than one". It
makes the name depend on a fact that changes *after* the name is fixed, and
since names are immutable the first instance can never be corrected.

Storage accounts take no hyphens and cap at 24 characters, so the number runs on
unseparated — `stappprodcus01`. That is CAF's own shape, not a compromise.

### 5. Close the network — and avoid the silent trap

Every data store denies public traffic and admits the Functions subnet:

```hcl
resource "azurerm_subnet" "functions" {
  name                 = "snet-app-func-prod-cus-01"
  address_prefixes     = ["10.40.0.0/24"]

  # REQUIRED. A VNet rule on Key Vault, Cosmos or Storage is INERT without the
  # matching service endpoint — the rule exists, looks correct in the portal,
  # and denies the Function App along with everyone else.
  dynamic "service_endpoint" {
    for_each = toset(["Microsoft.KeyVault", "Microsoft.AzureCosmosDB", "Microsoft.Storage"])
    content { service = service_endpoint.value }
  }

  delegation {
    name = "flex-consumption"
    service_delegation {
      name    = "Microsoft.App/environments"
      # join/action is what Azure actually assigns for this delegation.
      # Name anything else and the plan never converges: Terraform writes your
      # value, Azure replaces it, the next plan proposes the same change forever.
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}
```

**This is the highest-value paragraph in the post.** Without the service
endpoints, the app deploys clean and then its Key Vault references resolve to
nothing — so a missing credential presents as *missing data*, not as a network
denial. Nothing in CI catches it and `terraform validate` passes.

### 6. Guard the stateful resources

```hcl
lifecycle {
  prevent_destroy = true
}
```

On the Cosmos account, both storage accounts, and the Key Vault. A plan that
wants to replace one of these now fails until a human removes the guard in a
reviewed change.

This is cheap to add on day one and impossible to add retroactively at the
moment you need it.

### 7. Plan, review, apply

```bash
terraform fmt -recursive -check
terraform validate
terraform plan          # read every line
terraform apply
```

Review the plan for destroy/create pairs on anything stateful, and for changes
you cannot trace to your diff. Anything surprising: discard and fix in a new
change rather than applying and correcting.

---

## How to know it worked

```bash
terraform plan   # → "No changes. Your infrastructure matches the configuration."
```

An empty plan immediately after an apply is the real check. A plan that still
proposes changes means something in your configuration does not converge, and
that condition never improves on its own.

Then confirm the posture rather than assuming it:

```bash
# Everything is where you think it is
az resource list --query "[?location!='centralus'].{n:name,l:location}" -o table

# Key Vault denies by default and admits only the subnet
az keyvault show -n kv-app-prod-cus-01 -g rg-sec-app-prod-cus \
  --query "properties.networkAcls" -o json

# The app has an identity
az functionapp identity show -n func-app-prod-cus-01 -g rg-web-app-prod-cus
```

---

## When it doesn't work

**`MissingSubscriptionRegistration`** — a resource provider is not registered on
this subscription. Add it to `resource_providers_to_register`. Appears at apply,
never at plan.

**`AADSTS70021: No matching federated identity record found`** — the token's
subject does not match any federated credential, exactly and
case-sensitively. Compare them character by character; the usual causes are a
missing `run_phase` credential, or an organisation, project or workspace name
that differs in case or spacing from what you assumed.

**`LocationNotAvailableForResourceType`** — ARM does not offer that resource
type in that region. The error lists valid regions, and that list may include a
region your subscription still cannot use for that service. Run both checks from
Prerequisites.

**Cosmos `ServiceUnavailable`, mentioning availability zones** — usually not
about zones. Check `isSubscriptionRegionAccessAllowedForRegular` for the region
first; the message points at a setting that is frequently not the cause.

**Vault name already exists, and is nowhere in your tenant** — global namespace.
Someone else has it. Use the instance suffix: `kv-app-prod-cus-02`.

**A resource group will not delete, "still contains Resources"** — something
created a resource Terraform does not manage inside it. Application Insights
creates a `Smart Detection` action group this way. Delete that object rather
than setting `prevent_deletion_if_contains_resources = false`, which disables
the check for every resource group you will ever have.

---

## What's next

Part 2 deploys the application onto this: locking the origin so only your CDN
can reach it, wiring GitHub Actions to deploy without credentials, and the
authentication detail that silently breaks every deploy.
