<#
.SYNOPSIS
    Pull the latest HCP Terraform plan and assert it carries ONLY the known
    permanent diff.

.DESCRIPTION
    `scripts/assert-expected-plan.mjs` (T-724) is the check; getting a plan into
    a file to feed it is the part nobody had automated, so it was run by hand or
    not at all. This does that half.

    ==========================================================================
    WHY A CLEAN PLAN DOES NOT EXIST HERE
    ==========================================================================
    `infra/functionapp.tf` carries a read-then-strip pair working around
    hashicorp/terraform-provider-azurerm#29149. Its cost is that EVERY plan
    reports a diff. The steady-state signature is 3 add / 1 change / 3 destroy,
    and the four addresses are in EXPECTED in the checker.

    That is why the summary line is not the check. "3 add / 1 change / 3
    destroy" is equally true of the expected diff and of a plan that replaced
    three completely different resources. The checker compares ADDRESSES.

    ==========================================================================
    WHAT THIS NEEDS FROM YOU
    ==========================================================================
    A HCP Terraform **user** or **team** token with admin access to the
    workspace. NOT an organization token — the json-output endpoint rejects
    those outright. Create one at:

        https://app.terraform.io/app/settings/tokens

    Pass it as -Token, or set TFC_TOKEN. It is never written to disk here.

    The plan JSON contains the values of sensitive variables and copies of
    state, so it is written to a temp file and deleted in `finally`, including
    on Ctrl-C.

.PARAMETER Token
    HCP Terraform user/team token. Defaults to $env:TFC_TOKEN.

.PARAMETER RunId
    A specific run (`run-XXXXXXXX`). Omit to take the workspace's latest.

.PARAMETER KeepPlan
    Keep the downloaded plan JSON and print its path. It holds sensitive
    values — only for debugging, and delete it yourself afterwards.

.EXAMPLE
    $env:TFC_TOKEN = '...'
    ./07-check-plan.ps1

.EXAMPLE
    ./07-check-plan.ps1 -RunId run-AbCdEf1234567890

.NOTES
    Read-only against HCP Terraform. It cannot queue, apply or cancel anything.
#>
[CmdletBinding()]
param(
    [string] $Token = $env:TFC_TOKEN,
    [string] $RunId,
    [switch] $KeepPlan,
    [string] $Organization = 'hcw',
    [string] $Workspace = 'hcw-azure',
    [string] $ApiBase = 'https://app.terraform.io/api/v2'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Good { param($Text) Write-Host $Text -ForegroundColor Green }
function Write-Bad { param($Text) Write-Host $Text -ForegroundColor Red }

if (-not $Token) {
    $msg = 'No token. Set $env:TFC_TOKEN or pass -Token, using a USER or TEAM token from ' +
    'https://app.terraform.io/app/settings/tokens. An organization token cannot read ' +
    'json-output and will fail with 404 rather than 403, which reads like a missing plan.'
    throw $msg
}

$headers = @{
    Authorization  = "Bearer $Token"
    'Content-Type' = 'application/vnd.api+json'
}

function Invoke-Tfc {
    param([string] $Path)
    try {
        return Invoke-RestMethod -Uri "$ApiBase$Path" -Headers $headers -Method Get
    }
    catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 401) { throw "HCP Terraform rejected the token (401) on $Path." }
        if ($status -eq 404) {
            $msg = "404 on $Path. Either the path is wrong, or the token lacks admin access to " +
            "$Organization/$Workspace — this endpoint answers 404 rather than 403 for a token " +
            'without permission, and an organization token always lands here.'
            throw $msg
        }
        throw "HCP Terraform returned $status on $Path."
    }
}

$planFile = Join-Path ([System.IO.Path]::GetTempPath()) "tfc-plan-$([guid]::NewGuid()).json"

try {
    if (-not $RunId) {
        Write-Step "Latest run in $Organization/$Workspace"
        $ws = Invoke-Tfc "/organizations/$Organization/workspaces/$Workspace"
        $wsId = $ws.data.id
        # page[size]=1 -> newest first is the API's default ordering for runs.
        $runs = Invoke-Tfc "/workspaces/$wsId/runs?page%5Bsize%5D=1"
        if (-not $runs.data -or $runs.data.Count -eq 0) { throw "No runs found in $Workspace." }
        $run = $runs.data[0]
    }
    else {
        Write-Step "Run $RunId"
        $run = (Invoke-Tfc "/runs/$RunId").data
    }

    $RunId = $run.id
    Write-Host "run     : $RunId"
    Write-Host "status  : $($run.attributes.status)"
    Write-Host "message : $($run.attributes.message)"
    Write-Host "created : $($run.attributes.'created-at')"

    $planId = $run.relationships.plan.data.id
    if (-not $planId) { throw "Run $RunId has no plan yet (status $($run.attributes.status))." }

    Write-Step 'Change summary, which is NOT the check'
    $plan = (Invoke-Tfc "/plans/$planId").data.attributes
    Write-Host ("add {0}  change {1}  destroy {2}" -f `
            $plan.'resource-additions', $plan.'resource-changes', $plan.'resource-destructions')
    Write-Host 'Expected steady state: 3 / 1 / 3 — but a matching summary proves nothing on its'
    Write-Host 'own, because three DIFFERENT replacements would produce the same three numbers.'

    Write-Step 'Downloading the JSON plan'
    # 307-redirects to archivist with a ~1 minute lifetime; -MaximumRedirection
    # follows it. Straight to a file: this JSON carries sensitive variable
    # values and copies of state, so it never sits in a shell variable.
    Invoke-WebRequest -Uri "$ApiBase/plans/$planId/json-output" `
        -Headers $headers -MaximumRedirection 5 -OutFile $planFile | Out-Null
    Write-Host "wrote $([math]::Round((Get-Item $planFile).Length / 1KB)) KB"

    Write-Step 'Asserting the permanent diff, by address'
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $checker = Join-Path $repoRoot 'scripts/assert-expected-plan.mjs'
    if (-not (Test-Path -LiteralPath $checker)) { throw "Checker not found at $checker." }

    # The checker EXITS 1 to mean "unexpected plan" -- that is its signal, not a
    # crash. PowerShell 7.4+ turns $PSNativeCommandUseErrorActionPreference on
    # by default, so with $ErrorActionPreference = 'Stop' a non-zero exit from a
    # native command THROWS at the call site. That would skip the verdict below
    # and show a raw PowerShell error for the one outcome this script exists to
    # report clearly. Suppressed for this call only, then restored.
    $previousNativePreference = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & node $checker $planFile
        $code = $LASTEXITCODE
    }
    finally {
        $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }

    Write-Step 'Verdict'
    switch ($code) {
        0 {
            Write-Good 'The plan carries the known permanent diff and nothing else.'
            Write-Host 'For the T-754 split specifically, this is the proof that no resource moved:'
            Write-Host 'every address kept its identity, so Terraform sees a file reorganisation as'
            Write-Host 'no change at all.'
        }
        1 {
            Write-Bad 'The plan contains something beyond the permanent diff — read the lines above.'
            Write-Host 'Do NOT approve on the shape of the summary line.'
        }
        default { Write-Bad "The checker could not read the plan (exit $code)." }
    }
    exit $code
}
finally {
    if ($KeepPlan -and (Test-Path -LiteralPath $planFile)) {
        Write-Host "`nplan kept at $planFile — it holds sensitive values; delete it when done." -ForegroundColor Yellow
    }
    elseif (Test-Path -LiteralPath $planFile) {
        Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
    }
}
