#requires -Version 7.0
<#
.SYNOPSIS
  Sets every GitHub-side variable and secret the deploy workflows need,
  idempotently — the GitHub counterpart to set-tfc-variables.ps1.

.DESCRIPTION
  The GitHub values arrive in two waves, and the script handles both:

    Wave 1 - known BEFORE the first terraform apply: tenant and application
             subscription. These two are inputs TO Terraform, not products of
             it, which is the test for belonging in this wave.
    Wave 2 - everything that is a Terraform output, read from the workspace's
             applied state via the HCP Terraform API (the same token
             set-tfc-variables.ps1 resolves): CLIENT_ID (client_id),
             APP_HOSTNAME (function_hostname), FUNCTIONS_URL (the same
             hostname plus the /api route prefix), RESOURCE_GROUP
             (web_resource_group), FUNCTIONS_STORAGE_ACCOUNT
             (functions_storage_account), and the COSMOS_ENDPOINT secret
             (cosmos_endpoint). RESOURCE_GROUP and FUNCTIONS_STORAGE_ACCOUNT
             are deliberately NOT wave-1 parameters even though their values
             are predictable from infra/ defaults: a hardcoded copy drifts
             silently when the code changes, an output cannot — and their
             only consumer (deploy-functions.yml) cannot run before the
             first apply anyway. "Re-run this script after any apply that
             changes outputs" is the entire wave-2 runbook.

  Before the first apply, wave 2 is reported as pending rather than failing:
  a workspace with no state is the expected starting condition, not an error.

  Deliberately NOT set here:

    AZURE_STATIC_WEB_APPS_API_TOKEN - the Variables-And-Secrets standard rules
             this a placement error as a stored secret: correct handling is
             fetching it at deploy time (az staticwebapp secrets list) after
             azure/login, storing nothing.
    COSMOS_KEY - must stay unset (CHECKLIST §7); provisioning it would switch
             clients onto a key path the account rejects.
    VITE_ENTRA_* - Entra app-registration values, produced by the manual
             registration step, not derivable from any state this script can
             reach.
    DOCKERHUB_* and the GitHub App - CI-runner prerequisites for a runner
             that is deliberately disabled (ci_runner_enabled = false).
    TF_API_TOKEN - opt-in via -SetTfApiToken, because it copies the token
             this script authenticates with into a repository secret. The
             wiki calls for a TEAM token there, so the switch is only correct
             when the resolved token is one; the script says so loudly.

  Idempotent: gh variable/secret set are upserts. Variable values are printed
  (they are public identifiers); secret values never are.

.PARAMETER Repository
  GitHub repository, owner/name. Default: HybridCloudWorks/HCW-HybridCloudWorks.

.PARAMETER Organization
  HCP Terraform organization, for the wave-2 state read. Default: HybridCloudWorks.

.PARAMETER Workspace
  HCP Terraform workspace. Default: hybridcloudworks-azure.

.PARAMETER TfcToken
  HCP Terraform API token as a SecureString, for reading state outputs. Omit
  it and the script reads $env:TFE_TOKEN, then ~/.terraform.d/credentials.tfrc.json,
  and skips wave 2 with a notice if neither exists.

.PARAMETER TenantId
  Entra tenant GUID. Becomes the TENANT_ID repository variable.

.PARAMETER SubscriptionApp
  Application landing zone subscription GUID (sub-app-hcwsite-prod-scus).
  Becomes SUBSCRIPTION_ID — the subscription azure/login targets, which is
  where the Function App lives.

.PARAMETER SetTfApiToken
  Also write the resolved HCP Terraform token to the TF_API_TOKEN repository
  secret (consumed by deploy-infra.yml). Off by default — see DESCRIPTION.

.PARAMETER WhatIf
  Report what would be set without writing anything.

.EXAMPLE
  # Before the first apply — wave 1 lands, wave 2 reports pending.
  ./scripts/set-github-variables.ps1 `
      -TenantId 00000000-0000-0000-0000-000000000000 `
      -SubscriptionApp 00000000-0000-0000-0000-000000000000

