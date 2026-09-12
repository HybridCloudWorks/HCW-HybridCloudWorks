<#
.SYNOPSIS
    A dev-only Entra client, so localhost never appears on a production one.

.DESCRIPTION
    ===========================================================================
    WHY LOCALHOST DOES NOT BELONG ON THE PRODUCTION REGISTRATION (#521)
    ===========================================================================
    This repository already wrote the argument, in
    `functions/src/lib/auth/cors.js`:

        LOCALHOST DOES NOT SURVIVE TO PRODUCTION. [...] `http://localhost:5173`
        in a production allowlist means any page running on a victim's machine —
        a malicious local dev server, a compromised `npm postinstall`, a rogue
        Electron app — can make cross-origin calls to production carrying the
        victim's token.

    It applies with more force to a redirect URI: a process listening on
    127.0.0.1 on an admin's laptop can complete an authorization-code redirect
    for the production client id and receive the code. CORS gates its localhost
    entry on `NODE_ENV`; an app registration has no equivalent gate, so the only
    control is not listing it. Microsoft's Zero Trust guidance says the same:
    "Make sure the redirect URIs don't have localhost, *.azurewebsites.net,
    wildcards, or URL shorteners."

    The fix was applied in one place and left open in the other. This closes it.

    ===========================================================================
    WHAT THIS REGISTRATION IS ACTUALLY FOR
    ===========================================================================
    Signing in against a LOCAL Functions host. It is not a way to reach
    production from a dev build and never was: `cors.js` refuses a localhost
    origin against the deployed API whenever `NODE_ENV=production`, so that path
    is already closed. Do not "fix" a local development problem by adding
    localhost back to 02-entra-spa-client.ps1.

    Both Vite ports are here. 5173 is `npm run dev`; 4173 is `npm run preview`,
    and `cors.js` records that a hardcoded 5173-only pair was narrower than the
    real behaviour.

.PARAMETER Prune
    Replace the redirect URIs with exactly the list below rather than unioning.

.PARAMETER WhatIf
    Print what would change and exit without writing.

.EXAMPLE
    ./03-entra-dev-client.ps1 -WhatIf
    ./03-entra-dev-client.ps1

.NOTES
    Requires: az CLI, signed in as Application Administrator, Cloud Application
    Administrator, or Global Administrator.

    The app id it prints goes in a LOCAL `frontend/.env`, never in a repository
    variable and never in a deploy.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string] $DisplayName = 'HCWSite SPA (dev)',
    [string] $ApiAppId = 'ac696e96-e203-47be-ade8-c35ece8a6c4a',
    [switch] $Prune,
    [string[]] $RedirectUris = @(
        'http://localhost:5173/auth/callback',
        'http://localhost:4173/auth/callback'
    )
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Write-Step 'Preflight'
$account = az account show --query '{user:user.name,tenant:tenantId}' -o json | ConvertFrom-Json
Write-Host "signed in as : $($account.user)"
Write-Host "tenant       : $($account.tenant)"

$api = az ad app show --id $ApiAppId -o json | ConvertFrom-Json
$scope = $api.api.oauth2PermissionScopes | Where-Object { $_.value -eq 'access_as_admin' }
if (-not $scope) { throw "The API exposes no 'access_as_admin' scope. Run 01-entra-api.ps1 first." }

Write-Step 'Dev registration'
$candidates = @(az ad app list --display-name $DisplayName -o json | ConvertFrom-Json)
# Fail rather than guess. Display names are not unique in a directory, so
# -First 1 would patch whichever registration Graph happened to return first —
# silently, and with writes. An operator who is shown two can disambiguate; a
# script that quietly picks one cannot be corrected after the fact.
#
# `$candidates`, not `$matches`: the latter is a PowerShell automatic variable
# that `-match` overwrites, and a name collision there fails in a way nobody
# reads the script for.
if ($candidates.Count -gt 1) {
    Write-Host 'More than one registration matches that display name:' -ForegroundColor Red
    $candidates | ForEach-Object { Write-Host "  $($_.appId)  $($_.displayName)" }
    throw "Ambiguous -DisplayName '$DisplayName'. Rename the duplicates, or pass an exact -DisplayName."
}
$dev = $candidates | Select-Object -First 1
if ($dev) {
    Write-Host "found existing: $($dev.appId)"
}
elseif ($PSCmdlet.ShouldProcess($DisplayName, 'create the dev app registration')) {
    $dev = az ad app create --display-name $DisplayName --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
    Write-Host "created: $($dev.appId)"
}
else {
    Write-Host 'would create the registration; nothing further to do in -WhatIf'
    return
}

Write-Step 'Redirect URIs'
$current = @($dev.spa.redirectUris)
$target = if ($Prune) { @($RedirectUris) } else { @($current + $RedirectUris | Select-Object -Unique) }
Write-Host "current: $(if ($current) { $current -join ', ' } else { '(none)' })"
Write-Host "desired: $($target -join ', ')"

if ($PSCmdlet.ShouldProcess($DisplayName, "set redirect URIs: $($target -join ', ')")) {
    $body = @{
        spa                    = @{ redirectUris = [string[]]$target }
        requiredResourceAccess = [object[]]@(
            @{
                resourceAppId  = $ApiAppId
                resourceAccess = [object[]]@(@{ id = $scope.id; type = 'Scope' })
            }
        )
    } | ConvertTo-Json -Depth 8 -Compress
    Write-Host "  $body"
    $tmp = New-TemporaryFile
    try {
        Set-Content -Path $tmp -Value $body -Encoding utf8
        az rest --method PATCH `
            --url "https://graph.microsoft.com/v1.0/applications/$($dev.id)" `
            --headers 'Content-Type=application/json' --body "@$tmp" | Out-Null
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }

    az ad sp create --id $dev.appId -o none 2>$null
    az ad app permission admin-consent --id $dev.appId | Out-Null
}

Write-Step 'Result'
Write-Host ''
Write-Host "  VITE_ENTRA_CLIENT_ID = $($dev.appId)   # frontend/.env ONLY" -ForegroundColor Green
Write-Host ''
Write-Host 'Local use only. This id must never reach a repository variable or a'
Write-Host 'deploy: the production registration lists no localhost on purpose,'
Write-Host 'and that is the whole point of this one existing.'
