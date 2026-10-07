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

.PARAMETER IdentitySubscriptionId
  Subscription that HOLDS the bootstrap resource group and managed identity.
  This is the Management platform subscription: the Terraform identity is
  platform automation, not workload, and it must not live in a subscription it
  is about to deploy into. Required.

.PARAMETER TargetSubscriptionIds
  Every subscription Terraform must be able to deploy into. The identity is
  granted, on each one separately: Role Based Access Control Administrator
  (conditioned, Set-TerraformRbacCondition.ps1), the custom role
  "HCW Terraform Subscription Scope" (scripts/terraform-identity-grants.json:
  create resource groups, budgets, provider registration), Contributor on
  each resource group infra/ declares in that subscription, and, unless
  -RemoveSubscriptionContributor is given, Contributor on the subscription
  itself (section 5 says why SEC-1 is two steps). There is no management
  group in this tenant to inherit from, so a subscription absent from this
  list is a subscription Terraform cannot touch. When omitted, the script
  takes the three subscriptions the naming convention names in the
  signed-in tenant (exactly one sub-app-*, one sub-plat-mgmt-* and one
  sub-plat-conn-*) and asks nothing; IdentitySubscriptionId is always
  included. See -ChooseTargets.

.PARAMETER ChooseTargets
  Show the deployment-target picker even when the naming convention resolves
  the three targets on its own. The picker lists this tenant's sub-*
  subscriptions, with the convention's matches preselected.

.PARAMETER ShowAllSubscriptions
  Widen the picker to every enabled subscription the sign-in can see, in any
  tenant. Only with -ChooseTargets, and only for a tenant that has not adopted
  the naming convention: on 2026-10-07 a sign-in that saw forty-six
  subscriptions, forty-three of them other organisations', was shown all of
  them as grant candidates, which is the thing this switch exists to make
  deliberate.

  Pass all four platform/application subscriptions in the normal case. Order
  does not matter and duplicates are ignored.

.PARAMETER TfcOrganization
  HCP Terraform organization name, case-sensitive. Default: HybridCloudWorks.

.PARAMETER TfcProject
  HCP Terraform project name, case-sensitive. Defaults to Site, the project
  the hcw-azure workspace was created in and the one the live credentials
  name. A workspace created without choosing a project lands in "Default
  Project" instead, with the space, and a workspace can be moved between
  projects from its Settings page; the subject HCP Terraform presents follows
  the move at once and the credentials do not. Read the project off
  https://app.terraform.io/app/hcw/workspaces/hcw-azure/settings/general and
  pass it when it differs from this default.

.PARAMETER ReplaceFederatedCredentials
  Allow section 4 to delete a federated credential whose subject differs from
  the one computed here and recreate it. Without this switch a mismatch stops
  the script with both subjects printed, because the other way to agree, moving
  the workspace back into the project the credential names, changes nothing in
  Azure and is usually what happened.

.PARAMETER RemoveSubscriptionContributor
  SEC-1 step two. Stop granting Contributor at subscription scope, read every
  narrow grant back from Azure (Contributor on each resource group in
  scripts/terraform-identity-grants.json, the custom role with the actions
  the JSON lists, and RBAC Administrator carrying a condition that refuses
  Owner and Contributor, on every target), and only when all of them are
  present delete the identity's Contributor assignment at each target
  subscription. One missing grant stops the run with nothing removed.
  Honours -WhatIf: the preview prints one "Would remove" line per
  subscription.

  Off by default, so a plain run keeps step one's behaviour and grants
  subscription Contributor wherever it is missing. That makes a plain run
  the rollback, and it means every re-run after step two carries this switch
  (adding a resource group, re-applying the condition), or it puts the wide
  grant back.

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

.PARAMETER ReportPath
  Markdown report written at the end of a real run, recording what was created,
  which subscriptions the identity can actually deploy into, and the workspace
  variables still to be set by hand. Defaults under scripts/.reports/, which is
  gitignored — the report holds real subscription and client ids, and
  docs/standards/variables-and-secrets.md treats subscription, tenant and
  client ids as identifiers that are not published.

  Skipped under -WhatIf: there would be nothing true to report.

.PARAMETER WhatIf
  Print every change without making one. Signing in still happens — it reads
  your directory, it does not change it, and nothing can be inspected without
  it.

.EXAMPLE
  # Preview, no arguments. The tenant comes from the Azure CLI sign-in, the
  # identity home and the three deployment targets come from the naming
  # convention, and nothing is asked when each pattern matches exactly once.
  ./scripts/bootstrap-terraform-oidc.ps1 -WhatIf

.EXAMPLE
  # Pick the targets by hand from this tenant's sub-* subscriptions.
  ./scripts/bootstrap-terraform-oidc.ps1 -ChooseTargets -WhatIf

.EXAMPLE
  # Same, on a machine with no browser of its own.
  ./scripts/bootstrap-terraform-oidc.ps1 -DeviceCode

.EXAMPLE
  # SEC-1 step two, previewed: reads the narrow grants back and prints one
  # "Would remove" line per subscription. Drop -WhatIf to remove them.
  ./scripts/bootstrap-terraform-oidc.ps1 -RemoveSubscriptionContributor -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  # All three are optional and discovered interactively when omitted — see
  # lib/deploy-console.ps1 for why none of them is a required flag. Supplying
  # one skips its discovery step, which is what keeps CI use possible.
  [string] $TenantId,
  [string] $IdentitySubscriptionId,
  [string[]] $TargetSubscriptionIds = @(),
  # These three compose the federated credential subject, which Entra matches
  # as an exact, case-sensitive string. The workspace was created in the
  # `Site` project on 2026-08-19 and the credentials were written for it.
  # On 2026-10-07 the HCP Terraform API showed hcw-azure in "Default
  # Project" (with the space) and `Site` empty, and every run failed at
  # sign-in with AADSTS700213 naming the presented subject. Whichever side
  # moved, the two must agree: read the project off the workspace's
  # Settings page and pass it, and note that section 4 refuses to replace a
  # credential whose subject differs unless -ReplaceFederatedCredentials is
  # given, because a silent replacement is how a working trust gets lost.
  [string] $TfcOrganization = 'hcw',
  [string] $TfcProject = 'Site',
  [string] $TfcWorkspace = 'hcw-azure',
  # Named to the convention as of 2026-08-19. The originals were
  # rg-hcw-bootstrap / id-hcw-terraform / southcentralus, which predated the
  # Naming-Convention page and broke it three ways: `hcw` is the ORG token, and
  # the page reserves that for management-group IDs (the workload slot takes
  # `plat`); there was no environment or region segment; and there was no
  # instance number, which CAF assigns to managed identities.
  #
  # The resource group cannot be rg-mgmt-plat-prod-cus — that name belongs to
  # Terraform's own Management group, and the whole point of this one is that
  # nothing in infra/ can reach it. `boot` in the workload slot keeps it
  # separate and says what it is.
  #
  # Location matters more than it looks: leaving this at southcentralus meant
  # the next bootstrap run would recreate the region drift that the centralus
  # consolidation removed.
  [switch] $ReplaceFederatedCredentials,
  # SEC-1 step two (section 5c). Off by default: a plain run grants
  # subscription Contributor where it is missing, which is the rollback.
  [switch] $RemoveSubscriptionContributor,
  # The deployment targets are decided by the naming convention: exactly one
  # sub-app-*, one sub-plat-mgmt-* and one sub-plat-conn-* subscription. When
  # the sign-in sees exactly that, the script takes them and asks nothing.
  # -ChooseTargets forces the picker anyway; the picker then lists only the
  # convention's sub-* subscriptions, and -ShowAllSubscriptions widens it to
  # everything the sign-in can see (2026-10-07: a sign-in with forty-six
  # subscriptions, forty-three of them other organisations', was shown all
  # of them as candidates for a Terraform grant).
  [switch] $ChooseTargets,
  [switch] $ShowAllSubscriptions,
  [string] $ResourceGroupName = 'rg-mgmt-boot-prod-cus',
  [string] $IdentityName = 'id-plat-terraform-prod-cus-01',
  [string] $Location = 'centralus',
  [switch] $ElevateAccess,
  [switch] $DeviceCode,
  [string] $ReportPath = (Join-Path $PSScriptRoot ".reports/bootstrap-oidc-$(Get-Date -Format 'yyyyMMdd-HHmmss').md")
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/deploy-console.ps1')

