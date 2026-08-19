#requires -Version 7.0
<#
.SYNOPSIS
  Sets every variable the hcw-azure workspace needs, in HCP
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
  HCP Terraform organization. Read from infra/backend.tf when omitted, because
  that file is what `terraform` itself obeys — a second copy in this script
  could seed a workspace the configuration does not use.

.PARAMETER Workspace
  HCP Terraform workspace. Read from infra/backend.tf when omitted. If it does
  not exist yet, the script offers to create it, asking which project it
  belongs in — the project name is a segment of the OIDC subject the federated
  credentials must match. An existing workspace that already holds resources
  requires an explicit confirmation, because adopting another configuration's
  workspace makes the first plan propose destroying its contents.

.PARAMETER Project
  HCP Terraform project, used only when the workspace has to be created.
  Offered as a numbered list when omitted. An existing workspace keeps the
  project it already has — moving it would change the OIDC subject and break
  authentication until the bootstrap is re-run.

.PARAMETER TfcToken
  API token for HCP Terraform, as a SecureString. Omit it and the script reads
  $env:TFE_TOKEN, then the credentials file `terraform login` writes
  (%APPDATA%\terraform.d\credentials.tfrc.json on Windows,
  ~/.terraform.d/credentials.tfrc.json elsewhere), and prompts only if both
  are absent.

.PARAMETER TerraformClientId
  Client id of id-hcw-terraform, printed by bootstrap-terraform-oidc.ps1 and
  recorded in its report. Becomes TFC_AZURE_RUN_CLIENT_ID.

.PARAMETER TenantId
  Entra tenant. Becomes both ARM_TENANT_ID (Environment) and entra_tenant_id
  (Terraform) — the same value in two categories, because one configures the
  provider and the other is consumed by the configuration.

.PARAMETER SubscriptionApp
  Application landing zone (sub-app-site-prod-scus). Also becomes
  ARM_SUBSCRIPTION_ID, the default provider's subscription.

.PARAMETER SubscriptionMgmt
  Platform Management (sub-plat-mgmt-prod-scus).

.PARAMETER SubscriptionConn
  Platform Connectivity (sub-plat-conn-prod-scus).

.PARAMETER EntraApiAudience
  Audience the Functions host validates access tokens against, e.g.
  api://<api-app-id>. Must match VITE_ENTRA_API_SCOPE's app id or every
  authenticated call is rejected. Discovered from the app registrations this
  account owns; if none exposes an application ID URI, the script offers to
  create the API registration (separate from the SPA, per DECISION 3) with the
  access_as_admin scope and the Admin and LabAgent app roles.

.PARAMETER EntraAppDisplayName
  Display name used when creating that registration. Default: HCWSite API.

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
  # No arguments. The Terraform identity, tenant and subscriptions come from
  # Azure; the Cloudflare zone is picked from the zones the token can see; the
  # rest is prompted for once and shown for confirmation before anything is
  # written.
  ./scripts/set-tfc-variables.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  # No defaults on purpose: infra/backend.tf supplies both, so there is exactly
  # one place naming the workspace. Pass them only to override the backend.
  [string] $Organization,
  [string] $Workspace,
  # Only consulted when the workspace has to be CREATED — an existing one
  # already has a project, and moving it would break the OIDC subject.
  [string] $Project,
  [securestring] $TfcToken,

  # Every one of these is optional and discovered or prompted for when
  # omitted — see lib/deploy-console.ps1 for why none is a required flag.
  [string] $TerraformClientId,
  [string] $TenantId,
  [string] $SubscriptionApp,
  [string] $SubscriptionMgmt,
  [string] $SubscriptionConn,
  [string] $EntraApiAudience,
  [string] $BudgetAlertEmail,
  [string] $CloudflareZoneId,
  [securestring] $CloudflareApiToken,

  # Where the bootstrap script puts the Terraform identity. Only used to find
  # its client id automatically.
  [string] $BootstrapResourceGroup = 'rg-hcw-bootstrap',
  [string] $BootstrapIdentityName = 'id-hcw-terraform',

  # Display name for the API app registration, used only when creating one.
  [string] $EntraAppDisplayName = 'HCWSite API',

  # Matched against the zones the Cloudflare token can see, so the zone id is
  # chosen rather than pasted. Mirrors infra/variables.tf's `domain` default.
  [string] $Domain = 'hybridcloudworks.com'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/deploy-console.ps1')

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

  $stored = Get-StoredTfcToken
  if ($stored) {
    Write-Info "Token: $($stored.Path) (written by ``terraform login``)"
    return (ConvertTo-SecureString $stored.Token -AsPlainText -Force)
  }

  return (Read-SecretValue -Prompt 'HCP Terraform API token' -Hint @(
      'No stored token found. Either run `terraform login`, which stores one,',
      'or create a token at https://app.terraform.io/app/settings/tokens'
    ))
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
# 1. Resolve the workspace, creating it if infra/backend.tf names one that
#    does not exist yet
# ===========================================================================
Write-Step 'Workspace'
$script:token = Resolve-TfcToken -Supplied $TfcToken

