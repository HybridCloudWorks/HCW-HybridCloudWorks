# =============================================================================
# backend.tf — HCP Terraform backend for the Azure platform
# Org: hcw | Project: Site | Workspace: hcw-azure
#
# The organization is `hcw`, not `HybridCloudWorks` — that was an assumption
# in this file until 2026-08-19, and it made every run fail before it started
# (the API 404s on an organization that does not exist).
#
# The workspace is `hcw-azure` in the `Site` project, created empty for this
# configuration. There is one other workspace in this organization, `HCW`,
# and this configuration MUST NOT point at it: it holds 85 GCP/Firebase/VPS
# resources belonging to the saulpatinojr/Personal-Site_HCW repository, so a
# plan from here would propose destroying all of them.
#
# The project name is not cosmetic. It is a segment of the OIDC subject the
# federated credentials on id-hcw-terraform must match exactly, so moving this
# workspace between projects breaks authentication with AADSTS70021 until
# scripts/bootstrap-terraform-oidc.ps1 is re-run with the new -TfcProject.
# =============================================================================
terraform {
  cloud {
    organization = "hcw"
    workspaces {
      name = "hcw-azure"
    }
  }
}
