# =============================================================================
# backend.tf — HCP Terraform backend for the lab host (#661, ADR 0032)
# Org: hcw | Workspace: hcw-lab
#
# A separate workspace from hcw-azure on purpose (ADR 0032 decision 1): lab
# state and production state never meet. Nothing here reads hcw-azure outputs
# and nothing in infra/ reads this workspace, so a provider error or a mistaken
# destroy in the lab cannot surface in the production run queue, and the
# Hostinger token never sits beside the production Azure credential.
#
# The workspace is created by the owner in the HCP Terraform UI, not by this
# file: VCS-driven from this repository, working directory `infra-lab`,
# auto-apply OFF. Auto-apply must stay off. The first plan adopts a server the
# owner already pays for, and the only safe reading of that plan is a human one
# (infra-lab/README.md, step 4, lists the counts that must appear).
#
# The organization is `hcw`, the same one infra/backend.tf names. Do not point
# this at `hcw-azure` or at the unrelated `HCW` workspace: both hold resources
# this configuration does not declare, and a plan against either would propose
# destroying them.
# =============================================================================
terraform {
  cloud {
    organization = "hcw"
    workspaces {
      name = "hcw-lab"
    }
  }
}
