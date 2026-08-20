# =============================================================================
# variables.tf — Azure infrastructure variables
# All sensitive values are set as workspace variables in HCP Terraform Cloud
# Org: hcw | Project: Site | Workspace: hcw-azure
#
# Variable names here MUST match TF Cloud workspace variable keys exactly.
# See REVIEW.md Part 4 at the repository root for the full variables/secrets catalog.
# =============================================================================

# -----------------------------------------------------------------------------
# Subscriptions — one per platform/application landing zone
#
# The platform is split across four subscriptions and each is reached through
# its own provider alias (providers.tf). Nothing here has a default: a wrong
# guess would silently deploy the workload into a platform subscription, so an
# unset value must fail the plan rather than pick something.
#
# These are IDs, not credentials — the identity is federated (no secret exists
# to leak) — but they stay `sensitive` to keep subscription IDs out of CI logs.
# -----------------------------------------------------------------------------
variable "subscription_app" {
  description = "Application landing zone: the HCWSite workload (sub-app-site-prod-cus)"
  type        = string
  sensitive   = true
}

variable "subscription_mgmt" {
  description = "Platform Management: central Log Analytics, action groups, and the Terraform identity's own resource group (sub-plat-mgmt-prod-cus)"
  type        = string
  sensitive   = true
}

variable "subscription_conn" {
  description = "Platform Connectivity: hub network and, later, centralized private DNS zones (sub-plat-conn-prod-cus)"
  type        = string
  sensitive   = true
}

# There is no subscription_ident. The Identity landing zone
# (sub-plat-ident-prod-cus) holds nothing: HCWSite authenticates against Entra
# ID, and app registrations are tenant objects rather than subscription
# resources. Declaring the variable would require a value for a subscription
# nothing deploys into — see the note in providers.tf.

# Exactly the resource providers this configuration's resources need, and no
# more. azurerm 5.0 registers none by default, and an unregistered provider
# fails at apply with MissingSubscriptionRegistration rather than at plan.
#
# Set this to [] when ALZ absorption takes registration over centrally: the
# deploy identity would then no longer need the /register/action permission,
# and re-registering under a policy that governs it is at best redundant.
variable "azure_resource_providers" {
  description = "Resource providers Terraform registers on each target subscription; empty the list when registration is centrally governed"
  type        = list(string)
  default = [
    "Microsoft.App", # Flex Consumption subnet delegation (Microsoft.App/environments)
    # No Microsoft.CognitiveServices: AI runs on external provider APIs, so
    # this subscription hosts no Azure OpenAI account to register it for.
    "Microsoft.DocumentDB",          # Cosmos DB
    "Microsoft.Insights",            # Application Insights, diagnostic settings, action groups
    "Microsoft.KeyVault",            # Key Vault
    "Microsoft.ManagedIdentity",     # user-assigned identities
    "Microsoft.Network",             # virtual network and subnets
    "Microsoft.OperationalInsights", # Log Analytics workspace
    "Microsoft.Storage",             # both storage accounts
    "Microsoft.Web",                 # Function App, service plan, static web app
  ]
}

# centralus, not southcentralus, and the whole estate is there deliberately.
#
# southcentralus was the original choice and it cost three apply-time failures:
# Cosmos has no subscription region access there, Static Web Apps is not
# offered there, and each failure was discovered during an apply rather than
# before one. centralus is the nearest region that hosts every service this
# workload uses, verified before the move rather than after:
#
#   az functionapp list-flexconsumption-locations   # centralus present
#   az provider show --namespace Microsoft.DocumentDB \
#     --query "resourceTypes[?resourceType=='databaseAccounts'].locations"
#   az cosmosdb locations list \
#     --query "[?properties.isSubscriptionRegionAccessAllowedForRegular]"
#
# Consolidating here retires cosmos_location and static_web_app_location as
# exceptions: they were only ever workarounds for southcentralus, and both now
# resolve to the same region as everything else.
variable "azure_location" {
  description = "Azure region for all resources — centralus hosts every service this workload uses"
  type        = string
  default     = "centralus"
}

