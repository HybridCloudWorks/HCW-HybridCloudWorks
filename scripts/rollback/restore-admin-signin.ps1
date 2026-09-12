<#
.SYNOPSIS
    Break-glass: put the API registration back into a state that can complete a
    sign-in, and print the client id to roll the frontend back to.

.DESCRIPTION
    Step 1 of docs/runbooks/admin-signin-rollback.md. Run this, then dispatch
    the frontend deploy with the client id it prints.

    ===========================================================================
    WHY THIS IS A SCRIPT AND NOT A LINE IN THE RUNBOOK
    ===========================================================================
    Two rules meet here and appear to conflict. The docs redaction gate
    (`scripts/docs/check_redaction.py`) rejects any real GUID under `docs/`. The
    working agreement rejects any placeholder in a line meant to be pasted,
    because a pasted `<your-id>` has cost this project real time.

    A rollback runbook full of `00000000-…` placeholders satisfies the first and
    fails the operator. Putting the identifiers here — `scripts/` is not
    scanned — satisfies both: the runbook says "run this", and the values it
    needs are concrete, in one place, next to the other Entra scripts that
    already hold them.

    ===========================================================================
    WHY IT IS NOT A WORKFLOW
    ===========================================================================
    Because it cannot be. The GitHub deploy identity is a user-assigned managed
    identity holding Azure RBAC and no Entra directory rights, which
    `infra/oidc.tf` explains at length — Azure Owner does not grant the ability
    to write an app registration. Granting CI Application Administrator so that
    a rollback is one click would hand every future workflow run the ability to
    rewrite app registrations, permanently, to save one command during an
    incident that may never happen.

    So this step needs a human with directory permission. The parts that CAN be
    automated are: `deploy-azure-frontend.yml` takes an
    `entra_client_id_override` input, so no repository-variable write is needed
    either.

.PARAMETER WhatIf
    Print what would change and exit without writing.

.EXAMPLE
    ./restore-admin-signin.ps1 -WhatIf
    ./restore-admin-signin.ps1

.NOTES
    Requires: az CLI, signed in as Application Administrator, Cloud Application
    Administrator, or Global Administrator.

    This is a rollback, not a fix. Reopen the split issue afterwards, or go
    forward again — the runbook says what each looks like.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string] $TenantId = '1a2fce27-b5f6-43c7-a86e-cf0bb74d4672',
    # The API registration, which before the #522 split also served as the SPA
    # client. Rolling back means pointing the frontend at it again, which only
    # works while it has redirect URIs — restored below.
    [string] $ApiAppId = 'ac696e96-e203-47be-ade8-c35ece8a6c4a',
    [string[]] $RedirectUris = @(
        'https://hybridcloudworks.com/auth/callback',
        'https://www.hybridcloudworks.com/auth/callback',
        'https://calm-ground-0d0e6a010.7.azurestaticapps.net/auth/callback'
    )
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Write-Step 'Preflight'
$account = az account show --query '{user:user.name,tenant:tenantId}' -o json | ConvertFrom-Json
Write-Host "signed in as : $($account.user)"
Write-Host "tenant       : $($account.tenant)"
if ($account.tenant -ne $TenantId) {
    throw "Signed in to tenant $($account.tenant), expected $TenantId. Run: az login --tenant $TenantId --allow-no-subscriptions"
}

$api = az ad app show --id $ApiAppId -o json | ConvertFrom-Json
if (-not $api) { throw "App registration $ApiAppId not found in this tenant." }
Write-Host "app          : $($api.displayName)"

$current = @($api.spa.redirectUris)
Write-Host "current URIs : $(if ($current) { $current -join ', ' } else { '(none)' })"

Write-Step 'Restore the redirect URIs'
# A union, not a replace. This runs during an incident, and quietly deleting a
# URI somebody added by hand five minutes ago to work around the same incident
# would be the wrong kind of tidy.
$target = @($current + $RedirectUris | Select-Object -Unique)
$adding = @($target | Where-Object { $current -notcontains $_ })

if (-not $adding) {
    Write-Host 'already present — nothing to restore' -ForegroundColor Green
}
elseif ($PSCmdlet.ShouldProcess($api.displayName, "add redirect URIs: $($adding -join ', ')")) {
    $body = @{ spa = @{ redirectUris = [string[]]$target } } | ConvertTo-Json -Depth 6 -Compress
    Write-Host "  $body"
    $tmp = New-TemporaryFile
    try {
        Set-Content -Path $tmp -Value $body -Encoding utf8
        az rest --method PATCH `
            --url "https://graph.microsoft.com/v1.0/applications/$($api.id)" `
            --headers 'Content-Type=application/json' --body "@$tmp" | Out-Null
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Write-Host "added: $($adding -join ', ')" -ForegroundColor Green
}

Write-Step 'Verify'
# Read it back rather than trusting the PATCH. A rollback that reports success
# and did nothing is worse than one that fails, because the next step looks
# like the broken thing.
$after = az ad app show --id $ApiAppId -o json | ConvertFrom-Json
$now = @($after.spa.redirectUris)
$missing = @($RedirectUris | Where-Object { $now -notcontains $_ })
$now | ForEach-Object { Write-Host "  $_" }
if ($missing) {
    throw "Still missing: $($missing -join ', '). The frontend deploy below would fail at the redirect; fix this first."
}
Write-Host 'all three present  [ok]' -ForegroundColor Green

Write-Step 'Next'
Write-Host ''
Write-Host '  Dispatch: Actions -> Deploy Frontend -> Run workflow' -ForegroundColor Green
Write-Host "  Set entra_client_id_override to: $ApiAppId" -ForegroundColor Green
Write-Host ''
Write-Host 'The override applies to that build only — the next deploy reads the'
Write-Host 'VITE_ENTRA_CLIENT_ID repository variable again. Set the variable too'
Write-Host 'if the rollback is meant to stick.'
Write-Host ''
Write-Host 'Afterwards, Admin -> Health: `azp` will equal `aud`, and the "azp'
Write-Host 'differs from aud" verdict will read FAIL. On a rolled-back'
Write-Host 'configuration that is correct, not a new problem.'
