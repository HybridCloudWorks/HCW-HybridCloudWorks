#requires -Version 7.0
<#
.SYNOPSIS
  Creates the one identity HCP Terraform needs to authenticate to Azure, so the
  first `terraform apply` can run.

.DESCRIPTION
  There are two OIDC handshakes in this platform and they are easy to confuse:

    1. HCP Terraform -> Azure   (this script)
       Terraform runs in HashiCorp's cloud. Before it can create anything it
       needs an Azure identity of its own. Nothing in `infra/` can create that
       identity, because creating it is what `infra/` needs the identity FOR.
       That is the chicken-and-egg this script breaks, and it is the only
       manual step in the whole deployment.

    2. GitHub Actions -> Azure  (infra/oidc.tf, NOT this script)
       Terraform creates a second managed identity for the deploy workflows.
       It only exists after the first apply succeeds. If you are looking for
       CLIENT_ID for `azure/login`, it comes from the Terraform outputs after
       handshake 1 works — not from here.

  Everything here is a user-assigned managed identity, for the reason
  documented at the top of infra/oidc.tf: managed identities are ordinary Azure
  resources, so an Azure Owner can create them with no Entra directory role at
  all. App registrations need Application Administrator in Entra, which Azure
  Owner does NOT grant — they are different planes. Entra supports federating a
  managed identity to an arbitrary external issuer ("Other workloads running in
  compute platforms outside of Azure"), and app.terraform.io is one.

  The bootstrap identity lives in its own resource group and is deliberately
  NOT in Terraform state. Terraform must not manage the credential it
  authenticates with: a destroy, a taint, or a bad plan would lock the
  workspace out of the subscription with no way back in except this script.

  The script is idempotent and safe to re-run. It creates nothing that already
  exists and reports what it found.

.PARAMETER TenantId
  Entra tenant (directory) ID. Required — it is also the ARM_TENANT_ID you set
  in the HCP Terraform workspace.

.PARAMETER SubscriptionId
  Target Azure subscription. Required.

.PARAMETER TfcOrganization
  HCP Terraform organization name, case-sensitive. Default: HybridCloudWorks.

.PARAMETER TfcProject
  HCP Terraform project name, case-sensitive. A workspace created without
  choosing a project lives in "Default Project" — including the space.

.PARAMETER TfcWorkspace
  HCP Terraform workspace name, case-sensitive.

.PARAMETER ElevateAccess
  For the "I created this tenant an hour ago" case: a Global Administrator has
  full control of the directory but, by default, zero Azure RBAC on the
  subscriptions underneath it. This switch performs the documented one-time
  elevation (root-scope User Access Administrator), grants you Owner on the
  target subscription, and then removes the root-scope grant again. Only pass
  it if the preflight tells you to.

.PARAMETER DeviceCode
  Sign in with the device-code flow — the script prints a short code and a URL,
  and you complete the sign-in in any browser, including one on another
  machine. Use it when this session has no browser of its own (SSH, a container,
  Cloud Shell, a locked-down VM) or when the browser that opens is signed into
  the wrong account and keeps silently reusing it. The script falls back to it
  automatically if the interactive sign-in fails.

.PARAMETER WhatIf
  Print every change without making one. Signing in still happens — it reads
  your directory, it does not change it, and nothing can be inspected without
  it.

.EXAMPLE
  ./scripts/bootstrap-terraform-oidc.ps1 `
      -TenantId 00000000-0000-0000-0000-000000000000 `
      -SubscriptionId 11111111-1111-1111-1111-111111111111 -WhatIf

.EXAMPLE
  # No browser on this machine, or the wrong account keeps being reused.
  ./scripts/bootstrap-terraform-oidc.ps1 `
      -TenantId 00000000-0000-0000-0000-000000000000 `
      -SubscriptionId 11111111-1111-1111-1111-111111111111 -DeviceCode
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string] $TenantId,
  [Parameter(Mandatory = $true)][string] $SubscriptionId,
  [string] $TfcOrganization = 'HybridCloudWorks',
  [string] $TfcProject = 'Default Project',
  [string] $TfcWorkspace = 'hybridcloudworks-azure',
  [string] $ResourceGroupName = 'rg-hcw-bootstrap',
  [string] $IdentityName = 'id-hcw-terraform',
  [string] $Location = 'eastus2',
  [switch] $ElevateAccess,
  [switch] $DeviceCode
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Output helpers. Every line the operator reads is one of these four shapes, so
# a long run stays scannable: what is fine, what changed, what needs them.
# ---------------------------------------------------------------------------
function Write-Step { param($Message) Write-Host "`n=== $Message" -ForegroundColor Cyan }
function Write-Ok { param($Message) Write-Host "  [ok]   $Message" -ForegroundColor Green }
function Write-Act { param($Message) Write-Host "  [make] $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "  $Message" -ForegroundColor DarkGray }

function Stop-WithGuidance {
  param([string] $Problem, [string[]] $Fix)
  Write-Host "`n  [stop] $Problem" -ForegroundColor Red
  foreach ($line in $Fix) { Write-Host "         $line" -ForegroundColor Red }
  exit 1
}

# az writes progress and warnings to stderr, which PowerShell 7 promotes to a
# terminating error under $ErrorActionPreference = 'Stop'. Route everything
# through one wrapper that judges success by exit code instead.
function Invoke-Az {
  param([Parameter(Mandatory)][string[]] $Arguments, [switch] $AllowFailure)
  # 2>&1 on a native command turns stderr into ErrorRecords, and under
  # 'Stop' PowerShell 7 raises those as NativeCommandError before the exit
  # code is ever read. Relax the preference for the call itself only.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & az @Arguments 2>&1 } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) { return $null }
    throw "az $($Arguments -join ' ') failed:`n$output"
  }
  $text = ($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  try { return $text | ConvertFrom-Json } catch { return $text }
}

# Sign-in is the one az call that must NOT be captured. The device-code flow
# prints the code and URL you have to act on, and the interactive flow prints
# the account picker's fallback URL — swallowing either leaves the operator
# staring at a hung prompt. So this runs az directly and lets it own the
# console.
function Invoke-AzLogin {
  param([switch] $UseDeviceCode)

  $loginArgs = @('login', '--tenant', $TenantId, '--only-show-errors')
  if ($UseDeviceCode) {
    $loginArgs += '--use-device-code'
    Write-Info 'Device-code sign-in — open the URL below and enter the code:'
  } else {
    Write-Info 'Opening a browser to sign in. If nothing opens, re-run with -DeviceCode.'
  }

  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & az @loginArgs | Out-Host } finally { $ErrorActionPreference = $previous }
  return ($LASTEXITCODE -eq 0)
}