.EXAMPLE
  # No arguments. The tenant and application subscription are read from the
  # Azure CLI sign-in; anything ambiguous is offered as a numbered list.
  ./scripts/set-github-variables.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $Repository = 'HybridCloudWorks/HCW-HybridCloudWorks',
  [string] $Organization = 'HybridCloudWorks',
  [string] $Workspace = 'hybridcloudworks-azure',
  [securestring] $TfcToken,

  # Optional. Omit them and they are discovered from the Azure CLI sign-in —
  # see lib/deploy-console.ps1 for why nothing here is a required flag.
  [string] $TenantId,
  [string] $SubscriptionApp,
  [switch] $SetTfApiToken
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/deploy-console.ps1')

# gh writes progress to stderr, which PowerShell 7 escalates under 'Stop'.
# Judge success by exit code, same pattern as Invoke-Az in the bootstrap.
function Invoke-Gh {
  param([Parameter(Mandatory)][string[]] $Arguments, [string] $StdIn, [switch] $AllowFailure)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($PSBoundParameters.ContainsKey('StdIn')) {
      $output = $StdIn | & gh @Arguments 2>&1
    } else {
      $output = & gh @Arguments 2>&1
    }
  } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) { return $null }
    throw "gh $($Arguments -join ' ') failed:`n$output"
  }
  return ($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
}

# Same resolution ladder as set-tfc-variables.ps1, with one difference: a
# missing token is not fatal here. Wave 1 needs no TFC access at all, so the
# script degrades to wave-1-only rather than stopping.
#
# ConvertTo-SecureString -AsPlainText is flagged by PSScriptAnalyzer as
# exposing secure information. It does not here: both sources are ALREADY
# plaintext — an environment variable and a file terraform login wrote in the
# clear. Converting adds protection downstream; refusing to read the stored
# token would push operators to paste it on a command line instead, which is
# strictly worse. Same accepted trade-off as set-tfc-variables.ps1.
function Resolve-TfcToken {
  param([securestring] $Supplied)
  if ($Supplied) { Write-Info 'TFC token: -TfcToken parameter'; return $Supplied }
  if ($env:TFE_TOKEN) {
    Write-Info 'TFC token: $env:TFE_TOKEN'
    return (ConvertTo-SecureString $env:TFE_TOKEN -AsPlainText -Force)
  }
  $credentialsPath = Join-Path $HOME '.terraform.d/credentials.tfrc.json'
  if (Test-Path $credentialsPath) {
    try {
      $stored = (Get-Content $credentialsPath -Raw | ConvertFrom-Json).credentials.'app.terraform.io'.token
      if ($stored) {
        Write-Info "TFC token: $credentialsPath (written by ``terraform login``)"
        return (ConvertTo-SecureString $stored -AsPlainText -Force)
      }
    } catch {
      Write-Info "Could not parse $credentialsPath."
    }
  }
  return $null
}

function Invoke-Tfc {
  param([Parameter(Mandatory)][string] $Path)
  return Invoke-RestMethod -Method GET -Uri "https://app.terraform.io/api/v2$Path" `
    -Headers @{ 'Content-Type' = 'application/vnd.api+json' } `
    -Authentication Bearer -Token $script:tfcToken
}

# ===========================================================================
# 1. Preflight
# ===========================================================================
Write-Step 'Preflight'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Stop-WithGuidance 'The GitHub CLI (gh) is not installed.' @(
    'Install it: https://cli.github.com', 'Then re-run this script.'
  )
}
Invoke-Gh @('auth', 'status') | Out-Null
Write-Ok 'gh authenticated'

Invoke-Gh @('repo', 'view', $Repository, '--json', 'nameWithOwner') | Out-Null
Write-Ok "Repository: $Repository"

# ForEach-Object rather than .name: the repository legitimately has no secrets
# at all today, and an empty result must read as "none" rather than throwing.
$existingVariables = @(Invoke-Gh @('variable', 'list', '-R', $Repository, '--json', 'name') |
    ConvertFrom-Json | ForEach-Object { $_.name })
$existingSecrets = @(Invoke-Gh @('secret', 'list', '-R', $Repository, '--json', 'name') |
    ConvertFrom-Json | ForEach-Object { $_.name })

