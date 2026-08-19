#requires -Version 7.0
<#
.SYNOPSIS
  Sets every variable the hybridcloudworks-azure workspace needs, in HCP
  Terraform, idempotently.

.DESCRIPTION
  Twelve values stand between a clean `terraform validate` and a plan that
  reaches Azure: four Environment variables that authenticate the run, and
  eight Terraform variables the configuration declares with no default. Setting
  them by hand in the UI is twelve forms, each with a category toggle and a
  sensitive checkbox, and a mistake on any one produces a failure that names
  something else.

  What the two categories mean, because the UI does not say and picking wrong
  is the most common error here:

    Environment  - exported as an environment variable into the run's shell.
                   This is how the azurerm provider and HCP Terraform's own
                   dynamic-credentials machinery are configured. ARM_* and
                   TFC_AZURE_* are read from the process environment, never
                   from HCL, so they MUST be this category. Set as Terraform
                   variables they are silently ignored and the run fails
                   claiming no credentials were supplied.
    Terraform    - passed to the configuration as `var.<name>`. Everything
                   declared in infra/variables.tf.

  Idempotent: existing variables are updated in place, missing ones created.
  A sensitive variable's value cannot be read back from the API, so this script
  never compares values — it writes what you give it and reports create vs
  update. Re-running with the same inputs is a no-op in effect.

  NO VALUE IS EVER PRINTED. Sensitive inputs are read as SecureString, and the
  summary shows key names and outcomes only. Nothing is written to disk.

.PARAMETER Organization
  HCP Terraform organization. Default: HybridCloudWorks.

.PARAMETER Workspace
  HCP Terraform workspace. Default: hybridcloudworks-azure.

.PARAMETER TfcToken
  API token for HCP Terraform, as a SecureString. Omit it and the script reads
  $env:TFE_TOKEN, then ~/.terraform.d/credentials.tfrc.json (what
  `terraform login` writes), and prompts only if both are absent.

.PARAMETER TerraformClientId
  Client id of id-hcw-terraform, printed by bootstrap-terraform-oidc.ps1 and
  recorded in its report. Becomes TFC_AZURE_RUN_CLIENT_ID.

.PARAMETER TenantId
  Entra tenant. Becomes both ARM_TENANT_ID (Environment) and entra_tenant_id
  (Terraform) — the same value in two categories, because one configures the
  provider and the other is consumed by the configuration.

.PARAMETER SubscriptionApp
  Application landing zone (display name sub-app-hcwsite-prod-scus). Also becomes
  ARM_SUBSCRIPTION_ID, the default provider's subscription.

.PARAMETER SubscriptionMgmt
  Platform Management (sub-plat-mgmt-prod-scus).

.PARAMETER SubscriptionConn
  Platform Connectivity (sub-plat-conn-prod-scus).

.PARAMETER EntraApiAudience
  Audience the Functions host validates access tokens against, e.g.
  api://<api-app-id>. Must match VITE_ENTRA_API_SCOPE's app id or every
  authenticated call is rejected.

.PARAMETER BudgetAlertEmail
  Where budget threshold notifications go.

.PARAMETER CloudflareZoneId
  Cloudflare zone for the DNS records in main.tf.

.PARAMETER CloudflareApiToken
  Cloudflare API token, as a SecureString. Prompted if omitted.

.PARAMETER WhatIf
  Resolve the workspace and report what would be created or updated, without
  writing anything.

