# =============================================================================
# providers.tf — provider configuration for the lab host
#
# Both credentials are sensitive workspace variables in hcw-lab (Required
# inputs §4.7) and never repository values. Neither provider here has an OIDC
# path from HCP Terraform, which is why these are tokens rather than the
# dynamic credentials infra/providers.tf uses for Azure.
# =============================================================================

provider "hostinger" {
  api_token = var.hostinger_api_token
}

# A different token from the hcw-azure one of the same name: Zone:Read +
# DNS:Edit on hybridcloudworks.com and nothing else (no Transform Rules, no
# Rulesets), so this workspace cannot touch the origin rules infra/ owns.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