# ===========================================================================
# 1. Preflight — establish what actually exists before proposing any change
# ===========================================================================
Write-Step 'Preflight'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Stop-WithGuidance 'The Azure CLI (az) is not installed.' @(
    'Install it: https://learn.microsoft.com/cli/azure/install-azure-cli',
    'Then re-run this script.'
  )
}
Write-Ok "Azure CLI present ($((Invoke-Az @('version')).'azure-cli'))"

# Signing in is a read of your directory, not a change to it, so it happens
# even under -WhatIf: nothing below can be inspected without a session.
$account = Invoke-Az @('account', 'show', '-o', 'json') -AllowFailure

if (-not $account) {
  Write-Act 'Not signed in — starting sign-in'
} elseif ($account.tenantId -ne $TenantId) {
  # A stale session in the wrong directory is the normal state for anyone who
  # works across tenants, and it is not the operator's mistake to correct by
  # hand. Switching also changes which subscriptions are visible, so re-read
  # the account afterwards rather than trusting the old one.
  Write-Act "Signed in to tenant $($account.tenantId), which is not $TenantId — switching"
  $account = $null
}

if (-not $account) {
  $signedIn = Invoke-AzLogin -UseDeviceCode:$DeviceCode

  # An interactive sign-in fails for environmental reasons far more often than
  # for credential ones: no browser on the box, no display, a browser that
  # cannot reach the loopback port. Device code needs none of that, so try it
  # rather than making the operator discover the flag from an error message.
  if (-not $signedIn -and -not $DeviceCode) {
    Write-Info 'Interactive sign-in did not complete — retrying with a device code.'
    $signedIn = Invoke-AzLogin -UseDeviceCode
  }

  if (-not $signedIn) {
    Stop-WithGuidance 'Sign-in failed.' @(
      "Run it by hand and read the error: az login --tenant $TenantId --use-device-code",
      'If it reports the tenant does not exist, check the tenant GUID.',
      'If it reports no subscriptions found, the sign-in worked — you have no',
      'Azure RBAC yet, which this script can fix. Re-run it with -ElevateAccess.'
    )
  }

  $account = Invoke-Az @('account', 'show', '-o', 'json') -AllowFailure
}

