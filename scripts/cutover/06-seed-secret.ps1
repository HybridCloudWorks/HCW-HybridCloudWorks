<#
.SYNOPSIS
    Seed one Key Vault secret through a measured firewall window.

.DESCRIPTION
    This is the only secret-seeding script, and it seeds any of them. Until
    2026-08-29 there was also `03-keyvault-secrets.ps1`, which handled exactly
    one secret — the multi-line GCP service-account JSON, which had a `--file`
    requirement all of its own. Every OTHER secret the estate needs
    (PREVIEW-SIGNING-SECRET, REPLICATE-API-KEY, YOUTUBE-API-KEY,
    GCP-BILLING-API-KEY, an AI provider key) had no script, so seeding one
    meant hand-rolling the firewall window. A hand-rolled window is the one
    that gets left open. GCP pricing now uses an API key — a single string,
    seeded here like everything else — so `03` was deleted rather than kept
    for one caller that no longer exists.

    Three things this refuses to let you get wrong:

    1. **THE NAME.** App settings are UPPER_SNAKE_CASE and Key Vault secrets are
       UPPER-KEBAB-CASE, because Key Vault forbids underscores. Get it wrong and
       the reference resolves to nothing: the app deploys clean, and a missing
       credential presents as missing *data*, days later, in a feature nobody
       was looking at (REVIEW.md §4.5). So the name is checked against the
       secrets `infra/main.tf` actually references — read from the file, not a
       list in here that could go stale.

    2. **PLACEHOLDERS.** REVIEW.md §4.6 states the rule and the reason: an unset
       input fails with a clear "not supplied"; a stubbed one fails as an
       authentication or resolution error that reads like a permissions or
       networking problem, and the two cost very different amounts to diagnose.
       Obvious stubs are rejected outright.

    3. **THE WINDOW.** Added directly rather than through the `admin_ip_rules`
       Terraform variable, and always removed in a `finally` — including on
       Ctrl-C. A rule added here and left behind is drift the next apply
       silently reverts, which is the good outcome; a rule added via
       `admin_ip_rules` and forgotten is a permanent hole that looks
       intentional.

    The value is never printed, never passed on a command line where it would
    land in shell history, and never written to a file. `-Generate` and the
    secure prompt both keep it in memory only.

.PARAMETER Name
    Secret name, UPPER-KEBAB-CASE. Must be one `infra/main.tf` references.

.PARAMETER Generate
    Generate a cryptographically random value instead of prompting. For secrets
    whose value is arbitrary as long as it is unguessable — PREVIEW-SIGNING-
    SECRET and CLIENT-IP-SALT. Refused for anything else, because a generated
    value where a real credential belongs seeds a secret that resolves and then
    fails against the upstream service, which is the placeholder trap wearing a
    better disguise.

.PARAMETER Mode
    Seed - write the secret (default)
    List - inventory only; no window is opened for a write, and nothing changes

.PARAMETER MyIp
    Public IP to allow while seeding. Defaults to whatever api.ipify.org says.

.EXAMPLE
    # The Blog Machine staging links. Value is arbitrary; unguessable is the point.
    ./06-seed-secret.ps1 -Name PREVIEW-SIGNING-SECRET -Generate

.EXAMPLE
    # A real upstream credential — prompts, never echoes, never hits history.
    ./06-seed-secret.ps1 -Name REPLICATE-API-KEY

.EXAMPLE
    ./06-seed-secret.ps1 -Mode List

.NOTES
    Requires: az CLI signed in with Key Vault Secrets Officer on the vault and
    rights to change its network ACLs.

    AFTER SEEDING, the Function App does not pick the value up immediately.
    Key Vault references are resolved by the app at startup and refreshed on a
    schedule; restart the app if you want it now. `GET /api/health` reports
    `unresolvedSecrets`, which is how you confirm it landed without reading the
    value back (TODO.md T-720).
