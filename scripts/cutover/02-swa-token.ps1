<#
.SYNOPSIS
    Cutover step 2 — put the Static Web App deploy token into GitHub.

.DESCRIPTION
    Migration_Plan §6 step 1 / REVIEW.md §4.3. `deploy-azure-frontend.yml` needs
    the repository secret AZURE_STATIC_WEB_APPS_API_TOKEN. The repository
    currently holds NO secrets at all, so this is genuinely missing rather than
    stale — and any value recorded before the centralus rebuild is dead,
    because the rebuild reissued it.

    The token is also a Terraform output (`swa_token`, sensitive). This script
    reads it from Azure instead, so it works without a state download and
    without the token ever being written to a file.

.PARAMETER Rotate
    Reissue the token before storing it. Use if the current value may have
    leaked. This INVALIDATES the existing token — any other pipeline using it
    breaks.

.PARAMETER WhatIf
    Show what would happen without writing the secret.

.EXAMPLE
    ./02-swa-token.ps1
    ./02-swa-token.ps1 -Rotate

.NOTES
    Requires: az CLI signed in with reader+ on the SWA, and gh CLI authenticated
    with admin rights on the repository (`gh auth status`).

    The token is passed to gh over stdin, never as an argument, so it does not
    land in the shell history or the process list.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $SwaName = 'stapp-site-prod-cus-01',
    [string] $ResourceGroup = 'rg-web-site-prod-cus',
    [string] $Repo = 'HybridCloudWorks/HCW-HybridCloudWorks',
    [switch] $Rotate
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Write-Step 'Preflight'
$swa = az staticwebapp show --name $SwaName --resource-group $ResourceGroup `
    --query '{host:defaultHostname,sku:sku.name}' -o json | ConvertFrom-Json
Write-Host "static web app : $SwaName"
Write-Host "hostname       : $($swa.host)"
Write-Host "sku            : $($swa.sku)"

gh auth status 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host $_ }

if ($Rotate) {
    if ($PSCmdlet.ShouldProcess($SwaName, 'RESET the deployment token (invalidates the current one)')) {
        az staticwebapp secrets reset-api-key --name $SwaName --resource-group $ResourceGroup | Out-Null
        Write-Host 'token reissued' -ForegroundColor Yellow
    }
}

Write-Step 'Read token'
$token = az staticwebapp secrets list --name $SwaName --resource-group $ResourceGroup `
    --query 'properties.apiKey' -o tsv
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Could not read the deployment token.' }
Write-Host "token read: $($token.Length) characters (value not printed)"

Write-Step 'Store as a repository secret'
if ($PSCmdlet.ShouldProcess($Repo, 'set AZURE_STATIC_WEB_APPS_API_TOKEN')) {
    # --body would put the token in the process list; stdin does not.
    $token | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo $Repo
    Write-Host 'secret set' -ForegroundColor Green
}

Write-Step 'Verify'
gh secret list --repo $Repo | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host 'Next, and it is a separate decision:' -ForegroundColor Yellow
Write-Host '  deploy-azure-frontend.yml is still gated with `if: ${{ false }}`.'
Write-Host '  Enabling it is a reviewed change — see .github/wiki/Cutover-Runbook.md step 2.'
Write-Host '  The first run publishes to the *.azurestaticapps.net preview host;'
Write-Host '  DNS does not move until step 3, so it is safe while Firebase is live.'
