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
  granted Contributor + Role Based Access Control Administrator on each one,
  separately — there is no management group in this tenant to inherit from, so
  a subscription absent from this list is a subscription Terraform cannot
  touch. Defaults to IdentitySubscriptionId alone.

  Pass all four platform/application subscriptions in the normal case. Order
  does not matter and duplicates are ignored.

.PARAMETER TfcOrganization
  HCP Terraform organization name, case-sensitive. Default: HybridCloudWorks.

.PARAMETER TfcProject
  HCP Terraform project name, case-sensitive. Defaults to Site, which is where
  the hcw-azure workspace lives. A workspace created without choosing a project
  lands in "Default Project" instead — including the space.

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
  REVIEW.md's rule is that real values never enter tracked files.

  Skipped under -WhatIf: there would be nothing true to report.

.PARAMETER WhatIf
  Print every change without making one. Signing in still happens — it reads
  your directory, it does not change it, and nothing can be inspected without
  it.

.EXAMPLE
  # Preview, no arguments. The tenant comes from the Azure CLI sign-in, and
  # the subscriptions are offered as numbered lists with the ones matching the
  # naming convention preselected.
  ./scripts/bootstrap-terraform-oidc.ps1 -WhatIf

.EXAMPLE
  # Same, on a machine with no browser of its own.
  ./scripts/bootstrap-terraform-oidc.ps1 -DeviceCode
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
  # as an exact, case-sensitive string. They are the live values, verified
  # against the HCP Terraform API on 2026-08-19 — every one of them was wrong
  # before that (org HybridCloudWorks, workspace hybridcloudworks-azure and
  # project "Default Project" were assumptions, and the first two named things
  # that do not exist).
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
  Write-Info 'The identity is granted Contributor + RBAC Administrator on each.'
  Write-Info 'A subscription missing here is one Terraform cannot touch, and the'
  Write-Info 'failure arrives partway through an apply rather than at plan.'
  # Preselect exactly what the configuration targets: the three subscriptions
  # behind the default, mgmt and conn providers. Identity is deliberately not
  # among them — that landing zone holds nothing (providers.tf).
  $preselected = @($visible | Where-Object {
      $_.name -like 'sub-app-*' -or $_.name -like 'sub-plat-mgmt-*' -or $_.name -like 'sub-plat-conn-*'
    })
  $TargetSubscriptionIds = @((Select-OptionSet -Title 'Deployment targets' -Options $visible `
        -Label ${function:Format-Subscription} -Preselected $preselected).id)
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

# Assigned per subscription rather than once at a management group: this tenant
# has no management group hierarchy yet. When the ALZ exists, these collapse
# into a single assignment at the intermediate root and this loop goes away.
foreach ($id in $TargetSubscriptionIds) {
  $scope = "/subscriptions/$id"
  $label = $subscriptionNames[$id]

  if (-not ($identity -and $identity.principalId)) {
    foreach ($role in $requiredRoles) { Write-Act "Would assign $role on $label" }
    continue
  }

  $held = Invoke-Az @(
    'role', 'assignment', 'list', '--assignee', $identity.principalId, '--scope', $scope, '-o', 'json'
  ) -AllowFailure
  $heldNames = @($held | ForEach-Object { $_.roleDefinitionName })

  foreach ($role in $requiredRoles) {
    if ($heldNames -contains $role) {
      Write-Ok "$label — $role"
    } elseif ($PSCmdlet.ShouldProcess("$IdentityName on $label", "assign $role at subscription scope")) {
      Invoke-Az @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $identity.principalId,
        '--assignee-principal-type', 'ServicePrincipal',
        '--role', $role,
        '--scope', $scope
      ) | Out-Null
      Write-Act "$label — $role assigned"
    } else {
      Write-Act "Would assign $role on $label"
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
  aliased providers target (REVIEW.md §4.1):

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
# exists — but REVIEW.md's rule is that real values never enter tracked
# files, and a report is not an exception to it.
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