# Static Web Apps is offered in FIVE regions only — centralus, eastus2,
# westus2, westeurope, eastasia. This now holds the SAME value as
# azure_location, and the variable stays anyway: the constraint has not gone
# away, it is merely satisfied. Fold it into azure_location and the next region
# change fails at apply with LocationNotAvailableForResourceType instead of at
# plan with the validation below.
#
# This is a control-plane location only. The site is served from Azure's global
# edge network either way, so the region does not decide where users are served
# from.
variable "static_web_app_location" {
  description = "Region for the Static Web App — must be one of the five that offer it; equals azure_location today, kept separate because the constraint has not gone away"
  type        = string
  default     = "centralus"

  validation {
    condition     = contains(["centralus", "eastus2", "westus2", "westeurope", "eastasia"], var.static_web_app_location)
    error_message = "Static Web Apps is only available in centralus, eastus2, westus2, westeurope or eastasia."
  }
}

# Cosmos cannot sit in azure_location, and picking where it CAN sit takes two
# independent checks that disagree with each other. Both must pass:
#
#   1. Is the resource type deployable in the region at all? ARM decides, and
#      it is the list in the LocationNotAvailableForResourceType error:
#        az provider show --namespace Microsoft.DocumentDB \
#          --query "resourceTypes[?resourceType=='databaseAccounts'].locations"
#   2. Is THIS subscription cleared for that region? Cosmos decides, separately:
#        az cosmosdb locations list \
#          --query "[?properties.isSubscriptionRegionAccessAllowedForRegular]"
#
# southcentralus passes (1) and fails (2) — the subscription has no region
# access, reported as ServiceUnavailable and "high demand ... for the zonal
# redundant (Availability Zones) accounts", which reads as transient capacity
# and sends you to zone_redundant, where the answer is not.
#
# southcentralus2 passes (2) and fails (1) — Cosmos is simply not offered
# there, reported as LocationNotAvailableForResourceType.
#
# centralus passes both, which is why the whole estate moved there rather than
# leaving Cosmos stranded on its own. Like static_web_app_location, this now
# equals azure_location and stays a separate variable regardless: the two-API
# disagreement above is a property of Cosmos, not of southcentralus, and any
# future region change has to clear both checks again.
variable "cosmos_location" {
  description = "Region for the Cosmos account — must be both ARM-deployable and subscription-allowed; equals azure_location today, kept separate because both checks must be re-run for any new region"
  type        = string
  default     = "centralus"
}

variable "environment" {
  description = "Environment name (prod, staging, dev)"
  type        = string
  default     = "prod"
}

# -----------------------------------------------------------------------------
# Naming
# -----------------------------------------------------------------------------
# A data-plane identifier, NOT an Azure resource name, and therefore outside
# the CAF resource-naming convention.
#
# FOUR code paths hard-code this value as their fallback when COSMOS_DATABASE
# is unset, and all four must change together:
#
#   functions/src/lib/cosmos-client.js
#   scripts/lib/cli.mjs
#   scripts/apply-computed-sortdate.mjs
#   scripts/smoke-deployed.mjs
#
# Change it here without changing them there and those paths connect to a
# database that does not exist — which surfaces as an authorization error,
# not a "no such database" one, because the Cosmos SDK cannot distinguish
# "absent" from "not permitted" for a caller whose RBAC is scoped per-database.
variable "cosmos_database_name" {
  description = "Cosmos SQL database name. Data-plane contract shared with the Functions and scripts workspaces; change only in coordination with them"
  type        = string
  default     = "hcw"
}

variable "workload_name" {
  description = "Workload token in resource names — the application, not the organization (Naming-Convention wiki page)"
  type        = string
  default     = "site"
}

