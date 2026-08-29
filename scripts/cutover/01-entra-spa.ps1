<#
.SYNOPSIS
    Cutover step 1 — finish the Entra registration so an admin can sign in.

.DESCRIPTION
    Migration-Plan §6 / TODO.md. Most of §2.2 was already done before
    this script existed — verified 2026-08-22 against the live tenant:

        app registration  HCWSite API  ac696e96-e203-47be-ade8-c35ece8a6c4a
        identifier URI    api://ac696e96-e203-47be-ade8-c35ece8a6c4a   [done]
        exposed scope     access_as_admin                             [done]
        app roles         Admin, LabAgent (both enabled)              [done]
        SPA platform      -                                           [THIS SCRIPT]
        Admin role assigned to a user                                 [THIS SCRIPT]

    So this adds the SPA redirect URIs and assigns the Admin app role. It uses
    a SPA platform on the EXISTING registration rather than a second
    registration — TODO.md allows either, and one registration means the
    SPA requests a scope on its own app, which consents automatically and
    removes the single highest-risk mismatch in the system (a SPA client id and
    an API audience that disagree).

    The three build variables are already set in the GitHub repository:
        VITE_ENTRA_CLIENT_ID  = ac696e96-e203-47be-ade8-c35ece8a6c4a
        VITE_ENTRA_TENANT_ID  = 1a2fce27-b5f6-43c7-a86e-cf0bb74d4672
        VITE_ENTRA_API_SCOPE  = api://ac696e96-.../access_as_admin

    WHY THE REDIRECT URIs ARE WHAT THEY ARE. msalConfig.js sets
    `redirectUri: window.location.origin`, so every origin the admin UI is
    served from must be listed EXACTLY — no trailing slash, no path. The Static
    Web App's own hostname is included because §6 step 2 runs the site there,
    on that origin, before DNS moves.

.PARAMETER AdminUpn
    User principal name to grant the Admin app role. Defaults to the signed-in
    user. This is guard gate 1; gate 2 is the `admins/{oid}` registry, seeded
    separately with CMS_BOOTSTRAP_ALLOWED_UIDS / _EMAILS.

.PARAMETER WhatIf
    Print what would change and exit without writing.

.EXAMPLE
    ./01-entra-spa.ps1 -WhatIf
    ./01-entra-spa.ps1
    ./01-entra-spa.ps1 -AdminUpn someone@hybridcloudworks.com

.NOTES
    Requires: az CLI, signed in (`az login`) as someone who can update app
    registrations and assign app roles — Application Administrator, Cloud
    Application Administrator, or Global Administrator.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string] $AdminUpn,
    [string] $ApiAppId = 'ac696e96-e203-47be-ade8-c35ece8a6c4a',
    [string[]] $RedirectUris = @(
        'https://hybridcloudworks.com',
        'https://www.hybridcloudworks.com',
        'https://calm-ground-0d0e6a010.7.azurestaticapps.net',
        'http://localhost:5173'
    )
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Write-Step 'Preflight'
$account = az account show --query '{user:user.name,tenant:tenantId}' -o json | ConvertFrom-Json
Write-Host "signed in as : $($account.user)"
Write-Host "tenant       : $($account.tenant)"

$app = az ad app show --id $ApiAppId -o json | ConvertFrom-Json
if (-not $app) { throw "App registration $ApiAppId not found in this tenant." }
$objectId = $app.id
Write-Host "app          : $($app.displayName)  (object $objectId)"

# These are preconditions, not things this script creates. If any is missing the
# tenant is not in the state this script was written against, and guessing at
# the difference is worse than stopping.
$scopes = @($app.api.oauth2PermissionScopes | ForEach-Object { $_.value })
$roles = @($app.appRoles | Where-Object { $_.isEnabled } | ForEach-Object { $_.value })
if ($scopes -notcontains 'access_as_admin') {
    throw "Expected scope 'access_as_admin' is not exposed. Expose an API -> Add a scope, then re-run."
}
if ($roles -notcontains 'Admin') {
    throw "Expected app role 'Admin' is missing or disabled. Add it under App roles, then re-run."
}
Write-Host "scope        : access_as_admin  [ok]"
Write-Host "app role     : Admin            [ok]"

Write-Step 'SPA redirect URIs'
$current = @($app.spa.redirectUris)
Write-Host "current: $(if ($current) { $current -join ', ' } else { '(none)' })"
Write-Host "desired: $($RedirectUris -join ', ')"

