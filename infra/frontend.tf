# =============================================================================
# frontend.tf — Static Web App, its custom hostname binding, and the
# Cloudflare records and origin-secret ruleset that front the API.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

# `sampling_percentage` is DELIBERATELY NOT SET, and the reason is not
# oversight — it was proposed as the fix for the OverQuota workspace on
# 2026-08-24 and it is the wrong instrument here. Recorded so it is not
# proposed again.
#
# That argument configures INGESTION sampling, which Microsoft documents as
# operating "only when no other sampling is in effect: if the SDK samples your
# telemetry, ingestion sampling is disabled". Azure Functions enables ADAPTIVE
# sampling by default and functions/host.json enables it explicitly, with
# `excludedTypes: "Request"`. The consequence is exact and backwards:
#
#   - AppTraces, the table that is ~38% of the daily cap, IS sampled by the
#     host, so ingestion sampling does not touch it. Setting this would not
#     reduce the volume that caused the problem.
#   - Requests are EXCLUDED from host sampling, so they are the telemetry
#     ingestion sampling would actually discard. AppRequests and AppExceptions
#     are 0.3% of the cap each and are the two tables an incident is read from
#     — and observability.tf now runs an alert rule that counts AppExceptions
#     rows, which Microsoft's own guidance says sampling degrades ("alerts can
#     only trigger upon sampled data").
#
# So the setting would cost the alerting that landed in the same change and
# save nothing. The ingestion problem is fixed where the volume actually is:
# the Cosmos categories in observability.tf. The size of that reduction is
# stated there as a floor rather than a measurement — the figures behind it were
# sampled while the workspace was already capped, so they understate the true
# volume — and it has to be confirmed after a full uncapped day. Repeating a
# precise before/after number here would put two different claims in two files.
#
# If more headroom is ever needed, the levers in order are: host.json
# `logLevel` (Information-level host traces are what AppTraces mostly is),
# host.json `maxTelemetryItemsPerSecond` on the adaptive sampler, and then a
# workspace ingestion-time transformation — which is what Microsoft's daily-cap
# guidance recommends over a cap in the first place. All three are deterministic
# about WHAT they drop. This one is not.

# =============================================================================
# Azure Static Web App (frontend hosting)
#
# Standard tier provides:
#   - Custom domain with free managed SSL
#   - Global CDN (Azure Front Door backbone)
#   - SPA routing (navigationFallback in staticwebapp.config.json)
#   - Staging environments (preview on PRs)
#   - 100 GB bandwidth/month included
# =============================================================================
resource "azurerm_static_web_app" "hcw" {
  name = "stapp-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  # Still a separate variable from azure_location even though the two now hold
  # the same value: Static Web Apps is offered in five regions only, and the
  # validation on static_web_app_location catches a bad region at plan time
  # instead of at apply time. This resource used to be the estate's odd one
  # out — running in centralus while named for southcentralus — and the move
  # to a single region is what retired that exception.
  location            = var.static_web_app_location
  resource_group_name = azurerm_resource_group.app["web"].name
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = local.tags

  lifecycle {
    # These two are written by the deploy, not by Terraform.
    #
    # `Azure/static-web-apps-deploy` stamps the repository it published from
    # onto the resource. Terraform has never set them, so it reads them as
    # drift and plans to null them — which would win until the next frontend
    # deploy stamped them back, and then plan again. An apply that always
    # shows a change and a deploy that always undoes it is a loop, not a
    # convergence, and it makes "0 changed" stop meaning anything.
    #
    # They are metadata: the deployment uses a token, and nothing about
    # serving the site reads these. The right answer is that the pipeline owns
    # the field, so Terraform stops claiming it. First seen 2026-08-23, on the
    # first plan after the §6 step 1 frontend deploy.
    ignore_changes = [repository_url, repository_branch]
  }
}

# =============================================================================
# Cloudflare DNS — Azure Static Web App custom domain
#
# The existing root Terraform manages VPS subdomains (api, auth, argocd, etc.).
# This module adds the Azure-specific records used by the website and API.
# =============================================================================

# Azure SWA custom domain validation TXT record
# REMOVED 2026-08-23: cloudflare_record.azure_swa_txt_validation
#
# It published the Static Web App's default hostname as a TXT value at the apex
# and was described, here and in the runbook, as the domain-ownership proof. It
# was neither. Azure validates a root domain against a TOKEN it generates when
# the validation starts — a value like `_6sod2vwest3f9qq3jascfmqk4g5c9jt` — and
# it never looks at a hostname in a TXT record. The record was inert from the
# day it was written.
#
# It cost real time on 2026-08-23: the runbook said binding "does not wait on
# DNS moving" because this record existed, so `az staticwebapp hostname set` was
# run for both hostnames and both failed. www needed an actual CNAME; the apex
# needed `--validation-method dns-txt-token` and the generated token.
#
# It is not replaced by a managed record. The token is minted per validation and
# is not knowable at plan time, so pinning one in Terraform would be state that
# drifts the moment Azure reissues it. The procedure is in the runbook, step 3b:
# start the validation, read the token with `az staticwebapp hostname show`, add
# it as a TXT record, and Azure completes on its own.
#
# The `asuid.` convention some Azure docs describe belongs to App Service and
# Front Door, NOT to Static Web Apps. This estate does use it — correctly — for
# the Function App: `cloudflare_record.azure_functions_domain_verification`
# publishes `asuid.api-azure` holding `custom_domain_verification_id`, which is
# exactly how App Service proves domain ownership. Carrying that pattern across
# to the Static Web App is the mistake this comment exists to prevent; SWA
# validates a root domain with a generated token instead.

