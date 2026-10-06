#Requires -Version 7.2
<#
.SYNOPSIS
    Put an ABAC condition on every "Role Based Access Control Administrator"
    assignment the HCP Terraform run identity holds, so it can assign the
    roles infra/ needs and cannot escalate itself (estate review 2026-10-06,
    finding SEC-1).

.DESCRIPTION
    scripts/bootstrap-terraform-oidc.ps1 grants the Terraform identity
    Contributor + Role Based Access Control Administrator at subscription
    scope. Its comment said RBAC Administrator "cannot grant Owner or User
    Access Administrator". That is not what the role does: without a
    condition it writes ANY role assignment, so a compromised workspace, a
    leaked TFC token, or a malicious provider executed during a plan could
    assign itself Owner, or Key Vault Secrets Officer on kv-site-prod-cus-01,
    and read every production credential.

    Microsoft's answer is constrained delegation: the same role with an ABAC
    condition on roleAssignments/write and /delete. This script applies the
    one condition this estate needs, built from role NAMES resolved live
    (never a GUID typed by hand):

      roleAssignments/write is allowed unless the role being assigned is
        Owner, User Access Administrator, Role Based Access Control
        Administrator, Key Vault Administrator, Key Vault Data Access
        Administrator, Key Vault Secrets Officer, Key Vault Crypto Officer
        or Key Vault Certificates Officer
      — with one exception: Key Vault Secrets Officer may be assigned to a
        USER principal, which is the admin_object_ids seeding window in
        infra/keyvault.tf (a named human, for the minutes of a seed). It may
        never be assigned to a service principal or managed identity, which
        is the self-grant the condition exists to refuse.

      roleAssignments/delete is allowed unless the assignment being removed
        is Owner, User Access Administrator or Role Based Access Control
        Administrator, so a run cannot strip the owner's access either.

    Everything infra/ assigns today passes: Key Vault Secrets User, the two
    custom HCW roles, Crypto Service Encryption User, the Storage data roles,
    Website Contributor, Reader, Log Analytics Reader, Monitoring Reader,
    Cognitive Services OpenAI User, Azure Connected Machine Onboarding, and
    the seeding grant above. Nothing in infra/ assigns a denied role.

    Idempotent: an assignment that already carries exactly this condition is
    reported and left alone. One that carries none, or a different one, is
    deleted and re-created at the same scope with the condition (Azure has no
    in-place update for a condition through the CLI). The gap between the two
    calls is seconds; HCP Terraform runs are owner-confirmed, so none is in
    flight while this runs.

    Run from a desktop with az signed in to the tenant as the owner (Owner or
    User Access Administrator on each subscription the identity deploys to).
    bootstrap-terraform-oidc.ps1 calls this at the end of its step 5 with
    -PrincipalId, so a fresh bootstrap lands the condition without a second
    command.

.PARAMETER IdentityName
    The Terraform run identity. Default: id-plat-terraform-prod-cus-01.

.PARAMETER ResourceGroupName
    Where it lives. Default: rg-mgmt-boot-prod-cus.

.PARAMETER SubscriptionName
    The subscription holding the identity, by name. Default:
    sub-plat-mgmt-prod-cus.

.PARAMETER PrincipalId
    Skip the identity lookup and use this principal id. The bootstrap script
    passes it.

.EXAMPLE
    pwsh -NoProfile -File scripts/Set-TerraformRbacCondition.ps1 -WhatIf

    Prints what would change and the condition text, touches nothing.

.EXAMPLE
    pwsh -NoProfile -File scripts/Set-TerraformRbacCondition.ps1

    Applies it. Success looks like one "conditioned" line per subscription
    and a final listing where every RBAC Administrator row shows a condition.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $IdentityName = 'id-plat-terraform-prod-cus-01',
  [string] $ResourceGroupName = 'rg-mgmt-boot-prod-cus',
  [string] $SubscriptionName = 'sub-plat-mgmt-prod-cus',
  [string] $PrincipalId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RoleName = 'Role Based Access Control Administrator'