# Microsoft publishes no official region abbreviations, so this is a local
# convention and lives in the Naming-Convention wiki page's table. It is a
# variable because a second region must not require editing every name.
variable "region_abbreviation" {
  description = "Short form of azure_location used in resource names (cus = centralus)"
  type        = string
  default     = "cus"
}

# The CAF instance number. Microsoft's "Define your naming convention" lists
# `01` and `001` as the two accepted forms; this estate uses two digits, which
# is what kv-site-prod-scus-01 already established.
#
# It is NOT applied to every resource. CAF assigns the instance number per
# resource type, and its example table omits it on resource groups, Cosmos DB
# and route tables while requiring it on function apps, web apps, storage
# accounts, virtual networks, subnets, NSGs and managed identities. This
# configuration follows that table where CAF speaks, and for types CAF does
# not list (Key Vault, App Service plan, Log Analytics, Application Insights,
# action groups, Container Apps) applies the instance number where the name is
# GLOBAL scope or a second instance is plausible — which is the same logic CAF
# uses to decide its own table.
#
# The point of the suffix is not decoration. A global-scope name can be taken
# by an unrelated Azure customer, and when that happened to kv-site-prod-scus
# the instance number was the only fallback that did not break the pattern.
variable "instance" {
  description = "CAF instance number used in resource names — the fallback when a global-scope name is already taken"
  type        = string
  default     = "01"

  validation {
    condition     = can(regex("^[0-9]{2,3}$", var.instance))
    error_message = "instance must be two or three digits, e.g. 01 or 001 (CAF: Define your naming convention)."
  }
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------
variable "vnet_address_space" {
  description = "Address space for the workload (spoke) VNet"
  type        = string
  default     = "10.40.0.0/16"
}

# The hub must not overlap any spoke: peering rejects overlapping address
# space, and the failure arrives when the SECOND spoke is peered, long after
# the first choice looks fine. 10.0.0.0/16 for the hub and 10.40.0.0/16 for
# HCWSite leaves 10.1–10.39 for future spokes without re-addressing anything.
#
# Room is reserved inside the hub for the gateway, firewall and Bastion
# subnets even though none is created — subnets cannot be resized after
# creation, and a hub with no room for a firewall is a hub that gets rebuilt:
#
#   10.0.0.0/26   GatewaySubnet        (reserved, not created)
#   10.0.0.64/26  AzureFirewallSubnet  (reserved, not created — /26 minimum)
#   10.0.0.128/26 AzureBastionSubnet   (reserved, not created — /26 minimum)
#   10.0.1.0/24   shared services      (created)
variable "hub_address_space" {
  description = "Address space for the platform hub VNet; must not overlap any spoke"
  type        = string
  default     = "10.0.0.0/16"
}

variable "hub_shared_subnet_prefix" {
  description = "Shared-services subnet in the hub. Deliberately above the /26 ranges reserved for GatewaySubnet, AzureFirewallSubnet and AzureBastionSubnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "functions_subnet_prefix" {
  description = "Address prefix for the Functions Flex integration subnet"
  type        = string
  default     = "10.40.0.0/24"
}

# Every entry here is load-bearing for a firewall rule elsewhere in this
# configuration, not a convenience: Key Vault, Cosmos and Storage all set
# default_action = "Deny" and allow this subnet by VNet rule, and a VNet rule
# without the matching service endpoint is inert. Removing an entry does not
# loosen access, it silently denies the Function App.
#
# This empties out when the account it fronts moves to a private endpoint,
# which is why it is an input rather than a literal.
variable "functions_subnet_service_endpoints" {
  description = "Service endpoints on the Functions integration subnet; each one backs a VNet rule on the matching service"
  type        = list(string)
  default     = ["Microsoft.KeyVault", "Microsoft.AzureCosmosDB", "Microsoft.Storage"]
}

# -----------------------------------------------------------------------------
# Cosmos DB
# -----------------------------------------------------------------------------
variable "cosmos_db_account_name" {
  description = "Cosmos DB account name (globally unique)"
  type        = string
  # This name was already correct before the estate moved: `cus` names where
  # the DATA lives, and a database's region IS data residency rather than a
  # control-plane detail. The rest of the estate has now caught up to it.
  #
  # NO instance number, and that is CAF's call, not an oversight: the "Define
  # your naming convention" example table gives Cosmos `cosmos-<workload>-
  # <environment>` with no <###>, the same as SQL database, API Management and
  # Service Bus. It is one of the three types in this configuration CAF
  # deliberately leaves unnumbered (the others are resource groups and route
  # tables).
  #
  # The tension worth knowing about: a Cosmos account name is GLOBAL scope, so
  # it can be taken by an unrelated customer exactly as kv-site-prod-scus was.
  # If that ever happens here, append `-01` — the pattern accommodates it, and
  # doing so knowingly is different from carrying the suffix by default.
  default = "cosmos-site-prod-cus"
}

variable "cosmos_local_auth_disabled" {
  description = "Disable Cosmos key (local) authentication — AAD/managed-identity only. The durable answer to REVIEW §0.2. Set false only if plan review surfaces a key consumer."
  type        = bool
  default     = true
}

variable "cosmos_allow_azure_datacenter_ips" {
  description = "Include the '0.0.0.0' sentinel in the Cosmos firewall, allowing Azure datacenter IPs. Required while heal-computed-properties runs on GitHub-hosted runners (which are Azure-hosted). Drop when that job moves in-VNet."
  type        = bool
  default     = true
}

variable "cosmos_admin_ip_rules" {
  description = <<-EOT
    Operator IPv4 addresses/CIDRs allowed through the Cosmos firewall, for
    smoke tier 2 or live-data inspection (REVIEW §0.3). Same pattern as
    admin_ip_rules on Key Vault: populate for the window, apply, work, empty
    it, apply again. Empty is the correct steady state.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.cosmos_admin_ip_rules : can(cidrnetmask("${ip}/32")) || can(cidrnetmask(ip))])
    error_message = "cosmos_admin_ip_rules entries must be IPv4 addresses or CIDR ranges."
  }
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
variable "functions_storage_network_default_action" {
  description = "Default network action on the Functions host storage account. \"Deny\" is the T-503 posture; \"Allow\" is the one-step rollback if the app stops cold-starting or deploys fail after the firewall lands."
  type        = string
  default     = "Deny"

  validation {
    condition     = contains(["Allow", "Deny"], var.functions_storage_network_default_action)
    error_message = "functions_storage_network_default_action must be \"Allow\" or \"Deny\"."
  }
}