# The seven tags the IaC Repository Standard requires on every resource. They
# mirror infra/variables.tf's `tags` default so the bootstrap resources are
# governed identically to the Terraform-managed ones — with one deliberate
# difference: managedBy is 'bootstrap-script', not 'terraform'. That tag is the
# only in-portal signal that this resource group is NOT in Terraform state and
# must not be reconciled into it.
$BootstrapTags = @(
  'workload=hybridcloudworks'
  'environment=prod'
  'owner=platform'
  'costCenter=content-platform'
  'managedBy=bootstrap-script'
  'criticality=high'
  'dataClassification=internal'
)

# Console output, prompting and Invoke-Az live in lib/deploy-console.ps1, so
# all three deployment scripts read and behave identically.

# Sign-in is the one az call that must NOT be captured. The device-code flow
# prints the code and URL you have to act on, and the interactive flow prints
# the account picker's fallback URL — swallowing either leaves the operator
# staring at a hung prompt. So this runs az directly and lets it own the
# console.
function Invoke-AzLogin {
  param([switch] $UseDeviceCode, [string] $Tenant)

  # No --tenant on the very first sign-in of a discovery run: the tenant is
  # what we are about to learn, and pinning it to a value we do not have yet
  # is how this used to require the GUID up front.
  $loginArgs = @('login', '--only-show-errors')
  if ($Tenant) { $loginArgs += @('--tenant', $Tenant) }
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
} elseif ($TenantId -and $account.tenantId -ne $TenantId) {
  # A stale session in the wrong directory is the normal state for anyone who
  # works across tenants, and it is not the operator's mistake to correct by
  # hand. Switching also changes which subscriptions are visible, so re-read
  # the account afterwards rather than trusting the old one.
  Write-Act "Signed in to tenant $($account.tenantId), which is not $TenantId — switching"
  $account = $null
}

