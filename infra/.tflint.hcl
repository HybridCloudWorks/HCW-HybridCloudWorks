# tflint ruleset for infra/ — run by .github/workflows/iac-validate.yml and
# locally with `tflint --init && tflint` from this directory.

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "azurerm" {
  enabled = true
  version = "0.28.0"
  source  = "github.com/terraform-linters/tflint-ruleset-azurerm"
}

# The variable names in variables.tf must match HCP Terraform Cloud workspace
# variable keys exactly (see the header comment there), so naming-convention
# enforcement stays advisory rather than blocking renames CI would force.
rule "terraform_naming_convention" {
  enabled = false
}