variable "functions_storage_admin_ip_rules" {
  description = <<-EOT
    Operator IPv4 addresses/CIDRs allowed through the Functions host storage
    firewall, for manual package uploads or host-state inspection. Same
    pattern as admin_ip_rules and cosmos_admin_ip_rules: populate for the
    window, apply, work, empty, apply. Empty is the correct steady state —
    workflow deploys use their own per-run firewall window instead.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.functions_storage_admin_ip_rules : can(cidrnetmask("${ip}/32")) || can(cidrnetmask(ip))])
    error_message = "functions_storage_admin_ip_rules entries must be IPv4 addresses or CIDR ranges."
  }
}

# The two storage accounts are the one place the CAF pattern cannot be read
# literally: storage account names take NO hyphens and cap at 24 characters, so
# the delimiters are dropped and the instance number runs straight onto the
# end. CAF names this shape itself — `st<workload><###>`, e.g. stworkload1data001
# — so this is the convention followed, not abandoned.
#
#   stsitefuncprodcus01   19 chars
#   stsiteprodcus01       15 chars
#
# Both are explicit rather than computed: a name a reader cannot predict from
# the convention should not be assembled out of it, and these are the names
# that appear in workflow files and support tickets.
variable "functions_storage_account_name" {
  description = "Functions host storage account (globally unique, 3-24 chars, lowercase alphanumeric — no hyphens, so the CAF instance number runs on unseparated)"
  type        = string
  default     = "stsitefuncprodcus01"
}