if (-not $account) {
  $signedIn = Invoke-AzLogin -UseDeviceCode:$DeviceCode -Tenant $TenantId

  # An interactive sign-in fails for environmental reasons far more often than
  # for credential ones: no browser on the box, no display, a browser that
  # cannot reach the loopback port. Device code needs none of that, so try it
  # rather than making the operator discover the flag from an error message.
  if (-not $signedIn -and -not $DeviceCode) {
    Write-Info 'Interactive sign-in did not complete — retrying with a device code.'
    $signedIn = Invoke-AzLogin -UseDeviceCode -Tenant $TenantId
  }

  if (-not $signedIn) {
    Stop-WithGuidance 'Sign-in failed.' @(
      'Run it by hand and read the error: az login --use-device-code',
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

if (-not $TenantId) {
  $TenantId = $account.tenantId
} elseif ($account.tenantId -ne $TenantId) {
  Stop-WithGuidance "Still signed in to tenant $($account.tenantId) after sign-in, not $TenantId." @(
    'The sign-in most likely landed on a cached account in the other directory.',
    "Clear it and try again: az logout; az login --tenant $TenantId --use-device-code"
  )
}
Write-Ok "Signed in as $($account.user.name) in tenant $TenantId"

# ===========================================================================
# 1b. Choose the subscriptions
# ===========================================================================
# The two decisions this script cannot make alone, offered as lists rather
# than demanded as GUIDs. The naming convention narrows both to one obvious
# answer in this tenant; a tenant that has not adopted it still gets a picker
# over everything the sign-in can see.
$visible = Get-AzSubscriptionList
if ($visible.Count -eq 0) {
  Stop-WithGuidance 'The sign-in can see no enabled subscriptions.' @(
    'Check with: az account list --all -o table',
    'If the list is empty but you administer this tenant, that is the',
    'Global-Administrator-with-no-RBAC case — re-run with -ElevateAccess.',
    '',
    'A subscription created after this session signed in is invisible until',
    'the token is refreshed: az account list --refresh'
  )
}

if (-not $IdentitySubscriptionId) {
  Write-Step 'Where the Terraform identity lives'
  Write-Info 'Platform automation belongs in Management — not in a subscription'
  Write-Info 'it is about to deploy into.'
  $IdentitySubscriptionId = (Select-Subscription -Purpose 'Identity home (Management)' `
      -Pattern 'sub-plat-mgmt-*' -Subscriptions $visible).id
}

if ($TargetSubscriptionIds.Count -eq 0) {
  Write-Step 'Which subscriptions Terraform must deploy into'
  Write-Info 'The identity is granted RBAC Administrator, the subscription-scope role,'
  Write-Info 'and Contributor on the resource groups infra/ declares, on each.'
  Write-Info 'A subscription missing here is one Terraform cannot touch, and the'
  Write-Info 'failure arrives partway through an apply rather than at plan.'
  # Preselect exactly what the configuration targets: the three subscriptions
  # behind the default, mgmt and conn providers. Identity is deliberately not
  # among them — that landing zone holds nothing (providers.tf).
  $targetPatterns = @('sub-app-*', 'sub-plat-mgmt-*', 'sub-plat-conn-*')
  # Only this tenant's subscriptions can be a target: a sign-in that also
  # sees other organisations' subscriptions (a partner or guest account) must
  # never have one of them matched by name and granted to.
  $inTenant = @($visible | Where-Object { $_.tenantId -eq $TenantId })
  $preselected = @()
  $oneEach = $true
  foreach ($pattern in $targetPatterns) {
    $matched = @($inTenant | Where-Object { $_.name -like $pattern })
    if ($matched.Count -ne 1) { $oneEach = $false }
    $preselected += $matched
  }
  # One match per pattern is the convention's answer, and the convention is
  # the contract: take it, say so, and ask nothing. The picker is for a
  # tenant that has not adopted it, or an operator who asked for it.
  if ($oneEach -and -not $ChooseTargets) {
    Write-Ok 'Deployment targets (one per naming-convention pattern; -ChooseTargets to pick instead):'
    foreach ($item in $preselected) { Write-Info "  $(Format-Subscription $item)" }
    $TargetSubscriptionIds = @($preselected.id)
  } else {
  $candidates = if ($ShowAllSubscriptions) { $visible } else { @($inTenant | Where-Object { $_.name -like 'sub-*' }) }
  if ($candidates.Count -eq 0) { $candidates = $inTenant }
  if ($candidates.Count -eq 0) { $candidates = $visible }
  if (-not $ShowAllSubscriptions -and $candidates.Count -lt $visible.Count) {
    Write-Info "Listing the $($candidates.Count) sub-* subscriptions in tenant $TenantId; -ShowAllSubscriptions lists all $($visible.Count) the sign-in can see."
  }
  $TargetSubscriptionIds = @((Select-OptionSet -Title 'Deployment targets' -Options $candidates `
        -Label ${function:Format-Subscription} -Preselected $preselected).id)
  }
}

# The identity's own subscription is always a deployment target: Terraform
# creates the central Log Analytics workspace and the platform action group in
# Management, which is where the identity itself lives. Deduplicated, so
# choosing it explicitly above is harmless.
$TargetSubscriptionIds = @(
  @($TargetSubscriptionIds) + $IdentitySubscriptionId |
    Where-Object { $_ } |
    Select-Object -Unique
)

# Resolve every subscription. A name that resolves here is one the sign-in can
# see; failing now names the offending GUID, where failing later surfaces as an
# opaque role-assignment error halfway through the run.
$subscriptionNames = @{}
foreach ($id in $TargetSubscriptionIds) {
  $resolved = Invoke-Az @('account', 'show', '--subscription', $id, '-o', 'json') -AllowFailure
  if (-not $resolved) {
    Stop-WithGuidance "Subscription $id is not visible to this sign-in." @(
      'Either the ID is wrong, or it belongs to a different directory, or your',
      'account has no Azure RBAC on it yet. `az account list -o table` shows what',
      'you can see. If the list is empty but you administer this tenant, that is',
      'the Global-Administrator-with-no-RBAC case — re-run with -ElevateAccess.',
      '',
      'A subscription created after this session signed in is invisible until the',
      'token is refreshed: az account list --refresh'
    )
  }
  $subscriptionNames[$id] = $resolved.name
}

# The identity's own subscription is the CLI context for every resource this
# script creates.
Invoke-Az @('account', 'set', '--subscription', $IdentitySubscriptionId) | Out-Null

$plan = [ordered]@{
  'Tenant'          = $TenantId
  'Signed in as'    = $account.user.name
  'Identity'        = "$IdentityName in $ResourceGroupName ($($subscriptionNames[$IdentitySubscriptionId]))"
  'Region'          = $Location
  'Deploy targets'  = ($TargetSubscriptionIds | ForEach-Object { $subscriptionNames[$_] }) -join ', '
  'TFC subject'     = "organization:$TfcOrganization`:project:$TfcProject`:workspace:$TfcWorkspace"
}
$proceed = Confirm-Plan -Title 'Bootstrap plan' -Values $plan -Order @($plan.Keys) -Force:$WhatIfPreference
if (-not $proceed) { Write-Info 'Cancelled — nothing was created.'; exit 0 }

# Who am I, in the form role assignments use.
$signedInObjectId = (Invoke-Az @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'))
if (-not $signedInObjectId) {
  Stop-WithGuidance 'Could not read your own directory object.' @(
    'This script expects an interactive user sign-in, not a service principal.'
  )
}

function Get-MyRole {
  param([Parameter(Mandatory)][string] $SubscriptionId)
  $assignments = Invoke-Az @(
    'role', 'assignment', 'list',
    '--assignee', $signedInObjectId,
    '--scope', "/subscriptions/$SubscriptionId",
    '--include-inherited', '--include-groups',
    '-o', 'json'
  ) -AllowFailure
  if (-not $assignments) { return @() }
  return @($assignments | ForEach-Object { $_.roleDefinitionName })
}

# Terraform will create role assignments (infra/oidc.tf, main.tf), and granting
# a role you do not hold is itself privileged. Owner covers both halves; the
# split alternative is Contributor plus a role-assignment writer.
function Test-CanAssignRoles {
  param([string[]] $Roles)
  return ($Roles -contains 'Owner') -or
         ($Roles -contains 'User Access Administrator') -or
         ($Roles -contains 'Role Based Access Control Administrator')
}

# Every target is checked before anything is elevated or created. A run that
# can reach three subscriptions out of four is worse than one that refuses:
# Terraform would authenticate, plan, and then fail partway through an apply.
$rolesBySubscription = @{}
foreach ($id in $TargetSubscriptionIds) {
  $rolesBySubscription[$id] = Get-MyRole -SubscriptionId $id
}

$missingRights = @($TargetSubscriptionIds | Where-Object { -not (Test-CanAssignRoles $rolesBySubscription[$_]) })

if ($missingRights.Count -gt 0) {
  if (-not $ElevateAccess) {
    $detail = $missingRights | ForEach-Object {
      $found = if ($rolesBySubscription[$_]) { $rolesBySubscription[$_] -join ', ' } else { 'none' }
      "  $($subscriptionNames[$_]) [$_] — found: $found"
    }
    Stop-WithGuidance "You hold no role-assignment rights on $($missingRights.Count) of $($TargetSubscriptionIds.Count) target subscriptions." (
      @(
        'This script must grant roles to the Terraform identity, so it needs',
        'Owner (or User Access Administrator) on every target subscription:',
        ''
      ) + $detail + @(
        '',
        'If you just created this tenant: being Global Administrator in Entra does',
        'NOT give you Azure RBAC. They are separate permission systems. Re-run with',
        '-ElevateAccess to take the documented one-time root-scope elevation, grant',
        'yourself Owner on each of them, and drop the root grant again.',
        '',
        'Otherwise, ask whoever owns those subscriptions for Owner and re-run.'
      )
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

    # Grant Owner everywhere it is missing while the elevation is live — it is
    # removed immediately below, so there is no second chance to use it.
    foreach ($id in $missingRights) {
      Invoke-Az @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $signedInObjectId,
        '--assignee-principal-type', 'User',
        '--role', 'Owner',
        '--scope', "/subscriptions/$id"
      ) | Out-Null
      Write-Act "Owner granted on $($subscriptionNames[$id])"
    }

    # Leaving root-scope UAA in place is a standing tenant-wide privilege with
    # no owner and no expiry. Remove it now that its one job is done — and
    # VERIFY the removal rather than asserting it: the delete is allowed to
    # fail quietly (propagation lag, assignee resolution), and a script that
    # prints "removed" over a grant that is still there is worse than one that
    # says so.
    Invoke-Az @(
      'role', 'assignment', 'delete',
      '--assignee', $signedInObjectId,
      '--role', 'User Access Administrator',
      '--scope', '/'
    ) -AllowFailure | Out-Null

    $rootGrant = Invoke-Az @(
      'role', 'assignment', 'list',
      '--assignee', $signedInObjectId,
      '--role', 'User Access Administrator',
      '--scope', '/',
      '-o', 'json'
    ) -AllowFailure
    # An unreadable read-back is NOT a clean bill of health. Invoke-Az returns
    # $null both for "no assignment" and for a throttled, denied or timed-out
    # call, so the success branch below used to print "removed (verified)"
    # over a grant that might still be live — the exact false-green this
    # read-back exists to prevent (T-703).
    if (Test-LastAzFailed) {
      Write-Host '  [warn] Could NOT read the root-scope assignments back.' -ForegroundColor Red
      Write-Host '         The delete may or may not have taken effect. Treat the' -ForegroundColor Red
      Write-Host '         tenant-root grant as STILL LIVE until you have checked:' -ForegroundColor Red
      Write-Host "         az role assignment list --assignee $signedInObjectId --scope / -o table" -ForegroundColor Red
      Write-Host '         Remove it with:' -ForegroundColor Red
      Write-Host "         az role assignment delete --assignee $signedInObjectId --role 'User Access Administrator' --scope /" -ForegroundColor Red
    }
    elseif ($rootGrant) {
      Write-Host '  [warn] Root-scope User Access Administrator is STILL ASSIGNED.' -ForegroundColor Red
      Write-Host '         This is a standing tenant-wide privilege. Remove it by hand:' -ForegroundColor Red
      Write-Host "         az role assignment delete --assignee $signedInObjectId --role 'User Access Administrator' --scope /" -ForegroundColor Red
      Write-Host '         Then confirm with:' -ForegroundColor Red
      Write-Host "         az role assignment list --assignee $signedInObjectId --scope / -o table" -ForegroundColor Red
    } else {
      Write-Act 'Root-scope elevation removed (verified by reading assignments back)'
    }

    Start-Sleep -Seconds 10
    foreach ($id in $TargetSubscriptionIds) {
      $rolesBySubscription[$id] = Get-MyRole -SubscriptionId $id
    }
  }
}

foreach ($id in $TargetSubscriptionIds) {
  $found = if ($rolesBySubscription[$id]) { $rolesBySubscription[$id] -join ', ' } else { '(none — -WhatIf run)' }
  Write-Ok "$($subscriptionNames[$id]): $found"
}

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
  Invoke-Az (@('group', 'create', '-n', $ResourceGroupName, '-l', $Location, '--tags') + $BootstrapTags) | Out-Null
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
  $identity = Invoke-Az (@('identity', 'create', '-n', $IdentityName, '-g', $ResourceGroupName, '-l', $Location, '-o', 'json', '--tags') + $BootstrapTags)
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
    # The org, project or workspace in the subject differs from what is on
    # the identity. One of two things is true: the workspace moved projects
    # (2026-10-07: hcw-azure was found in "Default Project" with the
    # credentials still naming Site, and every run failed with AADSTS700213),
    # or this script was given the wrong name. Replacing silently turns the
    # second case into a lockout, so a mismatch stops here unless the caller
    # has read both subjects and asked for the replacement.
    if (-not $ReplaceFederatedCredentials) {
      Stop-WithGuidance "$credentialName exists with a different subject." @(
        "On the identity: $($existing.subject)",
        "Computed now:    $subject",
        'Runs present the subject of the project the workspace is IN today. Read it at',
        "https://app.terraform.io/app/$TfcOrganization/workspaces/$TfcWorkspace/settings/general",
        'and then do ONE of these:',
        '  - move the workspace back into the project the identity names (no Azure change), or',
        "  - re-run with -TfcProject '<the project shown there>' -ReplaceFederatedCredentials",
        '    to recreate both credentials for it.'
      )
    }
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
# 5. Role assignments for the Terraform identity
# ===========================================================================
# Three grants, each as narrow as what infra/ actually does with it:
#
#   - Role Based Access Control Administrator, per subscription. infra/
#     creates role assignments (Function App -> Key Vault, -> Cosmos, ->
#     Foundry, the GitHub identities' roles), and Contributor cannot. It is
#     NOT narrow on its own: an unconditioned RBAC Administrator writes any
#     role assignment, Owner included. The ABAC condition
#     scripts/Set-TerraformRbacCondition.ps1 puts on it (estate review
#     2026-10-06, SEC-1) is what stops the identity escalating itself, and
#     since 2026-10-07 it also refuses Contributor, so a run cannot hand the
#     subscription-wide grant below back to itself once it is gone.
#   - "HCW Terraform Subscription Scope", per subscription: the only things
#     infra/ does at subscription scope. Create and update its resource
#     groups (main.tf, hub.tf, lab-hybrid.tf), keep the two subscription
#     budgets (budget.tf), and register var.azure_resource_providers
#     (providers.tf). Defined in scripts/terraform-identity-grants.json and
#     created here, because its assignable scopes are subscription ids and
#     those are not published in the repository. No resourceGroups/delete:
#     at subscription scope that verb deletes ANY group and everything in
#     it, which is the blast radius this step exists to remove. Removing a
#     group from infra/ is therefore an owner step: the apply destroys its
#     contents and fails on the group itself, the owner deletes the empty
#     group, and the next plan drops it from state.
#   - Contributor on each resource group infra/ declares, listed per
#     subscription in the same JSON (terraform-identity-grants.test.mjs
#     keeps the list equal to the groups infra/ declares). Everything inside
#     a group comes from here.
#
# Plus Contributor on the subscription, unless -RemoveSubscriptionContributor
# is given. SEC-1 lands in TWO steps on purpose. Step one (2026-10-07) added
# the grants above beside the wide one: a run after it proved nothing broke
# but could not prove the narrow grants SUFFICIENT while the wide one was
# still there. Step two is a run with -RemoveSubscriptionContributor: it
# stops granting subscription Contributor, reads every narrow grant back
# (section 5c), and only then deletes the identity's Contributor assignment
# on each target subscription; the next plan and apply are the proof. Doing
# both at once would have made the first run to find a missing action the
# run that had already lost the subscription-wide grant. None of this can
# lock a run out mid-apply: these assignments are not in Terraform state,
# and only this script, run by the owner, changes them.
#
# A plain run, without the switch, keeps step one's behaviour and grants
# subscription Contributor wherever it is missing. That is the rollback
# (the owner's own Owner right makes the grant, so the identity's condition,
# which refuses Contributor, does not stand in the way), and it is also why
# every re-run after step two carries the switch.
#
# What infra/ does outside the nine groups, audited for step two (ADR 0005,
# amendment "2026-10-07, step two"), and what covers it once the wide grant
# is gone:
#   - control-plane reads at subscription scope (provider list, name
#     checks, soft-deleted Key Vault lookup, role definitions): RBAC
#     Administrator, whose built-in definition carries */read, which its
#     condition does not restrict;
#   - resource-group create and update, the two subscription budgets,
#     provider registration: the custom role;
#   - role assignments anywhere in the subscription: RBAC Administrator,
#     under its condition;
#   - everything that crosses a group or a subscription (the hub and spoke
#     peerings, diagnostic settings, the data collection rule and
#     Application Insights writing to the Management workspace, the budgets'
#     action group): inside a declared group at both ends, so Contributor on
#     each group covers both halves;
#   - data-plane operations: unchanged, because Contributor carries no data
#     actions at any scope.
# The one known gap is destroy-time only: azurerm purges a deleted Cognitive
# Services account (the Foundry account) through
# Microsoft.CognitiveServices/locations/resourceGroups/deletedAccounts/delete,
# which lives at subscription scope, and the custom role carries no delete
# above a group but the budgets'. Destroying or replacing that account is
# therefore an owner step, like removing a group.
# terraform-identity-grants.test.mjs fails when infra/ gains a resource type
# nobody has classified this way.
#
# A NEW resource group in infra/ costs one extra pass once step two is done:
# the apply that creates it cannot create anything inside it, because
# Contributor on a group can only be granted once the group exists. Add the
# name to terraform-identity-grants.json in the same pull request, apply
# (the group is created, its contents fail with AuthorizationFailed), re-run
# this script with -RemoveSubscriptionContributor, and run the apply again.
# Or land the group alone first.
Write-Step 'Role assignments'

$grantsPath = Join-Path $PSScriptRoot 'terraform-identity-grants.json'
$grants = Get-Content -LiteralPath $grantsPath -Raw | ConvertFrom-Json
$scopeRoleName = $grants.subscriptionRole.Name

# Step one keeps 'Contributor' in this list; -RemoveSubscriptionContributor
# (step two, see above) takes it out, and section 5c deletes the live one.
$narrowSubscriptionRoles = @('Role Based Access Control Administrator', $scopeRoleName)
$subscriptionRoles = if ($RemoveSubscriptionContributor) {
  $narrowSubscriptionRoles
} else {
  @('Contributor') + $narrowSubscriptionRoles
}

# Which slot of terraform-identity-grants.json a subscription fills, from its
# name, the same convention the target picker above preselects by.
function Get-SubscriptionSlot {
  param([string] $Name)
  switch -Wildcard ($Name) {
    'sub-app-*' { return 'app' }
    'sub-plat-mgmt-*' { return 'mgmt' }
    'sub-plat-conn-*' { return 'conn' }
    default { return $null }
  }
}

# 5a. The subscription-scope custom role, assignable at every target. Written
# with a PUT on the definition's own id, which creates and updates alike and
# so needs no create-or-update branch; a definition that already matches is
# left alone.
$assignableScopes = @($TargetSubscriptionIds | ForEach-Object { "/subscriptions/$_" } | Sort-Object)
$wantedActions = @($grants.subscriptionRole.Actions | Sort-Object)
# Every read in this step fails closed. Invoke-Az -AllowFailure returns $null
# both for "nothing there" and for a call that failed (throttled, denied,
# timed out), and reading the second as the first would create a duplicate
# definition or a duplicate assignment (review of #984; T-703 is the same
# trap in the elevation read-back above).
function Stop-OnUnreadable {
  param([string] $What)
  if (Test-LastAzFailed) {
    Stop-WithGuidance "Could not read $What, so this step stops rather than guess." @(
      'Nothing after this point was changed. Check the sign-in and your rights',
      '(az account show), then re-run; the script skips what already exists.'
    )
  }
}

# The custom role definitions with this name, read fail-closed. Section 5c
# reads them again after the write below, so the step-two check judges the
# definition Azure holds, not the one this run meant to write.
function Get-ScopeRoleDefinition {
  $roleList = Invoke-Az @(
    'role', 'definition', 'list', '--name', $scopeRoleName, '--custom-role-only', 'true', '-o', 'json'
  ) -AllowFailure
  Stop-OnUnreadable -What "the custom role definitions named '$scopeRoleName'"
  $found = @(@($roleList) | Where-Object { $_ })
  if ($found.Count -gt 1) {
    Stop-WithGuidance "More than one custom role is named '$scopeRoleName'." @(
      'Delete the extra definition, then re-run. List them with:',
      "az role definition list --name `"$scopeRoleName`" --custom-role-only true -o table"
    )
  }
  return , $found
}

# The whole permission shape, not only actions and scopes: one permission
# block, no notActions, no data actions. A definition that drifted by hand
# (an extra block, a data action) is rewritten, never reported as matching
# (review of #984).
function Test-ScopeRoleMatches {
  param([object[]] $Definition)
  if (@($Definition).Count -ne 1) { return $false }
  $permissions = @($Definition[0].permissions)
  $heldActions = @($permissions | ForEach-Object { $_.actions } | Where-Object { $_ } | Sort-Object)
  $heldOther = @($permissions | ForEach-Object { @($_.notActions) + @($_.dataActions) + @($_.notDataActions) } | Where-Object { $_ })
  $heldScopes = @($Definition[0].assignableScopes | Sort-Object)
  return ($permissions.Count -eq 1) -and ($heldOther.Count -eq 0) -and
         (($heldActions -join ',') -eq ($wantedActions -join ',')) -and
         (($heldScopes -join ',').ToLowerInvariant() -eq ($assignableScopes -join ',').ToLowerInvariant())
}

$existingRole = Get-ScopeRoleDefinition
$roleMatches = Test-ScopeRoleMatches -Definition $existingRole
if ($roleMatches) {
  Write-Ok "$scopeRoleName — defined, assignable on $($assignableScopes.Count) subscription(s)"
} elseif ($PSCmdlet.ShouldProcess($scopeRoleName, 'create or update the custom role definition')) {
  $roleGuid = if ($existingRole.Count -eq 1) { $existingRole[0].name } else { [guid]::NewGuid().ToString() }
  $body = @{
    properties = @{
      roleName         = $scopeRoleName
      description      = $grants.subscriptionRole.Description
      type             = 'CustomRole'
      permissions      = @(@{
          actions        = $wantedActions
          notActions     = @()
          dataActions    = @()
          notDataActions = @()
        })
      assignableScopes = $assignableScopes
    }
  }
  # A file, not an inline --body: a JSON string on a Windows command line
  # loses its quotes on the way to az.
  $bodyPath = Join-Path ([System.IO.Path]::GetTempPath()) "hcw-terraform-scope-role-$roleGuid.json"
  try {
    Set-Content -LiteralPath $bodyPath -Value ($body | ConvertTo-Json -Depth 6) -Encoding utf8NoBOM
    Invoke-Az @(
      'rest', '--method', 'put',
      '--url', "https://management.azure.com$($assignableScopes[0])/providers/Microsoft.Authorization/roleDefinitions/$($roleGuid)?api-version=2022-04-01",
      '--body', "@$bodyPath"
    ) | Out-Null
  } finally {
    Remove-Item -LiteralPath $bodyPath -ErrorAction SilentlyContinue
  }
  Write-Act "$scopeRoleName — $(if ($existingRole.Count -eq 1) { 'updated' } else { 'created' })"
} else {
  Write-Act "Would create or update $scopeRoleName"
}

# A custom role written seconds ago can take a short while to resolve by
# name at a scope, and the failure ("Role ... doesn't exist") reads like a
# typo. Retried for that case only; any other role is assigned once.
function New-IdentityRoleAssignment {
  param([string] $Role, [string] $Scope, [string] $Subscription)
  $tries = if ($Role -eq $scopeRoleName) { 6 } else { 1 }
  for ($i = 1; $i -le $tries; $i++) {
    $result = Invoke-Az @(
      'role', 'assignment', 'create',
      '--assignee-object-id', $identity.principalId,
      '--assignee-principal-type', 'ServicePrincipal',
      '--role', $Role,
      '--scope', $Scope,
      '--subscription', $Subscription,
      '-o', 'json'
    ) -AllowFailure
    if (-not (Test-LastAzFailed)) { return $result }
    if ($i -lt $tries) { Start-Sleep -Seconds 10 }
  }
  throw "Could not assign '$Role' at $Scope after $tries attempt(s). Re-run the script; it skips what already exists."
}

# 5b. Assignments. Per subscription rather than once at a management group:
# this tenant has no management group hierarchy yet. When the ALZ exists, the
# subscription-scope ones collapse into a single assignment at the
# intermediate root.
foreach ($id in $TargetSubscriptionIds) {
  $scope = "/subscriptions/$id"
  $label = $subscriptionNames[$id]
  $slot = Get-SubscriptionSlot -Name $label
  $groups = if ($slot) { @($grants.resourceGroups.$slot) } else { @() }

  if (-not ($identity -and $identity.principalId)) {
    foreach ($role in $subscriptionRoles) { Write-Act "Would assign $role on $label" }
    foreach ($group in $groups) { Write-Act "Would assign Contributor on $label/$group" }
    continue
  }

  $held = Invoke-Az @(
    'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $scope,
    '--subscription', $id, '-o', 'json'
  ) -AllowFailure
  Stop-OnUnreadable -What "the identity's role assignments on $label"
  $heldNames = @($held | Where-Object { $_.scope -eq $scope } | ForEach-Object { $_.roleDefinitionName })

  foreach ($role in $subscriptionRoles) {
    if ($heldNames -contains $role) {
      Write-Ok "$label — $role"
    } elseif ($PSCmdlet.ShouldProcess("$IdentityName on $label", "assign $role at subscription scope")) {
      New-IdentityRoleAssignment -Role $role -Scope $scope -Subscription $id | Out-Null
      Write-Act "$label — $role assigned"
    } else {
      Write-Act "Would assign $role on $label"
    }
  }

  if (-not $slot) {
    Write-Warn "$label matches none of sub-app-*, sub-plat-mgmt-*, sub-plat-conn-*, so no resource-group grants are made there."
    continue
  }

  foreach ($group in $groups) {
    $groupScope = "$scope/resourceGroups/$group"
    $exists = Invoke-Az @('group', 'exists', '-n', $group, '--subscription', $id) -AllowFailure
    Stop-OnUnreadable -What "whether $label/$group exists"
    if ($exists -ne $true) {
      # Expected on a fresh estate before the first apply, and for a group
      # added to infra/ but not yet applied. Not an error: re-run after the
      # apply that creates it.
      Write-Info "$label/$group — does not exist yet; Contributor is granted on a re-run after the apply that creates it"
      continue
    }
    $groupHeld = Invoke-Az @(
      'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $groupScope,
      '--subscription', $id, '-o', 'json'
    ) -AllowFailure
    Stop-OnUnreadable -What "the identity's role assignments on $label/$group"
    $groupHeldNames =@($groupHeld | Where-Object { $_.scope -eq $groupScope } | ForEach-Object { $_.roleDefinitionName })
    if ($groupHeldNames -contains 'Contributor') {
      Write-Ok "$label/$group — Contributor"
    } elseif ($PSCmdlet.ShouldProcess("$IdentityName on $label/$group", 'assign Contributor at resource-group scope')) {
      New-IdentityRoleAssignment -Role 'Contributor' -Scope $groupScope -Subscription $id | Out-Null
      Write-Act "$label/$group — Contributor assigned"
    } else {
      Write-Act "Would assign Contributor on $label/$group"
    }
  }
}

# The condition on the RBAC Administrator assignments: constrained delegation,
# so the identity can assign what infra/ needs and never Owner, User Access
# Administrator, RBAC Administrator or Contributor, nor a Key Vault officer
# role to anything but a named human (the seeding window). The script is
# idempotent and honours -WhatIf. Without an identity (a -WhatIf discovery
# run before the identity exists) there is nothing to condition yet.
if ($identity -and $identity.principalId) {
  # Every target, stated: the condition script reads one subscription per
  # call, and this script's CLI context is the identity's home, so without the
  # list only Management was conditioned (2026-10-07, connectivity missed).
  & (Join-Path $PSScriptRoot 'Set-TerraformRbacCondition.ps1') -PrincipalId $identity.principalId -TargetSubscriptionIds $TargetSubscriptionIds -WhatIf:$WhatIfPreference
} else {
  Write-Act 'Would apply the RBAC Administrator condition (scripts/Set-TerraformRbacCondition.ps1) once the identity exists'
}

# ===========================================================================
# 5c. SEC-1 step two: Contributor at subscription scope, removed
# ===========================================================================
# Only with -RemoveSubscriptionContributor, and only once every narrow grant
# has been READ BACK from Azure rather than assumed from the writes above:
#   - Contributor on each resource group the JSON lists for the subscription,
#   - the custom role assigned at the subscription, and its definition
#     holding exactly the JSON's actions,
#   - RBAC Administrator at the subscription, every such assignment carrying
#     a condition that names Owner and Contributor (the roles it refuses).
# One missing grant on any target stops the step with nothing removed: a
# removal that runs ahead of a missing grant is an apply that fails with
# AuthorizationFailed on the owner's confirmation. The deletes honour
# -WhatIf, which prints one "Would remove" line per subscription.
function Test-RefusesRoles {
  param([object] $Assignment, [string[]] $RoleIds)
  $text = if ($Assignment.PSObject.Properties['condition']) { [string] $Assignment.condition } else { '' }
  if (-not $text) { return $false }
  $lower = $text.ToLowerInvariant()
  foreach ($roleId in $RoleIds) {
    if (-not $lower.Contains($roleId.ToLowerInvariant())) { return $false }
  }
  return $true
}

if ($RemoveSubscriptionContributor) {
  Write-Step 'SEC-1 step two: Contributor at subscription scope'

  if (-not ($identity -and $identity.principalId)) {
    Stop-WithGuidance "$IdentityName does not exist, so there is no subscription Contributor to remove." @(
      'Run this script without -RemoveSubscriptionContributor first (step one), plan',
      'and apply in HCP Terraform, then re-run it with the switch.'
    )
  }

  # The condition names roles by id. Resolved by name here, the way
  # Set-TerraformRbacCondition.ps1 resolves them, never typed by hand.
  $refusedIds = @()
  foreach ($name in @('Owner', 'Contributor')) {
    $definitions = Invoke-Az @('role', 'definition', 'list', '--name', $name, '-o', 'json') -AllowFailure
    Stop-OnUnreadable -What "the built-in role definition '$name'"
    $builtIn = @(@($definitions) | Where-Object { $_ -and $_.roleType -eq 'BuiltInRole' -and $_.roleName -eq $name })
    if ($builtIn.Count -ne 1) {
      Stop-WithGuidance "Expected one built-in role named '$name', found $($builtIn.Count)." @('Nothing was removed.')
    }
    $refusedIds += $builtIn[0].name
  }

  $missing = [System.Collections.Generic.List[string]]::new()
  $toRemove = [System.Collections.Generic.List[object]]::new()

  if (Test-ScopeRoleMatches -Definition (Get-ScopeRoleDefinition)) {
    Write-Ok "$scopeRoleName — definition holds the $($wantedActions.Count) actions in terraform-identity-grants.json"
  } else {
    $missing.Add("$scopeRoleName — the definition Azure holds differs from terraform-identity-grants.json (actions or assignable scopes)")
  }

  foreach ($id in $TargetSubscriptionIds) {
    $scope = "/subscriptions/$id"
    $label = $subscriptionNames[$id]
    $slot = Get-SubscriptionSlot -Name $label
    if (-not $slot) {
      $missing.Add("$label — matches none of sub-app-*, sub-plat-mgmt-*, sub-plat-conn-*, so it has no resource-group grants to fall back on")
      continue
    }

    $held = Invoke-Az @(
      'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $scope,
      '--subscription', $id, '-o', 'json'
    ) -AllowFailure
    Stop-OnUnreadable -What "the identity's role assignments on $label"
    $atScope = @(@($held) | Where-Object { $_ -and $_.scope -eq $scope })

    if (@($atScope | Where-Object { $_.roleDefinitionName -eq $scopeRoleName }).Count -gt 0) {
      Write-Ok "$label — $scopeRoleName"
    } else {
      $missing.Add("$label — $scopeRoleName at subscription scope")
    }

    $rbacAdmin = @($atScope | Where-Object { $_.roleDefinitionName -eq 'Role Based Access Control Administrator' })
    $conditioned = @($rbacAdmin | Where-Object { Test-RefusesRoles -Assignment $_ -RoleIds $refusedIds })
    if ($rbacAdmin.Count -eq 0) {
      $missing.Add("$label — Role Based Access Control Administrator at subscription scope")
    } elseif ($conditioned.Count -ne $rbacAdmin.Count) {
      $missing.Add("$label — Role Based Access Control Administrator without a condition refusing Owner and Contributor (scripts/Set-TerraformRbacCondition.ps1)")
    } else {
      Write-Ok "$label — Role Based Access Control Administrator, conditioned (refuses Owner and Contributor)"
    }

    foreach ($group in @($grants.resourceGroups.$slot)) {
      $groupScope = "$scope/resourceGroups/$group"
      $groupHeld = Invoke-Az @(
        'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $groupScope,
        '--subscription', $id, '-o', 'json'
      ) -AllowFailure
      if (Test-LastAzFailed) {
        $missing.Add("$label/$group — unreadable; a group that does not exist yet needs the apply that creates it")
        continue
      }
      if (@(@($groupHeld) | Where-Object { $_ -and $_.scope -eq $groupScope -and $_.roleDefinitionName -eq 'Contributor' }).Count -gt 0) {
        Write-Ok "$label/$group — Contributor"
      } else {
        $missing.Add("$label/$group — Contributor")
      }
    }

    foreach ($assignment in @($atScope | Where-Object { $_.roleDefinitionName -eq 'Contributor' })) {
      $toRemove.Add([pscustomobject]@{ Label = $label; Id = $assignment.id; Subscription = $id })
    }
  }

  if ($missing.Count -gt 0) {
    Stop-WithGuidance "$($missing.Count) narrow grant(s) could not be read back, so subscription Contributor stays where it is." (
      @('Nothing was removed. Missing:') +
      @($missing | ForEach-Object { "  $_" }) +
      @(
        '',
        'If the lines above have just written these, Azure can take a minute or two to',
        'list them: re-run with -RemoveSubscriptionContributor. A group that does not',
        'exist yet needs the apply that creates it first. A condition that does not',
        'refuse Contributor is fixed by scripts/Set-TerraformRbacCondition.ps1.'
      )
    )
  }

  if ($toRemove.Count -eq 0) {
    Write-Ok 'No target holds Contributor at subscription scope; step two is already done'
  }

  foreach ($item in $toRemove) {
    if ($PSCmdlet.ShouldProcess("$IdentityName on $($item.Label)", 'remove Contributor at subscription scope')) {
      Invoke-Az @('role', 'assignment', 'delete', '--ids', $item.Id) | Out-Null
      Write-Act "$($item.Label) — Contributor at subscription scope removed"
    } else {
      Write-Act "Would remove Contributor at subscription scope on $($item.Label)"
    }
  }

  # Read back, for the same reason the elevation above is read back, and by
  # ROLE AT SCOPE rather than by the ids just deleted: a Contributor
  # recreated under a new id between the listing and this read (a concurrent
  # plain run, which is the rollback) would pass an id check while the wide
  # grant is live (review of #996). Every target is re-read with
  # --subscription stated (#992), and an unreadable list is not a clean one.
  # Skipped under -WhatIf, where nothing was removed.
  if (-not $WhatIfPreference) {
    $stillHeld = [System.Collections.Generic.List[string]]::new()
    foreach ($id in $TargetSubscriptionIds) {
      $scope = "/subscriptions/$id"
      $label = $subscriptionNames[$id]
      $after = Invoke-Az @(
        'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $scope,
        '--subscription', $id, '-o', 'json'
      ) -AllowFailure
      if (Test-LastAzFailed) {
        $stillHeld.Add("$label — could not read the identity's assignments back")
        continue
      }
      $rows = @(@($after) | Where-Object { $_ -and $_.scope -eq $scope -and $_.roleDefinitionName -eq 'Contributor' })
      if ($rows.Count -eq 0) {
        Write-Ok "$label — no Contributor at subscription scope (read back)"
      } else {
        foreach ($row in $rows) {
          $stillHeld.Add("$label — Contributor at $($row.scope) (assignment $($row.id))")
        }
      }
    }
    if ($stillHeld.Count -gt 0) {
      Stop-WithGuidance 'Contributor at subscription scope is still held after the removal.' (
        @($stillHeld | ForEach-Object { "  $_" }) +
        @(
          '',
          'A row with a new assignment id means something granted it again while this ran',
          '(a plain run of this script is the rollback and does exactly that). Re-run with',
          '-RemoveSubscriptionContributor; it removes only what is still there. The read-back',
          'one-liner in docs/runbooks/deployment-runbook.md, section 0, shows all three.'
        )
      )
    }
  }
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
    ARM_SUBSCRIPTION_ID       <the APPLICATION subscription>

  These four names are set by HashiCorp and Microsoft, so they are exempt from
  the repository's 2-word variable rule (see the IaC Repository Standard).

  Prefer scripts/set-tfc-variables.ps1 over typing these into the UI — it sets
  all twelve workspace values in one run, and it writes ARM_SUBSCRIPTION_ID as
  the application subscription. Any target subscription would in fact work:
  every provider pins subscription_id in HCL (infra/providers.tf), so this
  value is only the provider's fallback and never decides where resources
  land. It is stated here as the application subscription so the two scripts
  agree rather than inviting a "correction".

  Then, as TERRAFORM variables in the same workspace, one per subscription the
  aliased providers target (Required-Inputs §4.1):

$(($TargetSubscriptionIds | ForEach-Object {
    # Name the variable from the subscription's own name rather than printing
    # a <role> placeholder: the convention already says which is which, and an
    # operator copying these should not have to work it out.
    $role = switch -Wildcard ($subscriptionNames[$_]) {
      'sub-app-*'       { 'subscription_app' }
      'sub-plat-mgmt-*' { 'subscription_mgmt' }
      'sub-plat-conn-*' { 'subscription_conn' }
      default           { 'subscription_<role>' }
    }
    "    {0,-24}  {1}   # {2}" -f $role, $_, $subscriptionNames[$_]
  }) -join "`n")

  Verify with a speculative plan before touching apply:

    cd infra && terraform login && terraform plan

  A plan that authenticates but shows resources to create is success. If it
  fails with AADSTS70021 ("No matching federated identity record found"), the
  subject did not match — re-run this script with the -TfcProject and
  -TfcWorkspace names copied exactly from the workspace's Settings page,
  including capitalisation and spaces.

"@ -ForegroundColor White

# ===========================================================================
# 7. Report
# ===========================================================================
# The console output scrolls away and the client id it printed is needed later,
# in another tool, by someone who may not be the person who ran this. The
# report is the durable record of what this run actually asserted.
#
# It re-reads role assignments from Azure rather than echoing what section 5
# intended, so the report states what is true after the run and not what the
# script meant to do. That difference is the entire point of writing one.
#
# Deliberately gitignored: it holds real subscription and client ids. Those are
# identifiers rather than credentials — the identity is federated and no secret
# exists — but docs/standards/variables-and-secrets.md says such identifiers
# are still not published, and a report is not an exception to it.
if (-not $WhatIfPreference) {
  Write-Step 'Report'

  $reportDirectory = Split-Path -Parent $ReportPath
  if ($reportDirectory -and -not (Test-Path $reportDirectory)) {
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
  }

  $lines = [System.Collections.Generic.List[string]]::new()
  $add = { param($text) $lines.Add($text) }

  & $add "# Terraform OIDC bootstrap report"
  & $add ''
  & $add "Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') by ``scripts/bootstrap-terraform-oidc.ps1``."
  & $add "Run by $($account.user.name) in tenant ``$TenantId``."
  & $add ''
  & $add '## Identity'
  & $add ''
  & $add '| | |'
  & $add '| --- | --- |'
  & $add "| Managed identity | ``$IdentityName`` |"
  & $add "| Resource group | ``$ResourceGroupName`` |"
  & $add "| Subscription | $($subscriptionNames[$IdentitySubscriptionId]) (``$IdentitySubscriptionId``) |"
  & $add "| Region | ``$Location`` |"
  & $add "| Client id | ``$clientId`` |"
  & $add "| Principal id | ``$(if ($identity) { $identity.principalId } else { 'n/a' })`` |"
  & $add ''
  & $add '## Federated credentials'
  & $add ''
  & $add 'Issuer `https://app.terraform.io`, audience `api://AzureADTokenExchange`.'
  & $add ''
  & $add '| Name | Subject |'
  & $add '| --- | --- |'
  foreach ($credentialName in ($subjects.Keys | Sort-Object)) {
    & $add "| ``$credentialName`` | ``$($subjects[$credentialName])`` |"
  }
  & $add ''
  & $add "The ``project`` segment is ``$TfcProject``. If a speculative plan fails with"
  & $add 'AADSTS70021, this is the value to check first — Entra matches the subject as an'
  & $add 'exact, case-sensitive string with no wildcards.'
  & $add ''
  & $add '## Role assignments'
  & $add ''
  & $add 'Read back from Azure after the run, not copied from what was requested.'
  & $add ''
  & $add '| Subscription | Roles held |'
  & $add '| --- | --- |'
  foreach ($id in $TargetSubscriptionIds) {
    $observed = 'none'
    if ($identity -and $identity.principalId) {
      $found = Invoke-Az @(
        'role', 'assignment', 'list',
        '--assignee', $identity.principalId,
        '--scope', "/subscriptions/$id",
        '--subscription', $id, '-o', 'json'
      ) -AllowFailure
      $names = @($found | ForEach-Object { $_.roleDefinitionName }) | Sort-Object -Unique
      if ($names) { $observed = ($names -join ', ') }
    }
    $flag = if ($observed -eq 'none') { ' **← Terraform cannot deploy here**' } else { '' }
    & $add "| $($subscriptionNames[$id]) | $observed$flag |"
  }
  & $add ''
  if ($RemoveSubscriptionContributor) {
    & $add 'Run with `-RemoveSubscriptionContributor` (SEC-1 step two): Contributor should be'
    & $add 'absent from every row above. A plain re-run grants it back, which is the rollback.'
  } else {
    & $add 'Run without `-RemoveSubscriptionContributor`: Contributor is granted at each'
    & $add 'subscription (SEC-1 step one, or the rollback of step two).'
  }
  & $add ''
  & $add 'Contributor on the resource groups `infra/` declares, read back the same way:'
  & $add ''
  & $add '| Subscription | Resource group | Contributor |'
  & $add '| --- | --- | --- |'
  foreach ($id in $TargetSubscriptionIds) {
    $slot = Get-SubscriptionSlot -Name $subscriptionNames[$id]
    if (-not $slot) { continue }
    foreach ($group in @($grants.resourceGroups.$slot)) {
      $state = 'no'
      if ($identity -and $identity.principalId) {
        $groupScope = "/subscriptions/$id/resourceGroups/$group"
        $found = Invoke-Az @(
          'role', 'assignment', 'list',
          '--assignee', $identity.principalId,
          '--scope', $groupScope,
          '--subscription', $id, '-o', 'json'
        ) -AllowFailure
        if (Test-LastAzFailed) { $state = 'unreadable (the group may not exist yet)' }
        elseif (@($found | Where-Object { $_.scope -eq $groupScope -and $_.roleDefinitionName -eq 'Contributor' }).Count -gt 0) { $state = 'yes' }
      }
      & $add "| $($subscriptionNames[$id]) | ``$group`` | $state |"
    }
  }
  & $add ''
  & $add '## Still to do by hand'
  & $add ''
  & $add "In HCP Terraform, workspace ``$TfcOrganization / $TfcWorkspace``:"
  & $add ''
  & $add '| Variable | Kind | Value |'
  & $add '| --- | --- | --- |'
  & $add '| `TFC_AZURE_PROVIDER_AUTH` | Environment | `true` |'
  & $add "| ``TFC_AZURE_RUN_CLIENT_ID`` | Environment | ``$clientId`` |"
  & $add "| ``ARM_TENANT_ID`` | Environment | ``$TenantId`` |"
  & $add '| `ARM_SUBSCRIPTION_ID` | Environment | the APPLICATION subscription |'
  & $add ''
  & $add 'Prefer `scripts/set-tfc-variables.ps1`, which seeds all twelve workspace'
  & $add 'values and writes ARM_SUBSCRIPTION_ID as the application subscription. The'
  & $add 'value is only the provider fallback — every provider pins subscription_id'
  & $add 'in HCL — but the two scripts should state the same thing.'
  & $add ''
  & $add 'Then verify, before any apply:'
  & $add ''
  & $add '```'
  & $add 'cd infra && terraform login && terraform plan'
  & $add '```'
  & $add ''

  Set-Content -Path $ReportPath -Value ($lines -join "`n") -Encoding utf8NoBOM
  Write-Ok "Written to $ReportPath"
}

Write-Host "  Bootstrap complete.`n" -ForegroundColor Green

# Explicit, because the script ends on Write-Host and would otherwise return
# whatever $LASTEXITCODE the last `az` call left behind — including the
# non-zero codes the -AllowFailure probes produce on purpose. Reaching this
# line at all means every check passed; say so in the only way a caller reads.
exit 0