#>
[CmdletBinding(DefaultParameterSetName = 'Seed', SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(ParameterSetName = 'Seed', Mandatory)][string] $Name,
    [Parameter(ParameterSetName = 'Seed')][switch] $Generate,
    [Parameter(ParameterSetName = 'List', Mandatory)][ValidateSet('List')][string] $Mode,
    [string] $VaultName = 'kv-site-prod-cus-01',
    # Name plus resource group is an unambiguous ARM address. Name alone makes
    # az search the subscription, and that search's failure message blames the
    # vault rather than the lookup — see the preflight below.
    [string] $ResourceGroup = 'rg-sec-site-prod-cus',
    [string] $MyIp
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

# Secrets whose value is arbitrary as long as it is unguessable. Everything
# else is a credential issued by somebody else and cannot be invented here.
$GENERATABLE = @('PREVIEW-SIGNING-SECRET', 'CLIENT-IP-SALT')

# --- The referenced-name list, read from the configuration ------------------
# Not hardcoded: a list in this file would drift from main.tf, and the whole
# point of the check is to catch a name main.tf does not reference.
$mainTf = Join-Path $PSScriptRoot '../../infra/main.tf'
if (-not (Test-Path $mainTf)) { throw "Cannot find infra/main.tf at $mainTf — run this from the repository." }
# @() so a single match stays an array — .Count and -notcontains both behave
# differently on a bare string.
$referenced = @([regex]::Matches((Get-Content $mainTf -Raw), 'secrets/([A-Z0-9-]+)\)') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
if ($referenced.Count -eq 0) { throw 'Parsed no secret names from infra/main.tf — the reference format changed; fix this script before trusting it.' }

if ($Mode -eq 'List') {
    Write-Step 'Secrets referenced by infra/main.tf'
    $referenced | ForEach-Object { Write-Host "  $_" }
    Write-Host "`n$($referenced.Count) referenced. Reading the vault needs a firewall window;" -ForegroundColor Yellow
    Write-Host 'GET /api/health reports `unresolvedSecrets` without one.' -ForegroundColor Yellow
    return
}

Write-Step 'Preflight'
if ($referenced -notcontains $Name) {
    Write-Host 'Referenced names:' -ForegroundColor Yellow
    $referenced | ForEach-Object { Write-Host "  $_" }
    $msg = "'$Name' is not referenced by infra/main.tf. A secret whose name no app setting " +
        'points at resolves to nothing and presents as missing DATA, not as a missing ' +
        'credential. App settings are UPPER_SNAKE_CASE; secrets are UPPER-KEBAB-CASE.'
    throw $msg
}
Write-Host "name      : $Name (referenced by infra/main.tf)"

# --- Confirm the CLI is pointed at the subscription holding the vault --------
# Before prompting for a value, and before opening anything.
#
# The estate spans three subscriptions, and every other cutover script assumes
# the current one is right. When it is not, Azure answers
#
#     The Vault 'kv-site-prod-cus-01' not found within subscription.
#
# which reads as "this vault does not exist" and sends you looking for a
# deleted resource. It means "you are pointed somewhere else". Observed
# 2026-08-28 on 04-telegram-webhook.ps1, after it had already printed
# "opening a firewall window" — the window did not open, because the same
# wrong-subscription error failed that call too, but the operator had no way to
# know that from the output.
# try/catch, not just 2>$null: PowerShell 7.4+ turns a non-zero native exit
# into a terminating error by default ($PSNativeCommandUseErrorActionPreference),
# which would throw past the message below on the not-signed-in path. A missing
# vault in the CURRENT subscription is exit 0 with empty output, so both cases
# have to be handled and only one of them raises.
$vaultId = $null
try { $vaultId = az keyvault list --query "[?name=='$VaultName'].id" -o tsv 2>$null } catch { $vaultId = $null }
if (-not $vaultId) {
    $current = $null
    try { $current = az account show --query 'name' -o tsv 2>$null } catch { $current = $null }
    $lines = @(
        "Key Vault '$VaultName' is not in the subscription the az CLI is currently using" +
        $(if ($current) { " ('$current')." } else { '. You may not be signed in — try: az login' }),
        '',
        'This is almost never a missing vault. Find the right subscription with:',
        '',
        '  foreach ($s in (az account list --query "[].id" -o tsv)) {',
        "    `$rg = az keyvault list --subscription `$s --query `"[?name=='$VaultName'].resourceGroup`" -o tsv 2>`$null",
        '    if ($rg) { "FOUND  sub=$s  rg=$rg" }',
        '  }',
        '',
        '  az account set --subscription <the id that printed>'
    )
    throw ($lines -join [Environment]::NewLine)
}
Write-Host "vault     : found in the current subscription"

# --- Confirm a DATA-PLANE role before prompting or opening anything ----------
# Management-plane rights and data-plane rights are separate, and this estate
# deliberately grants the operator only the first: REVIEW.md §4.6 records
# `az keyvault secret list` answering ForbiddenByRbac and calls that "the
# correct posture". So you can change the vault's firewall and still not be
# able to write a secret.
#
# Checked HERE — at the management plane, before anything — because the
# alternative is finding out at the data plane: 04-telegram-webhook.ps1 did
# exactly that on 2026-08-28, opening a firewall window on the production vault
# and only then failing with ForbiddenByRbac. Without this, the same run would
# also have prompted for a credential first and left it in memory for nothing.
#
# Role assignments are eventually consistent, so a role granted seconds ago may
# not be visible yet. That is why this WARNS rather than throws — a false
# negative that blocks a legitimate seed would be worse than the wasted window
# it prevents.
$dataPlaneRoles = @('Key Vault Secrets Officer', 'Key Vault Administrator')
$held = @()
try {
    $me = az ad signed-in-user show --query id -o tsv 2>$null
    if ($me) {
        $held = @(az role assignment list --assignee $me --scope $vaultId --include-inherited `
                --query '[].roleDefinitionName' -o tsv 2>$null)
    }
}
catch { $held = @() }

if ($held.Count -gt 0 -and -not ($held | Where-Object { $dataPlaneRoles -contains $_ })) {
    Write-Warning "You hold [$($held -join ', ')] on this vault, none of which can WRITE a secret."
    Write-Warning 'Expect ForbiddenByRbac. Grant yourself the data-plane role first:'
    Write-Warning "  az role assignment create --assignee $me --role 'Key Vault Secrets Officer' --scope $vaultId"
    Write-Warning '  # allow a minute or two to propagate, then re-run this script'
    Write-Warning 'And remove it when the vault work is done:'
    Write-Warning "  az role assignment delete --assignee $me --role 'Key Vault Secrets Officer' --scope $vaultId"
    if (-not $PSCmdlet.ShouldContinue('Continue anyway?', 'No data-plane write role found')) {
        throw 'Stopped before prompting for a value. Nothing was opened and nothing was written.'
    }
}
elseif ($held.Count -gt 0) {
    Write-Host "role      : $($held -join ', ')"
}
else {
    # Listing role assignments needs its own permission. Not being able to read
    # them is not evidence of anything either way, so it must not block.
    Write-Host 'role      : could not enumerate role assignments; proceeding'
}

# --- Obtain the value -------------------------------------------------------
if ($Generate) {
    if ($GENERATABLE -notcontains $Name) {
        $msg = "-Generate is refused for '$Name'. It is a credential issued by an upstream " +
            'service, so a random value would seed a secret that RESOLVES and then fails ' +
            'against that service — the placeholder trap with a better disguise. ' +
            "Generatable: $($GENERATABLE -join ', ')."
        throw $msg
    }
    # GetBytes(int) returns a byte[] outright. Fill() takes a Span<byte>, and
    # PowerShell's byte[] -> Span conversion is not something to rely on here.
    $plain = [Convert]::ToBase64String(
        [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    Write-Host 'value     : generated, 48 random bytes (base64)'
}
else {
    $secure = Read-Host -AsSecureString "Value for $Name (input hidden)"
    $plain = [System.Net.NetworkCredential]::new('', $secure).Password
}

# --- Refuse placeholders ----------------------------------------------------
# REVIEW.md §4.6: do not seed a placeholder to quiet a linter.
$trimmed = $plain.Trim()
if ($trimmed.Length -eq 0) { throw 'Empty value. Nothing seeded.' }
if ($trimmed -ne $plain) {
    throw 'Value has leading or trailing whitespace. readKey() trims, but the upstream service may not — re-enter it.'
}
$stubs = @('changeme', 'change-me', 'todo', 'tbd', 'placeholder', 'xxx', 'test', 'secret', 'password', 'none', 'null')
if ($stubs -contains $trimmed.ToLowerInvariant()) {
    $msg = "'$trimmed' is a placeholder. An unset input fails with a clear 'not supplied'; " +
        'a stubbed one fails as an authentication error that reads like a permissions or ' +
        'networking problem (REVIEW.md §4.6).'
    throw $msg
}
if ($trimmed.Length -lt 12) {
    $msg = "Value is $($trimmed.Length) characters. Every secret this estate uses is longer " +
        'than that — re-check you pasted the whole thing.'
    throw $msg
}
if ($trimmed.StartsWith('@Microsoft.KeyVault(')) {
    throw 'That is a Key Vault REFERENCE, not a secret value — you have copied the app setting rather than the credential.'
}
Write-Host "length    : $($trimmed.Length) characters (value not shown)"

if (-not $MyIp) {
    $MyIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip
}
Write-Host "caller ip : $MyIp"

$ruleAdded = $false
try {
    Write-Step 'Open a firewall window'
    if ($PSCmdlet.ShouldProcess($VaultName, "allow $MyIp temporarily")) {
        az keyvault network-rule add --resource-group $ResourceGroup --name $VaultName --ip-address "$MyIp/32" --output none
        $ruleAdded = $true
        Write-Host 'rule added; waiting 20s for it to take effect'
        Start-Sleep -Seconds 20
    }

    Write-Step "Seed $Name"
    if ($PSCmdlet.ShouldProcess($VaultName, "set $Name")) {
        # Via a temp file, not --value: a value on the command line lands in
        # shell history and in the process table. The file is written with
        # no trailing newline and deleted in the same try.
        $tmp = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmp, $trimmed, [System.Text.UTF8Encoding]::new($false))
            az keyvault secret set --vault-name $VaultName --name $Name --file $tmp --output none
        }
        finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
        Write-Host "$Name  set" -ForegroundColor Green
    }

    Write-Step 'Verify round-trip'
    # Compare a HASH, never the value. A secret stored with mangled whitespace
    # passes a "does it exist" check and fails at runtime.
    if ($PSCmdlet.ShouldProcess($VaultName, "read back $Name")) {
        $back = az keyvault secret show --vault-name $VaultName --name $Name --query 'value' -o tsv
        $sha = { param($s) (Get-FileHash -InputStream ([System.IO.MemoryStream]::new(
                    [System.Text.Encoding]::UTF8.GetBytes($s))) -Algorithm SHA256).Hash }
        if ((& $sha $back) -eq (& $sha $trimmed)) {
            Write-Host "$Name  round-trips byte for byte" -ForegroundColor Green
        }
        else {
            throw "$Name did not round-trip — the stored value differs from what was sent. Do not assume it is usable."
        }
    }
}
finally {
    if ($ruleAdded) {
        Write-Step 'Close the firewall window'
        az keyvault network-rule remove --resource-group $ResourceGroup --name $VaultName --ip-address "$MyIp/32" --output none
        $remaining = az keyvault show -g $ResourceGroup -n $VaultName --query 'properties.networkAcls.ipRules' -o tsv
        if ([string]::IsNullOrWhiteSpace($remaining)) {
            Write-Host 'rule removed; no IP rules remain' -ForegroundColor Green
        }
        else {
            Write-Warning "IP rules still present after cleanup: $remaining"
        }
    }
}

Write-Step 'Next'
Write-Host 'The Function App resolves references at startup. To pick this up now:'
Write-Host '  az functionapp restart -g <RESOURCE_GROUP> -n <FUNCTION_APP_NAME>'
Write-Host 'Then confirm without reading the value back:'
Write-Host '  curl https://api-azure.hybridcloudworks.com/api/health   # unresolvedSecrets should drop by one'