variable "storage_account_name" {
  description = "Azure Storage account name (globally unique, 3-24 chars, lowercase alphanumeric — no hyphens, so the CAF instance number runs on unseparated)"
  type        = string
  default     = "stsiteprodcus01"
}

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
# CAF gives the function app an instance number in its own example table
# (func-<workload>-<environment>-<###>.azurewebsites.net), and the name is
# global across azurewebsites.net, so the suffix is also the collision
# fallback. Changing it changes the API hostname — see the Deployment Runbook
# for what has to be re-pointed.
variable "function_app_name" {
  description = "Azure Function App name (globally unique across azurewebsites.net)"
  type        = string
  default     = "func-site-prod-cus-01"
}

# -----------------------------------------------------------------------------
# Key Vault
# -----------------------------------------------------------------------------
variable "key_vault_name" {
  description = "Azure Key Vault name (globally unique, 3-24 chars)"
  type        = string
  # `-01` here is the original instance number used in earnest: the unsuffixed
  # kv-site-prod-scus is held by an unrelated Azure customer — vault names are
  # global and it is not soft-deleted anywhere in this tenant, so it cannot be
  # recovered. That incident is why the suffix is now a first-class part of the
  # convention rather than an improvisation. 19 characters, inside the
  # 24-character limit.
  #
  # NOTE ON REPLACEMENT: the vault this replaces is soft-deleted, not purged
  # (purge_soft_delete_on_destroy = false in providers.tf), so the OLD name
  # stays reserved for the retention window. That is harmless here only because
  # the new name differs. Reusing a destroyed vault's name requires a purge.
  default = "kv-site-prod-cus-01"
}

variable "purge_protection_enabled" {
  description = "Enable Key Vault purge protection. Set false only during initial dev; must be true before production secrets are written."
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Budget
# -----------------------------------------------------------------------------
variable "budget_amount_usd" {
  description = "Monthly budget ceiling in USD"
  type        = number
  default     = 150
}

variable "budget_alert_email" {
  description = "Email address for budget alert notifications"
  type        = string
}

# Must be the first of the current month or later, in UTC — Azure rejects
# anything earlier for a monthly budget. Update it when a first apply into a
# new subscription lands in a later month than this default.
variable "budget_start_date" {
  description = "Budget period start (RFC3339, first of a month). Azure rejects a start date before the current month"
  type        = string
  default     = "2026-08-01T00:00:00Z"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-01T00:00:00Z$", var.budget_start_date))
    error_message = "budget_start_date must be the first of a month, e.g. 2026-08-01T00:00:00Z."
  }
}

# -----------------------------------------------------------------------------
# Auth / Entra ID
# -----------------------------------------------------------------------------
variable "entra_tenant_id" {
  description = "Entra ID tenant ID for JWT validation and OIDC deployment"
  type        = string
  sensitive   = true
}

# NOTE: `entra_client_id` was removed here. It fed the ENTRA_CLIENT_ID app
# setting, which the API used as its JWT audience — the single-registration
# model DECISION 3 replaces. Nothing in this configuration consumed it
# afterwards, and leaving a required variable with no consumer forces operators
# to supply a value for nothing. The SPA client id is still needed, but by the
# frontend build, not by this Terraform.

# DECISION 3 — two app registrations: a public-client SPA, and a separate API
# exposing api://<api-client-id>. The API validates `aud` against its OWN
# identifier.
#
# With a single registration an ID token minted for the SPA carries
# aud = <client-id>, indistinguishable from an access token for the API — so a
# token the browser was never meant to send to an API would be accepted by it.
#
# No default, and functions/src/lib/auth/verify-token.js refuses to start
# without it. That is deliberate: jsonwebtoken only applies the audience check
# when `audience` is truthy, so an unset value does not fail — it SKIPS audience
# validation and successfully verifies any Microsoft-signed token for the
# tenant, including a Graph token.
variable "entra_api_audience" {
  description = "Application ID URI of the API registration (e.g. api://<guid>) — validated as the JWT audience"
  type        = string

  validation {
    condition     = length(trimspace(var.entra_api_audience)) > 0
    error_message = "entra_api_audience must not be empty; an empty audience silently disables audience validation."
  }
}