# The roles a run may never hand out, by name. Resolved to ids live, below.
$DeniedOnWrite = @(
  'Owner',
  'User Access Administrator',
  'Role Based Access Control Administrator',
  'Key Vault Administrator',
  'Key Vault Data Access Administrator',
  'Key Vault Secrets Officer',
  'Key Vault Crypto Officer',
  'Key Vault Certificates Officer'
)
# The one denied role that a USER principal may still receive (the seeding window).
$UserOnlyOnWrite = 'Key Vault Secrets Officer'
# The assignments a run may never remove.
$DeniedOnDelete = @(
  'Owner',
  'User Access Administrator',
  'Role Based Access Control Administrator'
)

function Invoke-AzJson {
  param([string[]] $Arguments)
  # stdout and stderr apart. With 2>&1 alone, az's WARNING lines (it prints
  # one on `role assignment create --condition`) land in the text handed to
  # ConvertFrom-Json and the parse fails AFTER the command has already run —
  # which on the owner's first real run left the script stopped between a
  # delete and a create. Native stderr arrives as ErrorRecord objects; the
  # rest is stdout.
  $result = & az @Arguments 2>&1
  $stderr = @($result | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() })
  $stdout = @($result | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() })
  if ($LASTEXITCODE -ne 0) {
    throw "az $($Arguments -join ' ') failed: $($stderr -join ' ') $($stdout -join ' ')"
  }
  $warnings = @($stderr | Where-Object { $_ -match '^WARNING' })
  foreach ($w in $warnings) { Write-Host "  (az) $w" }
  $text = ($stdout -join "`n").Trim()
  if (-not $text) { return $null }
  return ($text | ConvertFrom-Json)
}

function Get-RoleDefinitionId {
  param([string] $Name)
  $defs = @(Invoke-AzJson @('role', 'definition', 'list', '--name', $Name, '-o', 'json'))
  $builtIn = @($defs | Where-Object { $_.roleType -eq 'BuiltInRole' -and $_.roleName -eq $Name })
  if ($builtIn.Count -ne 1) {
    throw "Expected exactly one built-in role named '$Name', found $($builtIn.Count)."
  }
  # `name` on a role definition is its GUID; `id` is the full ARM path.
  return $builtIn[0].name
}

function New-ConditionText {
  param([hashtable] $Ids)
  $deniedWrite = ($DeniedOnWrite | ForEach-Object { $Ids[$_] }) -join ', '
  $deniedDelete = ($DeniedOnDelete | ForEach-Object { $Ids[$_] }) -join ', '
  $userOnly = $Ids[$UserOnlyOnWrite]
  # One line. Azure normalises whitespace in stored conditions, and a one-line
  # string compares reliably against what `az role assignment list` returns.
  return (
    "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR " +
    "(@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAllValues:GuidNotEquals {$deniedWrite}) OR " +
    "(@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$userOnly} AND " +
    "@Request[Microsoft.Authorization/roleAssignments:PrincipalType] ForAnyOfAnyValues:StringEqualsIgnoreCase {'User'})) AND " +
    "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR " +
    "(@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAllValues:GuidNotEquals {$deniedDelete}))"
  )
}

function Compare-Condition {
  param([string] $Stored, [string] $Wanted)
  if (-not $Stored) { return $false }
  $norm = { param($s) ($s -replace '\s+', '').ToLowerInvariant() }
  return ((& $norm $Stored) -eq (& $norm $Wanted))
}

# ---------------------------------------------------------------------------
$account = Invoke-AzJson @('account', 'show', '-o', 'json')
Write-Host "Signed in to tenant $($account.tenantId) as $($account.user.name)"

if (-not $PrincipalId) {
  $identity = Invoke-AzJson @(
    'identity', 'show', '-n', $IdentityName, '-g', $ResourceGroupName,
    '--subscription', $SubscriptionName, '-o', 'json'
  )
  $PrincipalId = $identity.principalId
  Write-Host "Identity $IdentityName -> principal $PrincipalId"
}