if (-not $account) {
  Stop-WithGuidance 'Signed in, but no subscription context is set.' @(
    "This directory may hold no subscriptions your account can see.",
    'Check with: az account list --all -o table'
  )
}

if ($account.tenantId -ne $TenantId) {
  Stop-WithGuidance "Still signed in to tenant $($account.tenantId) after sign-in, not $TenantId." @(
    'The sign-in most likely landed on a cached account in the other directory.',
    "Clear it and try again: az logout; az login --tenant $TenantId --use-device-code"
  )
}
Write-Ok "Signed in as $($account.user.name) in tenant $TenantId"

$subscription = Invoke-Az @('account', 'show', '--subscription', $SubscriptionId, '-o', 'json') -AllowFailure
if (-not $subscription) {
  Stop-WithGuidance "Subscription $SubscriptionId is not visible to this sign-in." @(
    'Either the ID is wrong, or it belongs to a different directory, or your',
    'account has no Azure RBAC on it yet. `az account list -o table` shows what',
    'you can see. If the list is empty but you administer this tenant, that is',
    'the Global-Administrator-with-no-RBAC case — re-run with -ElevateAccess.'
  )
}
Invoke-Az @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
Write-Ok "Subscription: $($subscription.name)"

# Who am I, in the form role assignments use.
$signedInObjectId = (Invoke-Az @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'))
if (-not $signedInObjectId) {
  Stop-WithGuidance 'Could not read your own directory object.' @(
    'This script expects an interactive user sign-in, not a service principal.'
  )
}

$subscriptionScope = "/subscriptions/$SubscriptionId"

function Get-MyRoles {
  $assignments = Invoke-Az @(
    'role', 'assignment', 'list',
    '--assignee', $signedInObjectId,
    '--scope', $subscriptionScope,
    '--include-inherited', '--include-groups',
    '-o', 'json'
  ) -AllowFailure
  if (-not $assignments) { return @() }
  return @($assignments | ForEach-Object { $_.roleDefinitionName })
}

$myRoles = Get-MyRoles
# Terraform will create role assignments (infra/oidc.tf, main.tf), and granting
# a role you do not hold is itself privileged. Owner covers both halves; the
# split alternative is Contributor plus a role-assignment writer.
$canAssignRoles = $myRoles -contains 'Owner' -or $myRoles -contains 'User Access Administrator' -or $myRoles -contains 'Role Based Access Control Administrator'

if (-not $canAssignRoles) {
  if (-not $ElevateAccess) {
    Stop-WithGuidance "You hold no role-assignment rights on $SubscriptionId (found: $(if ($myRoles) { $myRoles -join ', ' } else { 'none' }))." @(
      'This script must grant roles to the Terraform identity, so it needs',
      'Owner (or User Access Administrator) on the subscription.',
      '',
      'If you just created this tenant: being Global Administrator in Entra does',
      'NOT give you Azure RBAC. They are separate permission systems. Re-run with',
      '-ElevateAccess to take the documented one-time root-scope elevation, grant',
      'yourself Owner on this subscription, and drop the root grant again:',
      '',
      "  ./scripts/bootstrap-terraform-oidc.ps1 -TenantId $TenantId -SubscriptionId $SubscriptionId -ElevateAccess",
      '',
      'Otherwise, ask whoever owns the subscription for Owner and re-run.'
    )
  }

  Write-Step 'Elevating access (Global Administrator -> subscription Owner)'
  if ($PSCmdlet.ShouldProcess('tenant root scope', 'grant User Access Administrator')) {
    Invoke-Az @(
      'rest', '--method', 'post',
      '--url', 'https://management.azure.com/providers/Microsoft.Authorization/elevateAccess?api-version=2016-07-01'
    ) | Out-Null
    Write-Act 'Root-scope User Access Administrator granted (temporary)'

    # Entra takes a few seconds to make the elevation usable.
    Start-Sleep -Seconds 15

    Invoke-Az @(
      'role', 'assignment', 'create',
      '--assignee-object-id', $signedInObjectId,
      '--assignee-principal-type', 'User',
      '--role', 'Owner',
      '--scope', $subscriptionScope
    ) | Out-Null
    Write-Act "Owner granted on $SubscriptionId"

    # Leaving root-scope UAA in place is a standing tenant-wide privilege with
    # no owner and no expiry. Remove it now that its one job is done.
    Invoke-Az @(
      'role', 'assignment', 'delete',
      '--assignee', $signedInObjectId,
      '--role', 'User Access Administrator',
      '--scope', '/'
    ) -AllowFailure | Out-Null
    Write-Act 'Root-scope elevation removed'

    Start-Sleep -Seconds 10
    $myRoles = Get-MyRoles
  }
}
Write-Ok "Subscription roles: $(if ($myRoles) { $myRoles -join ', ' } else { '(none — -WhatIf run)' })"

# Managed identities and federated credentials both live behind this provider.
# On a subscription nobody has deployed to, it is unregistered, and the failure
# it produces ("MissingSubscriptionRegistration") does not say what to do.
$provider = Invoke-Az @('provider', 'show', '--namespace', 'Microsoft.ManagedIdentity', '--query', 'registrationState', '-o', 'tsv') -AllowFailure
if ($provider -ne 'Registered') {
  if ($PSCmdlet.ShouldProcess('Microsoft.ManagedIdentity', 'register resource provider')) {
    Write-Act 'Registering Microsoft.ManagedIdentity (first deployment to this subscription)'
    Invoke-Az @('provider', 'register', '--namespace', 'Microsoft.ManagedIdentity', '--wait') | Out-Null
  }
} else {
  Write-Ok 'Microsoft.ManagedIdentity registered'
}

# ===========================================================================
# 2. Bootstrap resource group
# ===========================================================================
Write-Step "Resource group $ResourceGroupName"

$existingGroup = Invoke-Az @('group', 'show', '-n', $ResourceGroupName, '-o', 'json') -AllowFailure
if ($existingGroup) {
  Write-Ok "Exists in $($existingGroup.location)"
} elseif ($PSCmdlet.ShouldProcess($ResourceGroupName, 'create resource group')) {
  Invoke-Az @(
    'group', 'create', '-n', $ResourceGroupName, '-l', $Location,
    '--tags', 'workload=hybridcloudworks', 'environment=prod', 'managedBy=bootstrap-script',
    'criticality=high', 'dataClassification=internal'
  ) | Out-Null
  Write-Act "Created in $Location"
} else {
  Write-Act "Would create in $Location"
}

# ===========================================================================
# 3. The Terraform identity
# ===========================================================================
Write-Step "Managed identity $IdentityName"

$identity = Invoke-Az @('identity', 'show', '-n', $IdentityName, '-g', $ResourceGroupName, '-o', 'json') -AllowFailure
if ($identity) {
  Write-Ok "Exists (client id $($identity.clientId))"
} elseif ($PSCmdlet.ShouldProcess($IdentityName, 'create user-assigned managed identity')) {
  $identity = Invoke-Az @('identity', 'create', '-n', $IdentityName, '-g', $ResourceGroupName, '-l', $Location, '-o', 'json')
  Write-Act "Created (client id $($identity.clientId))"
  # Entra replicates the new service principal asynchronously; a role
  # assignment issued immediately fails with PrincipalNotFound.
  Start-Sleep -Seconds 20
} else {
  Write-Act 'Would create'
}

# ===========================================================================
# 4. Federated credentials — one per run phase
# ===========================================================================
# HCP Terraform stamps the run phase into the token's subject claim, and Entra
# matches subject as an exact, case-sensitive string with no wildcards. So
# "plan" and "apply" are two different subjects and need two credentials. With
# only the plan credential, every run plans cleanly and every apply fails at
# authentication — which reads like a permissions problem and is not one.
Write-Step 'Federated credentials for app.terraform.io'

$subjects = @{
  'tfc-plan'  = "organization:${TfcOrganization}:project:${TfcProject}:workspace:${TfcWorkspace}:run_phase:plan"
  'tfc-apply' = "organization:${TfcOrganization}:project:${TfcProject}:workspace:${TfcWorkspace}:run_phase:apply"
}

foreach ($credentialName in ($subjects.Keys | Sort-Object)) {
  $subject = $subjects[$credentialName]
  $existing = Invoke-Az @(
    'identity', 'federated-credential', 'show',
    '-n', $credentialName, '--identity-name', $IdentityName, '-g', $ResourceGroupName, '-o', 'json'
  ) -AllowFailure

  if ($existing -and $existing.subject -eq $subject) {
    Write-Ok "$credentialName -> $subject"
    continue
  }

  if ($existing) {
    # Subject is immutable in practice; the org, project or workspace name
    # changed, so replace rather than leave a credential that matches nothing.
    Write-Info "$credentialName exists with subject '$($existing.subject)' — replacing"
    if ($PSCmdlet.ShouldProcess($credentialName, 'delete stale federated credential')) {
      Invoke-Az @(
        'identity', 'federated-credential', 'delete', '--yes',
        '-n', $credentialName, '--identity-name', $IdentityName, '-g', $ResourceGroupName
      ) | Out-Null
    }
  }

  if ($PSCmdlet.ShouldProcess($credentialName, "create federated credential for $subject")) {
    Invoke-Az @(
      'identity', 'federated-credential', 'create',
      '-n', $credentialName, '--identity-name', $IdentityName, '-g', $ResourceGroupName,
      '--issuer', 'https://app.terraform.io',
      '--subject', $subject,
      '--audiences', 'api://AzureADTokenExchange'
    ) | Out-Null
    Write-Act "$credentialName -> $subject"
  } else {
    Write-Act "Would create $credentialName -> $subject"
  }
}

# ===========================================================================
# 5. Subscription roles for the Terraform identity
# ===========================================================================
# Contributor creates the resources. It cannot create role assignments, and
# infra/ creates several (Function App -> Key Vault, -> Cosmos, -> OpenAI, and
# the GitHub deploy identity's own roles), so a role-assignment writer is
# required too. Role Based Access Control Administrator is the narrow one: it
# can assign roles but cannot grant Owner or User Access Administrator, so the
# Terraform identity cannot escalate itself.
Write-Step 'Subscription role assignments'

$requiredRoles = @('Contributor', 'Role Based Access Control Administrator')

if ($identity -and $identity.principalId) {
  $held = Invoke-Az @(
    'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $subscriptionScope, '-o', 'json'
  ) -AllowFailure
  $heldNames = @($held | ForEach-Object { $_.roleDefinitionName })

  foreach ($role in $requiredRoles) {
    if ($heldNames -contains $role) {
      Write-Ok "$role"
    } elseif ($PSCmdlet.ShouldProcess($IdentityName, "assign $role at subscription scope")) {
      Invoke-Az @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $identity.principalId,
        '--assignee-principal-type', 'ServicePrincipal',
        '--role', $role,
        '--scope', $subscriptionScope
      ) | Out-Null
      Write-Act "$role assigned"
    } else {
      Write-Act "Would assign $role"
    }
  }
} else {
  foreach ($role in $requiredRoles) { Write-Act "Would assign $role" }
}