# -----------------------------------------------------------------------------
# GitHub OIDC deployment identities (used for federated credential setup)
# -----------------------------------------------------------------------------
# These two are not cosmetic. They compose the federated credential `subject`
# in oidc.tf, which GitHub's OIDC token must match EXACTLY. A stale value does
# not warn — the token is issued, Azure declines it, and azure/login fails with
# a generic AADSTS70021 "no matching federated identity record found".
#
# Both were stale until now: the repository moved to the HybridCloudWorks org,
# and nothing consumed these variables, so nothing surfaced the drift.
variable "github_org" {
  description = "GitHub organisation owning the repository — must match the OIDC token issuer claim"
  type        = string
  default     = "HybridCloudWorks"
}

variable "github_repo" {
  description = "GitHub repository name (without org prefix) — must match the OIDC token subject claim"
  type        = string
  default     = "HCW-HybridCloudWorks"
}

variable "github_deploy_ref" {
  description = "Git ref allowed to assume the deployment identity. Deploys are gated to this branch."
  type        = string
  default     = "refs/heads/main"
}

# -----------------------------------------------------------------------------
# Key Vault seeding access
# -----------------------------------------------------------------------------
variable "admin_ip_rules" {
  description = <<-EOT
    Public IPv4 addresses or CIDRs permitted to reach Key Vault, for seeding
    secrets by hand as Azure Owner. Empty is the correct steady state: the vault
    is then reachable only by the Function App over its subnet.

    Populate for the seeding window, apply, run the `az keyvault secret set`
    commands, then empty it and apply again. Secret values are never managed by
    Terraform, so they do not enter state or Terraform Cloud.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.admin_ip_rules : can(cidrnetmask("${ip}/32")) || can(cidrnetmask(ip))])
    error_message = "admin_ip_rules entries must be IPv4 addresses or CIDR ranges."
  }
}

# -----------------------------------------------------------------------------
# Cloudflare (DNS management)
# -----------------------------------------------------------------------------
variable "cloudflare_api_token" {
  description = "Cloudflare API token — Zone:Read + DNS:Edit scoped to the domain"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for the domain"
  type        = string
}

# -----------------------------------------------------------------------------
# Origin lock (DECISION 6)
#
# Two halves that are worthless apart, which is why they land together:
#
#   1. Cloudflare stamps every request it proxies with x-hcw-origin-secret.
#   2. The Function App refuses traffic that did not come from Cloudflare.
#
# With only (1), anyone who learns the header value replays it straight at the
# origin. With only (2), the app cannot tell a Cloudflare request from a
# direct one and client-identity.js keeps failing closed. Together they make
# CF-Connecting-IP trustworthy, which is the whole point: rate limiting on a
# spoofable identifier is not rate limiting.
# -----------------------------------------------------------------------------

# The SAME value that sits in Key Vault as CF-ORIGIN-SECRET, which the Function
# App reads at runtime. It is duplicated here because the two ends of a shared
# secret are configured by different systems and neither can read the other's
# copy: Terraform configures Cloudflare, the app reads the vault.
#
# THE TWO MUST MATCH EXACTLY. A mismatch is not a partial failure — every
# anonymous request is treated as bypassing Cloudflare and throws.
#
# Set as a SENSITIVE workspace variable in HCP Terraform, never in a tfvars
# file. Rotating it means writing both ends before the next request lands, so
# do it in a maintenance window, vault first.
#
# THE API TOKEN NEEDS MORE THAN DNS. cloudflare_ruleset requires Zone →
# Transform Rules:Edit and Account → Rulesets:Read on top of the Zone:Read and
# DNS:Edit the records need. A DNS-only token applies every cloudflare_record
# cleanly and fails on the ruleset alone with "Authentication error (10000)",
# which names neither the token nor the permission.
variable "cloudflare_origin_secret" {
  description = "Shared secret Cloudflare injects as x-hcw-origin-secret; MUST equal the CF-ORIGIN-SECRET value in Key Vault"
  type        = string
  sensitive   = true
  default     = ""
}