$ids = @{}
foreach ($name in ($DeniedOnWrite + $DeniedOnDelete | Select-Object -Unique)) {
  $ids[$name] = Get-RoleDefinitionId -Name $name
  Write-Host ("  {0,-42} {1}" -f $name, $ids[$name])
}
$condition = New-ConditionText -Ids $ids
Write-Host ''
Write-Host 'Condition:'
Write-Host "  $condition"
Write-Host ''

# No --role beside --all: az 2.x resolves a role NAME against a scope it does
# not have when --all is given and crashes with "No value for given
# attribute" (seen on the owner's first run, 2026-10-06). Every assignment
# of the identity is read and the role is filtered here.
function Get-RbacAdminAssignments {
  param([string] $Principal)
  $all = @(Invoke-AzJson @('role', 'assignment', 'list', '--assignee', $Principal, '--all', '-o', 'json'))
  return @($all | Where-Object { $_.roleDefinitionName -eq $RoleName })
}

$assignments = Get-RbacAdminAssignments -Principal $PrincipalId

# Recovery path: the bootstrap grants Contributor and RBAC Administrator at
# the same subscription scopes, so a Contributor scope with no RBAC
# Administrator beside it is a half-finished run (a delete that was not
# followed by its create). Re-create there, with the condition, rather than
# stopping on "run bootstrap first".
$contributorScopes = @(
  Invoke-AzJson @('role', 'assignment', 'list', '--assignee', $PrincipalId, '--all', '-o', 'json') |
    Where-Object { $_.roleDefinitionName -eq 'Contributor' -and $_.scope -match '^/subscriptions/[^/]+$' } |
    ForEach-Object { $_.scope }
)
$heldScopes = @($assignments | ForEach-Object { $_.scope })
foreach ($scope in $contributorScopes) {
  if ($heldScopes -contains $scope) { continue }
  if (-not $PSCmdlet.ShouldProcess("$RoleName on $scope (missing beside Contributor)", 'create with the condition')) {
    Write-Host "Would create $scope (missing beside Contributor)"
    continue
  }
  Invoke-AzJson @(
    'role', 'assignment', 'create',
    '--assignee-object-id', $PrincipalId,
    '--assignee-principal-type', 'ServicePrincipal',
    '--role', $RoleName,
    '--scope', $scope,
    '--condition-version', '2.0',
    '--condition', $condition,
    '-o', 'json'
  ) | Out-Null
  Write-Host "created     $scope (was missing beside Contributor)"
}
if ($assignments.Count -eq 0 -and $contributorScopes.Count -eq 0) {
  throw "The identity holds no '$RoleName' and no subscription-scope Contributor assignment. Run scripts/bootstrap-terraform-oidc.ps1 first."
}

foreach ($a in $assignments) {
  $stored = if ($a.PSObject.Properties['condition']) { [string] $a.condition } else { '' }
  if (Compare-Condition -Stored $stored -Wanted $condition) {
    Write-Host "OK          $($a.scope) already carries the condition"
    continue
  }
  $state = if ($stored) { 'a different condition' } else { 'no condition' }
  if (-not $PSCmdlet.ShouldProcess("$RoleName on $($a.scope) ($state)", 'delete and re-create with the condition')) {
    Write-Host "Would fix   $($a.scope) ($state)"
    continue
  }
  Invoke-AzJson @('role', 'assignment', 'delete', '--ids', $a.id, '-o', 'json') | Out-Null
  Invoke-AzJson @(
    'role', 'assignment', 'create',
    '--assignee-object-id', $PrincipalId,
    '--assignee-principal-type', 'ServicePrincipal',
    '--role', $RoleName,
    '--scope', $a.scope,
    '--condition-version', '2.0',
    '--condition', $condition,
    '-o', 'json'
  ) | Out-Null
  Write-Host "conditioned $($a.scope)"
}

Write-Host ''
Write-Host "Verification ($RoleName rows for the identity; every row should show a condition):"
$after = Get-RbacAdminAssignments -Principal $PrincipalId
foreach ($a in $after) {
  $has = if ($a.PSObject.Properties['condition'] -and $a.condition) { 'condition present' } else { 'NO CONDITION' }
  Write-Host "  $($a.scope)  $has"
}