# ===========================================================================
# 6. What the operator still has to do by hand
# ===========================================================================
Write-Step 'Next: set these in the HCP Terraform workspace'

$clientId = if ($identity) { $identity.clientId } else { '<client id — re-run without -WhatIf>' }

Write-Host @"

  HCP Terraform -> $TfcOrganization / $TfcWorkspace -> Variables
  Add all four as ENVIRONMENT variables (not Terraform variables):

    TFC_AZURE_PROVIDER_AUTH   true
    TFC_AZURE_RUN_CLIENT_ID   $clientId
    ARM_TENANT_ID             $TenantId
    ARM_SUBSCRIPTION_ID       $SubscriptionId

  These four names are set by HashiCorp and Microsoft, so they are exempt from
  the repository's 2-word variable rule (see the IaC Repository Standard).

  Then, as TERRAFORM variables in the same workspace, the inputs listed in
  CHECKLIST.md section 7 — azure_subscription_id and entra_tenant_id take the
  same two values as above.

  Verify with a speculative plan before touching apply:

    cd infra && terraform login && terraform plan

  A plan that authenticates but shows resources to create is success. If it
  fails with AADSTS70021 ("No matching federated identity record found"), the
  subject did not match — re-run this script with the -TfcProject and
  -TfcWorkspace names copied exactly from the workspace's Settings page,
  including capitalisation and spaces.

"@ -ForegroundColor White

Write-Host "  Bootstrap complete.`n" -ForegroundColor Green
