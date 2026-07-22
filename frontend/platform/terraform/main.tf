# =============================================================================
# main.tf — HCW K8s Infrastructure
# Manages: SSH key registration + Cloudflare DNS
#
# NOTE: hostinger_vps resource is intentionally omitted.
# The Hostinger Terraform provider v0.1.22 does not support import of existing
# VPS instances. The KVM4 VPS (ID: 939861) is managed directly via the
# Hostinger panel. Its IP is stored as var.vps_ipv4 in TF Cloud.
#
# What Terraform manages here:
#   - hostinger_vps_ssh_key  — deploy key registered in Hostinger account
#   - cloudflare_record      — all DNS A records for hybridcloudworks.com
# =============================================================================

locals {
  # Public subdomains: Cloudflare proxy ON (DDoS protection + CDN)
  proxied_subdomains = ["api", "auth"]

  # Admin subdomains: proxy OFF (cert-manager DNS-01 requires direct DNS)
  direct_subdomains = ["argocd", "monitoring", "vault", "k8s"]
}

# =============================================================================
# SSH Key — registered in Hostinger account for VPS access
# Public key value is stored as TF Cloud workspace variable: ssh_public_key
# Private key stays on operator machine only (~/.ssh/hybridcloudworks_deploy)
# =============================================================================
resource "hostinger_vps_ssh_key" "deploy_key" {
  name = "hybridcloudworks-deploy-key"
  key  = var.ssh_public_key
}

# =============================================================================
# Cloudflare DNS — all subdomains for hybridcloudworks.com
# IP address sourced from TF Cloud workspace variable: vps_ipv4
# allow_overwrite=true lets Terraform take ownership of any pre-existing records
# =============================================================================

# Root apex record
resource "cloudflare_record" "root" {
  zone_id         = var.cloudflare_zone_id
  name            = "@"
  content         = var.vps_ipv4
  type            = "A"
  proxied         = true
  ttl             = 1
  allow_overwrite = true
}

# Public subdomains — Cloudflare proxy ON
resource "cloudflare_record" "proxied" {
  for_each        = toset(local.proxied_subdomains)
  zone_id         = var.cloudflare_zone_id
  name            = each.value
  content         = var.vps_ipv4
  type            = "A"
  proxied         = true
  ttl             = 1
  allow_overwrite = true
}

# Admin subdomains — Cloudflare proxy OFF
# cert-manager DNS-01 challenge requires direct DNS resolution
resource "cloudflare_record" "direct" {
  for_each        = toset(local.direct_subdomains)
  zone_id         = var.cloudflare_zone_id
  name            = each.value
  content         = var.vps_ipv4
  type            = "A"
  proxied         = false
  ttl             = 300
  allow_overwrite = true
}
