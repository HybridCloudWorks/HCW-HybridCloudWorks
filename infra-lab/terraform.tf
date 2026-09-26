# =============================================================================
# terraform.tf — Terraform and provider requirements for the lab host
# Backend (HCP Terraform) is declared in backend.tf; provider blocks are in
# providers.tf.
# =============================================================================
terraform {
  # Upper-bounded on the major, like infra/providers.tf (T-725), and one minor
  # higher at the floor: the `import` block in main.tf takes its id from a
  # variable, and an expression there is accepted from Terraform 1.6.0 on
  # ("The `import` block `id` field now accepts expressions referring to other
  # values", 1.6.0 CHANGELOG). 1.5 accepts only a literal string, which would
  # mean committing the owner's VM id.
  required_version = "~> 1.6"

  required_providers {
    # Pinned exactly, not with `~>`. The provider is pre-1.0, so a patch
    # release may change behaviour, and the resource it manages is a server
    # the owner already pays for: plan, data_center_id and password are
    # ForceNew (a change is cancel-subscription then purchase) and a
    # template_id change reinstalls the disk. A provider upgrade is therefore
    # its own pull request, whose plan is read against the counts in
    # infra-lab/README.md before anything else lands. 0.1.23 is the current
    # release (registry.terraform.io, published 2026-09-07); ADR 0032 names
    # 0.1.22, the release current when it was drafted.
    hostinger = {
      source  = "hostinger/hostinger"
      version = "0.1.23"
    }
    # Same constraint as infra/providers.tf, so the record resource type and
    # its v5 schema are the ones infra/frontend.tf already uses.
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24"
    }
  }
}