$missing = @($RedirectUris | Where-Object { $current -notcontains $_ })
if (-not $missing) {
    Write-Host 'nothing to add' -ForegroundColor Green
}
elseif ($PSCmdlet.ShouldProcess($app.displayName, "add SPA redirect URIs: $($missing -join ', ')")) {
    # Union rather than replace: a redirect URI someone added by hand for a
    # preview slot is not this script's to delete.
    $union = @($current + $RedirectUris | Select-Object -Unique)
    $body = @{ spa = @{ redirectUris = $union } } | ConvertTo-Json -Depth 5 -Compress
    $tmp = New-TemporaryFile
    try {
        Set-Content -Path $tmp -Value $body -Encoding utf8
        az rest --method PATCH `
            --url "https://graph.microsoft.com/v1.0/applications/$objectId" `
            --headers 'Content-Type=application/json' `
            --body "@$tmp" | Out-Null
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Write-Host "added: $($missing -join ', ')" -ForegroundColor Green
}

Write-Step 'Admin app-role assignment (guard gate 1)'
if (-not $AdminUpn) { $AdminUpn = $account.user }
Write-Host "user: $AdminUpn"

# A B2B guest's UPN is not their mail address — spatino@hybridcloudworks.com
# is really spatino_hybridcloudworks.com#EXT#@<tenant>.onmicrosoft.com, and
# `az ad user show --id <mail>` does not resolve it. Try the UPN, then fall
# back to a directory filter on mail/otherMails, which is what actually finds
# a guest.
$user = az ad user show --id $AdminUpn -o json 2>$null | ConvertFrom-Json
if (-not $user) {
    $escaped = $AdminUpn.Replace("'", "''")
    $filter = [uri]::EscapeDataString("mail eq '$escaped' or userPrincipalName eq '$escaped'")
    $found = az rest --method GET `
        --url "https://graph.microsoft.com/v1.0/users?`$filter=$filter&`$select=id,displayName,userPrincipalName,mail" `
        -o json 2>$null | ConvertFrom-Json
    $user = $found.value | Select-Object -First 1
    if ($user) { Write-Host "resolved guest UPN: $($user.userPrincipalName)" }
}
if (-not $user) {
    $hint = 'az ad user list --query "[].{n:displayName,upn:userPrincipalName,mail:mail}" -o table'
    throw "User '$AdminUpn' not found by UPN or mail. List candidates with: $hint"
}

# The role is assigned on the API app's SERVICE PRINCIPAL, not on the app
# registration. Assigning it on the registration is a no-op that looks like it
# worked, which is the usual way this step is got wrong.
$sp = az ad sp show --id $ApiAppId -o json 2>$null | ConvertFrom-Json
if (-not $sp) {
    throw "No service principal for $ApiAppId. Create one with: az ad sp create --id $ApiAppId"
}
$adminRoleId = ($app.appRoles | Where-Object { $_.value -eq 'Admin' }).id

$existing = az rest --method GET `
    --url "https://graph.microsoft.com/v1.0/users/$($user.id)/appRoleAssignments" `
    -o json | ConvertFrom-Json
$already = $existing.value | Where-Object { $_.appRoleId -eq $adminRoleId -and $_.resourceId -eq $sp.id }

if ($already) {
    Write-Host 'already assigned' -ForegroundColor Green
}
elseif ($PSCmdlet.ShouldProcess($AdminUpn, 'assign the Admin app role')) {
    $body = @{ principalId = $user.id; resourceId = $sp.id; appRoleId = $adminRoleId } |
        ConvertTo-Json -Compress
    $tmp = New-TemporaryFile
    try {
        Set-Content -Path $tmp -Value $body -Encoding utf8
        az rest --method POST `
            --url "https://graph.microsoft.com/v1.0/users/$($user.id)/appRoleAssignments" `
            --headers 'Content-Type=application/json' `
            --body "@$tmp" | Out-Null
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Write-Host 'assigned' -ForegroundColor Green
}

Write-Step 'Result'
$after = az ad app show --id $ApiAppId -o json | ConvertFrom-Json
Write-Host "SPA redirect URIs now: $(@($after.spa.redirectUris) -join ', ')"
Write-Host ''
Write-Host 'Gate 2 is separate and still open: the admins/{oid} registry.' -ForegroundColor Yellow
Write-Host 'Seed it with CMS_BOOTSTRAP_ALLOWED_EMAILS (or _UIDS) on the Function App,'
Write-Host 'then call POST /api/bootstrapCurrentUserAdmin once signed in. Both gates'
Write-Host 'must pass — a token with the Admin role but no registry row is still 403.'