# Azure Functions subdomain for the API origin.
#
# `name` IS THE FULL RECORD NAME under provider v5, where v4 took the relative
# label "api-azure". The v5 schema documents it as "DNS record name (or @ for
# the zone apex)" and its own example passes a whole hostname. Leaving the bare
# label here would have Cloudflare read it as a name to append the zone to.
#
# `ttl = 1` still means automatic, which is the only value a proxied record
# accepts. v5 makes ttl Required rather than Optional; it was already set here.
resource "cloudflare_dns_record" "azure_functions" {
  zone_id = var.cloudflare_zone_id
  name    = "api-azure.${var.domain}"
  content = "${var.function_app_name}.azurewebsites.net"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Azure Functions API endpoint"
}

# The rename is a change of resource ADDRESS, so without these Terraform would
# destroy and recreate both records — and these two are the API's hostname and
# the ownership proof Azure reads at bind time. A destroy/create on them is a
# production DNS outage, not a refactor.
#
# The provider ships MoveState handlers for dns_record, so state transforms
# during the move rather than needing `terraform state mv` by hand.
moved {
  from = cloudflare_record.azure_functions
  to   = cloudflare_dns_record.azure_functions
}

moved {
  from = cloudflare_record.azure_functions_domain_verification
  to   = cloudflare_dns_record.azure_functions_domain_verification
}

# =============================================================================
# Origin lock, Cloudflare half (DECISION 6)
#
# Stamps x-hcw-origin-secret onto every request Cloudflare proxies to the
# origin. functions/src/lib/auth/client-identity.js compares it against the
# CF-ORIGIN-SECRET it reads from Key Vault and, in production, throws when it
# does not match rather than trusting a spoofable CF-Connecting-IP.
#
# Phase is http_request_late_transform, not http_request_transform: the late
# phase runs AFTER any customer transform rules and after Cloudflare's own
# managed headers, so nothing downstream can strip or overwrite the header
# before it reaches the origin.
#
# Created only when a secret is supplied. An empty string means "the lock is
# not configured yet", and creating a rule that stamps an empty header would
# make viaCloudflare() compare "" to "" and pass for everyone — the exact
# silent degradation this design exists to prevent.
# =============================================================================
# =============================================================================
# Custom hostname binding — what makes the proxied hostname reach the app
#
# App Service routes by HTTP Host header. Cloudflare proxies api-azure.<domain>
# to the origin but forwards the ORIGINAL Host, so App Service receives
# `Host: api-azure.<domain>`, finds no site bound to that name, and returns its
# own "404 Web Site not found" page — before the Functions host is consulted at
# all. Every route 404s, and the page talks about custom domains rather than
# routing, which sends you to host.json and the route prefix instead.
#
# Two ways to fix it, and the first is not available here:
#
#   1. Rewrite the Host at the edge, with a Cloudflare Origin Rule. Rejected:
#      the API answers `not entitled to use the HostHeader override` — it is a
#      plan entitlement, not a permission, so no token change reaches it.
#
#   2. Bind the hostname on the Azure side, which is this.
#
# NO CERTIFICATE IS BOUND, deliberately. An App Service Managed Certificate is
# issued only when the hostname resolves to the app, and behind a proxied
# Cloudflare record it resolves to Cloudflare — so managed issuance cannot
# succeed without un-proxying, which would disable the origin lock. It is also
# not needed: Cloudflare connects to the origin at its azurewebsites.net name
# and receives the platform's own wildcard certificate, so the TLS leg is
# already valid. Only the HTTP Host needed fixing.
#
# Verification is the asuid TXT record below rather than a CNAME check, because
# a CNAME check follows DNS to Cloudflare and fails for the same reason.
# =============================================================================
# Full name under v5, same as the CNAME above.
resource "cloudflare_dns_record" "azure_functions_domain_verification" {
  zone_id = var.cloudflare_zone_id
  name    = "asuid.api-azure.${var.domain}"
  content = azurerm_function_app_flex_consumption.hcw.custom_domain_verification_id
  type    = "TXT"
  ttl     = 300
  comment = "Azure custom-domain ownership proof for the Functions origin"
}

resource "azurerm_app_service_custom_hostname_binding" "api" {
  hostname            = "api-azure.${var.domain}"
  app_service_name    = azurerm_function_app_flex_consumption.hcw.name
  resource_group_name = azurerm_resource_group.app["web"].name

  # Azure reads the TXT record at bind time, so it has to exist first. The
  # dependency is not inferable from the arguments above.
  depends_on = [cloudflare_dns_record.azure_functions_domain_verification]
}

resource "cloudflare_ruleset" "origin_secret" {
  count = var.cloudflare_origin_secret == "" ? 0 : 1

  zone_id = var.cloudflare_zone_id
  name    = "Origin secret for the Azure Functions origin"
  kind    = "zone"
  phase   = "http_request_late_transform"

  # v5 SHAPE, and all three levels changed. `rules` is a list ATTRIBUTE rather
  # than repeated blocks; `action_parameters` is an attribute; and `headers` is
  # a MAP KEYED BY HEADER NAME, so the v4 `name = "x-hcw-origin-secret"` field
  # becomes the map key and disappears from the object.
  rules = [
    {
      action      = "rewrite"
      description = "Stamp x-hcw-origin-secret on requests proxied to the Functions origin"
      enabled     = true
      # Scoped to the Functions hostname rather than the whole zone: the Static
      # Web App shares this zone and has no use for the header, and a secret is
      # safest where it is not sent to things that do not need it.
      expression = "(http.host eq \"api-azure.${var.domain}\")"

      action_parameters = {
        headers = {
          "x-hcw-origin-secret" = {
            operation = "set"
            value     = var.cloudflare_origin_secret
          }
        }
      }
    }
  ]
}