# ===========================================================================
# 1b. Discover the two wave-1 values
# ===========================================================================
# Both come from the Azure CLI sign-in. Neither is prompted for as a GUID
# unless Azure cannot supply it, because a hand-typed subscription id is the
# defect this script exists to stop repeating.
if (-not $TenantId -or -not $SubscriptionApp) {
  Write-Step 'Discovering the tenant and application subscription'

  if (-not (Test-AzInstalled)) {
    Stop-WithGuidance 'The Azure CLI (az) is not installed, and no values were supplied.' @(
      'Either install it (https://learn.microsoft.com/cli/azure/install-azure-cli)',
      'and sign in, or pass -TenantId and -SubscriptionApp explicitly.'
    )
  }

  $account = Invoke-Az @('account', 'show', '-o', 'json') -AllowFailure
  if (-not $account) {
    Stop-WithGuidance 'Not signed in to Azure.' @(
      'Run: az login', 'Then re-run this script.'
    )
  }

  if (-not $TenantId) {
    $TenantId = $account.tenantId
    Write-Ok "Tenant: $TenantId  (from the current sign-in)"
  }

  if (-not $SubscriptionApp) {
    $subscriptions = Get-AzSubscriptionList
    if ($subscriptions.Count -eq 0) {
      Stop-WithGuidance 'The sign-in can see no enabled subscriptions.' @(
        'Check with: az account list --all -o table'
      )
    }
    # The application landing zone: where the Function App lives, and so the
    # subscription azure/login must target. NOT a platform subscription.
    $chosen = Select-Subscription -Purpose 'Application landing zone (SUBSCRIPTION_ID)' -Pattern 'sub-app-*' `
      -Subscriptions $subscriptions
    $SubscriptionApp = $chosen.id
  }
}

function Set-RepoVariable {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([Parameter(Mandatory)][string] $Name, [Parameter(Mandatory)][string] $Value)
  $verb = if ($existingVariables -contains $Name) { 'update' } else { 'create' }
  if ($PSCmdlet.ShouldProcess("variable $Name = $Value", "$verb repository variable")) {
    Invoke-Gh @('variable', 'set', $Name, '-R', $Repository, '--body', $Value) | Out-Null
    Write-Act "$verb  $Name = $Value"
  } else {
    Write-Act "would $verb  $Name = $Value"
  }
}

function Set-RepoSecret {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([Parameter(Mandatory)][string] $Name, [Parameter(Mandatory)][string] $Value)
  $verb = if ($existingSecrets -contains $Name) { 'update' } else { 'create' }
  if ($PSCmdlet.ShouldProcess("secret $Name", "$verb repository secret")) {
    # Value travels via stdin, not the argument list, so it never appears in
    # a process listing. It is never printed.
    Invoke-Gh @('secret', 'set', $Name, '-R', $Repository) -StdIn $Value | Out-Null
    Write-Act "$verb  $Name (value not shown)"
  } else {
    Write-Act "would $verb  $Name (value not shown)"
  }
}

# ===========================================================================
# 2. Wave 1 — known before the first apply
# ===========================================================================
$proceed = Confirm-Plan -Title 'About to write these repository variables' -Force:$WhatIfPreference -Order @(
  'Repository', 'TENANT_ID', 'SUBSCRIPTION_ID'
) -Values @{
  'Repository'      = $Repository
  'TENANT_ID'       = $TenantId
  'SUBSCRIPTION_ID' = $SubscriptionApp
}
if (-not $proceed) { Write-Info 'Cancelled — nothing was written.'; exit 0 }

Write-Step 'Wave 1: values known before the first apply'

Set-RepoVariable -Name 'TENANT_ID' -Value $TenantId
Set-RepoVariable -Name 'SUBSCRIPTION_ID' -Value $SubscriptionApp

# ===========================================================================
# 3. Wave 2 — Terraform outputs, via the workspace's current state
# ===========================================================================
Write-Step 'Wave 2: values from the Terraform outputs'

$script:tfcToken = Resolve-TfcToken -Supplied $TfcToken
$outputs = $null

if (-not $script:tfcToken) {
  Write-Info 'No HCP Terraform token found (TFE_TOKEN, credentials.tfrc.json).'
  Write-Info 'Skipping the state read — run `terraform login` and re-run this'
  Write-Info 'script after the first apply to seed CLIENT_ID, APP_HOSTNAME,'
  Write-Info 'FUNCTIONS_URL, RESOURCE_GROUP, FUNCTIONS_STORAGE_ACCOUNT and'
  Write-Info 'COSMOS_ENDPOINT.'
} else {
  try {
    $workspaceId = (Invoke-Tfc "/organizations/$Organization/workspaces/$Workspace").data.id
    $state = Invoke-Tfc "/workspaces/$workspaceId/current-state-version?include=outputs"
    $outputs = @{}
    foreach ($item in $state.included) {
      if ($item.type -eq 'state-version-outputs') {
        $outputs[$item.attributes.name] = $item.attributes.value
      }
    }
    Write-Ok "State read: $($outputs.Count) outputs"
  } catch {
    # A workspace with no state yet returns 404 here. That is the expected
    # pre-first-apply condition, not a failure.
    Write-Info 'No state found in the workspace — expected before the first apply.'
    Write-Info 'Re-run this script after `terraform apply` succeeds; wave 2 will'
    Write-Info 'then find the outputs. Nothing to fix now.'
  }
}

if ($outputs) {
  $waveTwo = @(
    @{ output = 'client_id'; kind = 'variable'; name = 'CLIENT_ID'; transform = { param($v) $v } }
    @{ output = 'function_hostname'; kind = 'variable'; name = 'APP_HOSTNAME'; transform = { param($v) $v } }
    # The route prefix is load-bearing: a base without /api 404s uniformly
    # (CHECKLIST §6, VITE_AZURE_FUNCTIONS_URL).
    @{ output = 'function_hostname'; kind = 'variable'; name = 'FUNCTIONS_URL'; transform = { param($v) "https://$v/api" } }
    @{ output = 'web_resource_group'; kind = 'variable'; name = 'RESOURCE_GROUP'; transform = { param($v) $v } }
    @{ output = 'functions_storage_account'; kind = 'variable'; name = 'FUNCTIONS_STORAGE_ACCOUNT'; transform = { param($v) $v } }
    @{ output = 'cosmos_endpoint'; kind = 'secret'; name = 'COSMOS_ENDPOINT'; transform = { param($v) $v } }
  )
  foreach ($entry in $waveTwo) {
    $raw = $outputs[$entry.output]
    if ($null -eq $raw -or $raw -eq '') {
      Write-Info "Output '$($entry.output)' not present in state — $($entry.name) left unchanged."
      continue
    }
    $value = & $entry.transform $raw
    if ($entry.kind -eq 'variable') {
      Set-RepoVariable -Name $entry.name -Value $value
    } else {
      Set-RepoSecret -Name $entry.name -Value $value
    }
  }
}

# ===========================================================================
# 4. TF_API_TOKEN — opt-in only
# ===========================================================================
if ($SetTfApiToken) {
  Write-Step 'TF_API_TOKEN (opt-in)'
  if (-not $script:tfcToken) {
    Write-Info 'No token resolved, so there is nothing to store. Skipped.'
  } else {
    Write-Info 'Storing the resolved HCP Terraform token as the TF_API_TOKEN secret.'
    Write-Info 'The wiki requires a TEAM token here, so it survives any one user'
    Write-Info 'leaving — if what terraform login stored is your USER token, create'
    Write-Info 'a team token in HCP Terraform and re-run with it in $env:TFE_TOKEN.'
    $plain = [System.Net.NetworkCredential]::new('', $script:tfcToken).Password
    Set-RepoSecret -Name 'TF_API_TOKEN' -Value $plain
  }
}

# ===========================================================================
# 5. What this script deliberately leaves alone
# ===========================================================================
Write-Step 'Not set by this script'
Write-Info 'AZURE_STATIC_WEB_APPS_API_TOKEN - fetch at deploy time after azure/login'
Write-Info '                (az staticwebapp secrets list); storing it is the'
Write-Info '                placement error Variables-And-Secrets documents.'
Write-Info 'COSMOS_KEY    - must stay unset (CHECKLIST §7).'
Write-Info 'VITE_ENTRA_*  - from the manual Entra app registrations.'
Write-Info 'DOCKERHUB_*   - CI-runner prerequisites; the runner is disabled.'

if ($WhatIfPreference) {
  Write-Host "`n  Dry run — nothing was written.`n" -ForegroundColor Green
} else {
  Write-Host "`n  Done.`n" -ForegroundColor Green
}

exit 0