# backend.tf is what `terraform` itself obeys, so it decides which workspace
# these variables belong in. Reading it here means the script cannot seed the
# wrong workspace, and cannot drift from the backend the way a second copy of
# the names in script defaults did.
if (-not $Organization -or -not $Workspace) {
  $backend = Get-BackendConfig -BackendPath (Join-Path $PSScriptRoot '../infra/backend.tf')
  if (-not $backend) {
    Stop-WithGuidance 'Could not read the organization and workspace from infra/backend.tf.' @(
      'That file is the source of truth for which workspace these variables',
      'belong in. Either fix its cloud block, or pass -Organization and',
      '-Workspace explicitly.'
    )
  }
  # Name only what actually came from the file: saying "from backend.tf" about
  # a value that arrived as a parameter sends the next debugger to the wrong
  # place.
  $fromBackend = @()
  if (-not $Organization) { $Organization = $backend.Organization; $fromBackend += "organization $Organization" }
  if (-not $Workspace) { $Workspace = $backend.Workspace; $fromBackend += "workspace $Workspace" }
  if ($fromBackend) { Write-Info "From infra/backend.tf: $($fromBackend -join ', ')" }
}

$workspaceData = Resolve-TfcWorkspace -Organization $Organization -WorkspaceName $Workspace `
  -Token $script:token -TerraformVersion '1.15.8' -ProjectName $Project -WhatIfMode:$WhatIfPreference
if (-not $workspaceData) {
  if ($WhatIfPreference) {
    Write-Info 'Dry run — the workspace does not exist yet, so there is nothing'
    Write-Info 'further to resolve. Re-run without -WhatIf to create it and seed it.'
    exit 0
  }
  Write-Info 'Cancelled — nothing was written.'
  exit 0
}

$workspaceId = $workspaceData.id
Write-Ok "$Organization/$Workspace ($workspaceId)"

# The project is a segment of the OIDC subject the federated credentials must
# match exactly, so reading the real name here is what turns an AADSTS70021
# investigation into a glance.
$projectId = $workspaceData.relationships.project.data.id
if ($projectId) {
  # NOT $project: that is the [string] parameter above, and PowerShell keeps a
  # parameter's type constraint on the variable, so assigning the response to
  # it silently stringifies the object and every property read returns null.
  $projectResponse = Invoke-TfcApi -Path "/projects/$projectId" -Token $script:token -AllowFailure
  if ($projectResponse) {
    $projectName = $projectResponse.data.attributes.name
    Write-Ok "Project: $projectName"
    Write-Info 'This is the value the federated credential subject must contain.'
  } else {
    Write-Info 'Could not read the project name (token may lack project scope).'
  }
}

# ===========================================================================
# 2. The variables
# ===========================================================================
# ---------------------------------------------------------------------------
# 2a. Discover everything Azure and Cloudflare already know
# ---------------------------------------------------------------------------
$azureAvailable = (Test-AzInstalled) -and (Invoke-Az @('account', 'show', '-o', 'json') -AllowFailure)

if (-not $azureAvailable -and -not ($TenantId -and $SubscriptionApp -and $SubscriptionMgmt -and $SubscriptionConn)) {
  Stop-WithGuidance 'Not signed in to Azure, and the subscription values were not all supplied.' @(
    'Run: az login', 'Then re-run this script.'
  )
}

if ($azureAvailable) {
  Write-Step 'Discovering from Azure'
  $account = Invoke-Az @('account', 'show', '-o', 'json')

  if (-not $TenantId) {
    $TenantId = $account.tenantId
    Write-Ok "Tenant: $TenantId  (from the current sign-in)"
  }

  $visible = Get-AzSubscriptionList
  if (-not $SubscriptionMgmt) {
    $SubscriptionMgmt = (Select-Subscription -Purpose 'Platform Management (subscription_mgmt)' `
        -Pattern 'sub-plat-mgmt-*' -Subscriptions $visible).id
  }
  if (-not $SubscriptionApp) {
    $SubscriptionApp = (Select-Subscription -Purpose 'Application landing zone (subscription_app)' `
        -Pattern 'sub-app-*' -Subscriptions $visible).id
  }
  if (-not $SubscriptionConn) {
    $SubscriptionConn = (Select-Subscription -Purpose 'Platform Connectivity (subscription_conn)' `
        -Pattern 'sub-plat-conn-*' -Subscriptions $visible).id
  }

  # The client id of the identity bootstrap-terraform-oidc.ps1 created. This is
  # the value operators previously copied out of a scrolled-away console or a
  # gitignored report; it is readable straight from the identity instead.
  if (-not $TerraformClientId) {
    $identity = Invoke-Az @(
      'identity', 'show', '-n', $BootstrapIdentityName, '-g', $BootstrapResourceGroup,
      '--subscription', $SubscriptionMgmt, '-o', 'json'
    ) -AllowFailure
    if ($identity) {
      $TerraformClientId = $identity.clientId
      Write-Ok "Terraform identity: $BootstrapIdentityName ($TerraformClientId)"

      # Verify the federated credentials actually match THIS workspace. This
      # script is the only place that knows both halves — the real org,
      # project and workspace from the API above, and the subjects Entra will
      # match against — so it is the only place that can catch a mismatch
      # before a run does. Entra compares the subject as an exact,
      # case-sensitive string, and a mismatch surfaces as AADSTS70021 ("no
      # matching federated identity record found"), which names none of the
      # three segments that could be wrong.
      if ($projectName) {
        $expected = @{
          'tfc-plan'  = "organization:${Organization}:project:${projectName}:workspace:${Workspace}:run_phase:plan"
          'tfc-apply' = "organization:${Organization}:project:${projectName}:workspace:${Workspace}:run_phase:apply"
        }
        $actual = @{}
        foreach ($credential in @(Invoke-Az @(
              'identity', 'federated-credential', 'list',
              '--identity-name', $BootstrapIdentityName, '-g', $BootstrapResourceGroup,
              '--subscription', $SubscriptionMgmt, '-o', 'json'
            ) -AllowFailure)) {
          $actual[$credential.name] = $credential.subject
        }

        $wrong = @($expected.Keys | Where-Object { $actual[$_] -ne $expected[$_] } | Sort-Object)
        if ($wrong.Count -eq 0 -and $actual.Count -gt 0) {
          Write-Ok 'Federated credentials match this workspace'
        } elseif ($actual.Count -gt 0) {
          Write-Warn "$($wrong.Count) federated credential(s) do NOT match this workspace."
          foreach ($name in $wrong) {
            Write-Info "  $name"
            Write-Info "    is    $($actual[$name])"
            Write-Info "    needs $($expected[$name])"
          }
          Write-Info 'Every plan and apply fails AADSTS70021 until these agree. Fix by'
          Write-Info 're-running the bootstrap, which replaces a drifted subject:'
          Write-Info "  ./scripts/bootstrap-terraform-oidc.ps1 -TfcOrganization '$Organization' -TfcProject '$projectName' -TfcWorkspace '$Workspace'"
        }
      }
    } else {
      Write-Warn "$BootstrapIdentityName not found in $BootstrapResourceGroup."
      Write-Info 'That identity is what HCP Terraform authenticates as, and only'
      Write-Info 'bootstrap-terraform-oidc.ps1 creates it. Run that first, or paste'
      Write-Info 'the client id if the identity lives somewhere else.'
      $TerraformClientId = Read-Value -Prompt 'TFC_AZURE_RUN_CLIENT_ID' `
        -Validate { param($v) Test-Guid $v } -ValidationMessage 'Expected a GUID.'
    }
  }

  # The budget notification address defaults to whoever is running this, which
  # is right far more often than not for a one-person platform.
  if (-not $BudgetAlertEmail) {
    $signedInEmail = Invoke-Az @('ad', 'signed-in-user', 'show', '--query', 'mail', '-o', 'tsv') -AllowFailure
    if (-not $signedInEmail) { $signedInEmail = $account.user.name }
    $BudgetAlertEmail = Read-Value -Prompt 'Budget alert email' -Default $signedInEmail `
      -Validate { param($v) $v -match '^[^@\s]+@[^@\s]+\.[^@\s]+$' } `
      -ValidationMessage 'Expected an email address.'
  }

  # The API app registration exposing api://<id>. Offered as a list of the
  # registrations this account owns rather than asked for as a URI, because
  # getting it wrong means sign-in succeeds and every API call 401s.
  if (-not $EntraApiAudience) {
    $apps = @(Invoke-Az @('ad', 'app', 'list', '--show-mine', '-o', 'json') -AllowFailure |
        Where-Object { $_.identifierUris -and $_.identifierUris.Count -gt 0 })
    if ($apps.Count -gt 0) {
      $chosen = Select-Option -Title 'API app registration (entra_api_audience)' -Options $apps `
        -Label { param($a) "$($a.displayName)  $($a.identifierUris[0])" } -AutoSelectSingle `
        -AutoSelectNote 'only registration exposing an application ID URI'
      $EntraApiAudience = $chosen.identifierUris[0]
    } else {
      Write-Info 'No app registration exposing an application ID URI exists yet.'
      Write-Info 'This is the API the Functions host validates tokens against, and'
      Write-Info 'it must be SEPARATE from the SPA registration (DECISION 3): with'
      Write-Info 'one registration an ID token minted for the browser is'
      Write-Info 'indistinguishable from an access token for the API.'

      if ($WhatIfPreference) {
        Write-Act "would create the API app registration '$EntraAppDisplayName'"
        $EntraApiAudience = '<api://… — re-run without -WhatIf>'
      } else {
        $graphToken = Get-GraphToken
        if (-not $graphToken) {
          Stop-WithGuidance 'Could not get a Microsoft Graph token.' @(
            'Sign in again: az login', 'Then re-run this script.'
          )
        }
        if (Confirm-Plan -Title 'Create the API app registration?' -Values ([ordered]@{
              'Display name' = $EntraAppDisplayName
              'Identifier'   = 'api://<new app id>  → becomes entra_api_audience'
              'Scope'        = 'access_as_admin (delegated, what the SPA requests)'
              'App roles'    = 'Admin (users), LabAgent (applications)'
              'Tenant'       = $TenantId
            })) {
          $registration = New-EntraApiRegistration -DisplayName $EntraAppDisplayName -AccessToken $graphToken
          $EntraApiAudience = $registration.Audience
          Write-Act "created  $EntraAppDisplayName ($($registration.AppId))"
          Write-Info "VITE_ENTRA_API_SCOPE for the frontend build is $($registration.Scope)"
          Write-Info 'Assign the Admin role to each admin user in Entra:'
          Write-Info '  Enterprise applications -> Users and groups'
        } else {
          # Declined: fall back to a paste, because the value is mandatory and
          # an operator may have created the registration elsewhere.
          $EntraApiAudience = Read-Value -Prompt 'entra_api_audience' `
            -Validate { param($v) $v -match '^(api://|https://)' } `
            -ValidationMessage 'Expected api://<guid> or an https:// identifier URI.'
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 2b. Cloudflare — token first, then the zone chosen from what it can see
# ---------------------------------------------------------------------------
if (-not $CloudflareApiToken) {
  if ($WhatIfPreference) {
    # A dry run writes nothing, so do not ask the operator to produce a secret
    # it will never use. The empty SecureString keeps the pipeline type-safe.
    Write-Info 'Dry run — not prompting for the Cloudflare API token.'
    $CloudflareApiToken = [securestring]::new()
  } else {
    Write-Step 'Cloudflare'
    $CloudflareApiToken = Read-SecretValue -Prompt 'Cloudflare API token' -Hint @(
      'Zone:Read + DNS:Edit, scoped to the domain. Create one at:',
      '  https://dash.cloudflare.com/profile/api-tokens'
    )
  }
}

if (-not $CloudflareZoneId) {
  $plainToken = [System.Net.NetworkCredential]::new('', $CloudflareApiToken).Password
  $zones = @()
  if ($plainToken) {
    try {
      $response = Invoke-RestMethod -Method GET -Uri 'https://api.cloudflare.com/client/v4/zones?per_page=50' `
        -Headers @{ Authorization = "Bearer $plainToken" }
      if ($response.success) { $zones = @($response.result) }
    } catch {
      Write-Info 'Could not list zones with that token (Zone:Read may be missing).'
    }
  }

  if ($zones.Count -gt 0) {
    # Prefer the configured domain, so the common case needs no interaction.
    $match = @($zones | Where-Object { $_.name -eq $Domain })
    $candidates = if ($match.Count -eq 1) { $match } else { $zones }
    $zone = Select-Option -Title 'Cloudflare zone (cloudflare_zone_id)' -Options $candidates `
      -Label { param($z) "$($z.name)  [$($z.id)]" } -AutoSelectSingle -AutoSelectNote "matches $Domain"
    $CloudflareZoneId = $zone.id
  } elseif ($WhatIfPreference) {
    $CloudflareZoneId = '<zone id — re-run without -WhatIf>'
  } else {
    $CloudflareZoneId = Read-Value -Prompt 'cloudflare_zone_id' -Hint @(
      'Dashboard -> the domain -> Overview -> API section, bottom right.'
    )
  }
}

# ---------------------------------------------------------------------------
# 2c. Confirm before writing
# ---------------------------------------------------------------------------
$summary = [ordered]@{
  'Workspace'               = "$Organization/$Workspace"
  'TFC_AZURE_RUN_CLIENT_ID' = $TerraformClientId
  'ARM_TENANT_ID'           = $TenantId
  'subscription_app'        = $SubscriptionApp
  'subscription_mgmt'       = $SubscriptionMgmt
  'subscription_conn'       = $SubscriptionConn
  'entra_api_audience'      = $EntraApiAudience
  'budget_alert_email'      = $BudgetAlertEmail
  'cloudflare_zone_id'      = $CloudflareZoneId
  'cloudflare_api_token'    = '(not shown)'
}
if (-not (Confirm-Plan -Title 'About to write these workspace variables' -Values $summary `
      -Order @($summary.Keys) -Force:$WhatIfPreference)) {
  Write-Info 'Cancelled — nothing was written.'
  exit 0
}

# ARM_* and TFC_AZURE_* are category 'env' because the provider and HCP
# Terraform's dynamic-credentials machinery read them from the process
# environment. As Terraform variables they are accepted, ignored, and the run
# fails saying no credentials were supplied.
$plainCloudflareToken = $CloudflareApiToken

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
    description = 'Application landing zone (sub-app-site-prod-scus)' }
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