.EXAMPLE
  ./scripts/set-tfc-variables.ps1 `
      -TerraformClientId 00000000-0000-0000-0000-000000000000 `
      -TenantId 00000000-0000-0000-0000-000000000000 `
      -SubscriptionApp 00000000-0000-0000-0000-000000000000 `
      -SubscriptionMgmt 00000000-0000-0000-0000-000000000000 `
      -SubscriptionConn 00000000-0000-0000-0000-000000000000 `
      -EntraApiAudience api://00000000-0000-0000-0000-000000000000 `
      -BudgetAlertEmail ops@example.com `
      -CloudflareZoneId 0000000000000000000000000000000000 `
      -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $Organization = 'HybridCloudWorks',
  [string] $Workspace = 'hybridcloudworks-azure',
  [securestring] $TfcToken,

  [Parameter(Mandatory = $true)][string] $TerraformClientId,
  [Parameter(Mandatory = $true)][string] $TenantId,
  [Parameter(Mandatory = $true)][string] $SubscriptionApp,
  [Parameter(Mandatory = $true)][string] $SubscriptionMgmt,
  [Parameter(Mandatory = $true)][string] $SubscriptionConn,
  [Parameter(Mandatory = $true)][string] $EntraApiAudience,
  [Parameter(Mandatory = $true)][string] $BudgetAlertEmail,
  [Parameter(Mandatory = $true)][string] $CloudflareZoneId,
  [securestring] $CloudflareApiToken
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Message) Write-Host "`n=== $Message" -ForegroundColor Cyan }
function Write-Ok { param($Message) Write-Host "  [ok]     $Message" -ForegroundColor Green }
function Write-Act { param($Message) Write-Host "  [write]  $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "  $Message" -ForegroundColor DarkGray }

function Stop-WithGuidance {
  param([string] $Problem, [string[]] $Fix)
  Write-Host "`n  [stop] $Problem" -ForegroundColor Red
  foreach ($line in $Fix) { Write-Host "         $line" -ForegroundColor Red }
  exit 1
}

# ---------------------------------------------------------------------------
# Token resolution, cheapest source first. `terraform login` already wrote a
# credentials file for most operators, so asking them to paste a token they
# have already stored is friction that also encourages pasting it into shell
# history.
# ---------------------------------------------------------------------------
# ConvertTo-SecureString -AsPlainText is flagged by PSScriptAnalyzer as
# exposing secure information. It does not here: both sources are ALREADY
# plaintext — an environment variable and a file terraform login wrote in the
# clear. Converting adds the protection SecureString gives downstream; it does
# not create an exposure that was not already there. The alternative, refusing
# to read the token terraform login already stored, would push operators to
# paste it on a command line instead, which is strictly worse because it lands
# in shell history.
function Resolve-TfcToken {
  param([securestring] $Supplied)

  if ($Supplied) {
    Write-Info 'Token: -TfcToken parameter'
    return $Supplied
  }
  if ($env:TFE_TOKEN) {
    Write-Info 'Token: $env:TFE_TOKEN'
    return (ConvertTo-SecureString $env:TFE_TOKEN -AsPlainText -Force)
  }

  $credentialsPath = Join-Path $HOME '.terraform.d/credentials.tfrc.json'
  if (Test-Path $credentialsPath) {
    try {
      $stored = (Get-Content $credentialsPath -Raw | ConvertFrom-Json).credentials.'app.terraform.io'.token
      if ($stored) {
        Write-Info "Token: $credentialsPath (written by ``terraform login``)"
        return (ConvertTo-SecureString $stored -AsPlainText -Force)
      }
    } catch {
      Write-Info "Could not parse $credentialsPath — falling through to prompt."
    }
  }

  Write-Info 'No stored token found. Create one at:'
  Write-Info '  https://app.terraform.io/app/settings/tokens'
  return (Read-Host -Prompt '  HCP Terraform API token' -AsSecureString)
}

function Invoke-Tfc {
  param(
    [Parameter(Mandatory)][string] $Method,
    [Parameter(Mandatory)][string] $Path,
    [hashtable] $Body
  )
  $headers = @{
    # The JSON:API media type is not optional here — HCP Terraform rejects
    # application/json with a 415 that does not explain itself.
    'Content-Type' = 'application/vnd.api+json'
  }
  $arguments = @{
    Method         = $Method
    Uri            = "https://app.terraform.io/api/v2$Path"
    Headers        = $headers
    Authentication = 'Bearer'
    Token          = $script:token
  }
  if ($Body) { $arguments.Body = ($Body | ConvertTo-Json -Depth 10) }
  return Invoke-RestMethod @arguments
}

# ===========================================================================
# 1. Resolve the workspace
# ===========================================================================
Write-Step 'Workspace'
$script:token = Resolve-TfcToken -Supplied $TfcToken

try {
  $workspaceResponse = Invoke-Tfc -Method GET -Path "/organizations/$Organization/workspaces/$Workspace"
} catch {
  Stop-WithGuidance "Could not read workspace $Organization/$Workspace." @(
    'Check the organization and workspace names — both are case-sensitive.',
    'A 401 means the token is wrong or expired; a 404 means the name is.',
    "Underlying error: $($_.Exception.Message)"
  )
}

$workspaceId = $workspaceResponse.data.id
Write-Ok "$Organization/$Workspace ($workspaceId)"

# The project the workspace belongs to is the value the bootstrap script had to
# guess for the federated credential subject. Surfacing it here turns an
# AADSTS70021 investigation into a glance, because this is the one place the
# real name is available without opening the UI.
$projectId = $workspaceResponse.data.relationships.project.data.id
if ($projectId) {
  try {
    $project = Invoke-Tfc -Method GET -Path "/projects/$projectId"
    $projectName = $project.data.attributes.name
    Write-Ok "Project: $projectName"
    Write-Info 'This is the value the federated credential subject must contain.'
    Write-Info 'If it is not "Default Project", re-run bootstrap-terraform-oidc.ps1'
    Write-Info "with -TfcProject '$projectName' or every plan fails AADSTS70021."
  } catch {
    Write-Info 'Could not read the project name (token may lack project scope).'
  }
}

# ===========================================================================
# 2. The variables
# ===========================================================================
# ARM_* and TFC_AZURE_* are category 'env' because the provider and HCP
# Terraform's dynamic-credentials machinery read them from the process
# environment. As Terraform variables they are accepted, ignored, and the run
# fails saying no credentials were supplied.
$plainCloudflareToken = if ($CloudflareApiToken) {
  $CloudflareApiToken
} elseif ($WhatIfPreference) {
  # A dry run writes nothing, so do not ask the operator to produce a secret
  # it will never use. The empty SecureString keeps the pipeline type-safe.
  [securestring]::new()
} else {
  Read-Host -Prompt '  Cloudflare API token' -AsSecureString
}

$variables = @(
  # --- Environment: how the run authenticates -----------------------------
  @{ key = 'TFC_AZURE_PROVIDER_AUTH'; value = 'true'; category = 'env'; sensitive = $false
    description = 'Switches the workspace to dynamic provider credentials' }
  @{ key = 'TFC_AZURE_RUN_CLIENT_ID'; value = $TerraformClientId; category = 'env'; sensitive = $false
    description = 'Client id of id-hcw-terraform, from bootstrap-terraform-oidc.ps1' }
  # Sensitive to match their Terraform-category twins below: the same value
  # must not be hidden in one category and readable in the other, or the
  # "keep IDs out of logs" intent (variables.tf) is defeated by the copy.
  @{ key = 'ARM_TENANT_ID'; value = $TenantId; category = 'env'; sensitive = $true
    description = 'Entra tenant for the OIDC token exchange' }
  @{ key = 'ARM_SUBSCRIPTION_ID'; value = $SubscriptionApp; category = 'env'; sensitive = $true
    description = 'Default provider subscription; aliases override it per-resource' }

  # --- Terraform: what the configuration declares -------------------------
  @{ key = 'subscription_app'; value = $SubscriptionApp; category = 'terraform'; sensitive = $true
    description = 'Application landing zone (sub-app-hcwsite-prod-scus)' }
  @{ key = 'subscription_mgmt'; value = $SubscriptionMgmt; category = 'terraform'; sensitive = $true
    description = 'Platform Management (sub-plat-mgmt-prod-scus)' }
  @{ key = 'subscription_conn'; value = $SubscriptionConn; category = 'terraform'; sensitive = $true
    description = 'Platform Connectivity (sub-plat-conn-prod-scus)' }
  @{ key = 'entra_tenant_id'; value = $TenantId; category = 'terraform'; sensitive = $true
    description = 'Same tenant as ARM_TENANT_ID, consumed by the configuration' }
  @{ key = 'entra_api_audience'; value = $EntraApiAudience; category = 'terraform'; sensitive = $false
    description = 'Audience the Functions host validates access tokens against' }
  @{ key = 'budget_alert_email'; value = $BudgetAlertEmail; category = 'terraform'; sensitive = $false
    description = 'Budget threshold notification recipient' }
  @{ key = 'cloudflare_zone_id'; value = $CloudflareZoneId; category = 'terraform'; sensitive = $false
    description = 'Cloudflare zone holding the DNS records in main.tf' }
  @{ key = 'cloudflare_api_token'
    value       = [System.Net.NetworkCredential]::new('', $plainCloudflareToken).Password
    category    = 'terraform'; sensitive = $true
    description = 'Cloudflare API token for the DNS records' }
)

# ===========================================================================
# 3. Write them
# ===========================================================================
Write-Step "Variables ($($variables.Count))"

$existing = @{}
foreach ($item in (Invoke-Tfc -Method GET -Path "/workspaces/$workspaceId/vars").data) {
  # Key alone is not unique — the same name can exist in both categories, and
  # that is exactly the case here for the tenant id.
  $existing["$($item.attributes.category)/$($item.attributes.key)"] = $item.id
}

$created = 0
$updated = 0

foreach ($variable in $variables) {
  $lookup = "$($variable.category)/$($variable.key)"
  $existingId = $existing[$lookup]
  $label = "$($variable.key) [$($variable.category)$(if ($variable.sensitive) { ', sensitive' })]"

  $attributes = @{
    key         = $variable.key
    value       = $variable.value
    category    = $variable.category
    sensitive   = $variable.sensitive
    description = $variable.description
    hcl         = $false
  }

  if ($existingId) {
    if ($PSCmdlet.ShouldProcess($label, 'update workspace variable')) {
      Invoke-Tfc -Method PATCH -Path "/workspaces/$workspaceId/vars/$existingId" -Body @{
        data = @{ id = $existingId; type = 'vars'; attributes = $attributes }
      } | Out-Null
      Write-Act "updated  $label"
      $updated++
    } else {
      Write-Act "would update  $label"
    }
  } else {
    if ($PSCmdlet.ShouldProcess($label, 'create workspace variable')) {
      Invoke-Tfc -Method POST -Path "/workspaces/$workspaceId/vars" -Body @{
        data = @{ type = 'vars'; attributes = $attributes }
      } | Out-Null
      Write-Act "created  $label"
      $created++
    } else {
      Write-Act "would create  $label"
    }
  }
}

# ===========================================================================
# 4. What is still missing
# ===========================================================================
# Two values this script deliberately does not set, because neither belongs in
# a Terraform workspace.
Write-Step 'Not set by this script'
Write-Info 'TF_API_TOKEN  - a GitHub secret, not a workspace variable. It is how'
Write-Info '                deploy-infra.yml authenticates TO HCP Terraform, so'
Write-Info '                storing it here would be circular.'
Write-Info 'Key Vault     - the five runtime application secrets are seeded'
Write-Info '                out-of-band and must never transit Terraform state.'
Write-Info '                See Variables-And-Secrets in the wiki.'

Write-Step 'Next'
Write-Info 'Verify with a speculative plan before any apply:'
Write-Info ''
Write-Info '  cd infra && terraform login && terraform plan'
Write-Info ''
Write-Info 'A plan that authenticates and shows resources to create is success.'

if ($WhatIfPreference) {
  Write-Host "`n  Dry run — nothing was written.`n" -ForegroundColor Green
} else {
  Write-Host "`n  Done: $created created, $updated updated.`n" -ForegroundColor Green
}

exit 0
