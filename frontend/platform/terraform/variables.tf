# =============================================================================
# variables.tf — HCW K8s Infrastructure
# All sensitive values are set as workspace variables in HCP Terraform Cloud
# Org: HybridCloudWorks | Workspace: hybridcloudworks-infra
#
# Variable names here MUST match TF Cloud workspace variable keys exactly.
# =============================================================================

# -----------------------------------------------------------------------------
# Hostinger VPS
# -----------------------------------------------------------------------------
variable "hostinger_api_token" {
  description = "Hostinger API bearer token"
  type        = string
  sensitive   = true
}

variable "vps_id" {
  description = "Existing Hostinger KVM4 VPS numeric ID (used for terraform import)"
  type        = string
}

variable "vps_ipv4" {
  description = "Existing KVM4 VPS public IPv4 address"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key content registered in Hostinger for VPS access"
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Cloudflare DNS
# -----------------------------------------------------------------------------
variable "cloudflare_api_token" {
  description = "Cloudflare API token — Zone:Read + DNS:Edit scoped to hybridcloudworks.com"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for hybridcloudworks.com"
  type        = string
}

# -----------------------------------------------------------------------------
# Domain
# -----------------------------------------------------------------------------
variable "domain" {
  description = "Base domain for all services"
  type        = string
  default     = "hybridcloudworks.com"
}