# The kill switch. false is the pre-lock posture and the one-step rollback.
#
# Turning this on restricts the Function App to Cloudflare's published ranges,
# so anything reaching the origin directly stops working — including, until it
# was fixed alongside this variable, the post-deploy smoke test in
# deploy-functions.yml, which curled the azurewebsites.net hostname from a
# GitHub-hosted runner. That test now goes through the proxied Cloudflare
# hostname, which is also the path real traffic takes.
#
# Enable only when cloudflare_origin_secret is set AND the vault holds the same
# value. Enabling with an empty secret locks the origin without giving
# Cloudflare a way to identify itself.
# Enabled 2026-08-20, after cloudflare_ruleset.origin_secret was created and
# verified: phase http_request_late_transform, scoped to the api-azure host,
# stamping x-hcw-origin-secret from the same value the vault holds.
#
# Set false to roll back in one step. That is the whole reason this is a
# variable and not a hardcoded block — the failure it guards against
# (Cloudflare ranges change, or a legitimate caller needs the origin) is a
# same-day problem, not a next-sprint one.
# Shared secret the CI smoke test presents so Cloudflare lets it through
# without a bot challenge.
#
# Synthetic checks from a GitHub-hosted runner receive Cloudflare's "Just a
# moment..." interstitial — an HTTP 403 carrying a challenge page — before the
# request reaches Azure at all. That has always been true (REVIEW §2.3) and
# became blocking once the origin lock landed: with the origin closed to
# everything but Cloudflare, the proxied path is the only path, so a challenged
# runner has no way in.
#
# The trap this creates is worse than the outage. A challenge 403 and an
# application refusal are indistinguishable to a check that only looks at the
# status code, so "admin routes reject anonymous callers" passes whether or not
# the app is running — a green test asserting nothing.
#
# Empty disables the rule entirely (count-gated below), which is the correct
# state if you would rather have no synthetic validation than a bypass header.
variable "cloudflare_ci_probe_secret" {
  description = "Secret the CI smoke test sends as x-hcw-ci-probe so Cloudflare skips the bot challenge; empty disables the skip rule"
  type        = string
  sensitive   = true
  default     = ""
}

variable "functions_origin_lock_enabled" {
  description = "Restrict the Function App to Cloudflare IP ranges. Requires cloudflare_origin_secret to match Key Vault"
  type        = bool
  default     = true
}

# Cloudflare's published IPv4 ranges (https://www.cloudflare.com/ips-v4).
#
# A literal list rather than an http data source on purpose: a data source puts
# a network call and an external dependency inside every plan, and a fetch that
# fails or returns a truncated body during an apply would silently rewrite the
# allow-list of the only door into this app. A list changes rarely, is
# reviewable in a diff, and fails at plan time when wrong.
#
# Re-check it when Cloudflare announces a change; the ranges have been stable
# for years but they are not immutable.
variable "cloudflare_ip_ranges" {
  description = "Cloudflare IPv4 ranges allowed to reach the Function App origin when the origin lock is on"
  type        = list(string)
  default = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]
}

# -----------------------------------------------------------------------------
# Domain
# -----------------------------------------------------------------------------
variable "domain" {
  description = "Base domain for all services"
  type        = string
  default     = "hybridcloudworks.com"
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
variable "tags" {
  description = "Default tags applied to all Azure resources"
  type        = map(string)
  default = {
    workload           = "hybridcloudworks"
    environment        = "prod"
    owner              = "platform"
    costCenter         = "content-platform"
    managedBy          = "terraform"
    criticality        = "high"
    dataClassification = "internal"
  }
}
