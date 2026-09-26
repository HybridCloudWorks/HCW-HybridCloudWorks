# tflint ruleset for infra-lab/ — run by .github/workflows/iac-validate.yml and
# locally with `tflint --init && tflint` from this directory.
#
# The terraform plugin only: there is no tflint ruleset for the hostinger or
# cloudflare providers, and the azurerm one infra/.tflint.hcl loads has nothing
# to check here.

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# Same reason as infra/.tflint.hcl: variable names must match the hcw-lab
# workspace variable keys exactly, so naming enforcement stays advisory.
rule "terraform_naming_convention" {
  enabled = false
}
