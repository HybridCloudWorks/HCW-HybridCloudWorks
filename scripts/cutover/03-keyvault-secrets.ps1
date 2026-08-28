<#
.SYNOPSIS
    Seed the runtime GCP credential used by the optional GCP pricing tool.

.DESCRIPTION
    The GCP pricing tool reads one multi-line JSON credential at runtime.

    SEED WITH --file, NEVER --value. `az keyvault secret set --value` mangles
    multi-line content: PowerShell folds the newlines and the stored secret is
    a single line that parses as neither JSON nor PEM. The failure appears much
    later, inside whichever handler reads it.


.PARAMETER GcpServiceAccountJsonPath
    Path to the GCP service-account JSON file.

.PARAMETER MyIp
    Public IP to allow while seeding. Defaults to whatever api.ipify.org says.

.EXAMPLE
    ./03-keyvault-secrets.ps1 -GcpServiceAccountJsonPath .\gcp-sa.json

.NOTES
    THE FIREWALL IS THE AWKWARD PART. kv-site-prod-cus-01 is default-Deny with
    only the functions subnet allowed, so a laptop cannot reach it. The
    documented route is the `admin_ip_rules` Terraform variable — set it, apply,
    seed, empty it, apply again.

    This script does NOT touch Terraform. It adds the network rule directly so
    the window is measured in minutes, and always removes it in a finally block
    — including on Ctrl-C. A rule added here and left behind would be drift that
    the next apply silently reverts, which is the good outcome; a rule added via
    `admin_ip_rules` and forgotten is a permanent hole that looks intentional.

    Requires: az CLI signed in with Key Vault Secrets Officer (or Contributor +
    an access policy) on the vault, and rights to change its network ACLs.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string] $GcpServiceAccountJsonPath,
    [string] $VaultName = 'kv-site-prod-cus-01',
    [string] $MyIp
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Write-Step 'Preflight'
foreach ($p in @($GcpServiceAccountJsonPath)) {
    if (-not (Test-Path $p)) { throw "File not found: $p" }
}

# Validate the CONTENT before opening any firewall. A malformed secret seeded
# successfully is worse than a failed seed: it looks done.
$json = Get-Content $GcpServiceAccountJsonPath -Raw
try { $parsed = $json | ConvertFrom-Json } catch { throw "$GcpServiceAccountJsonPath is not valid JSON: $_" }
if (-not $parsed.private_key -or $parsed.type -ne 'service_account') {
    throw "$GcpServiceAccountJsonPath does not look like a GCP service-account key (need type=service_account and private_key)."
}
Write-Host "gcp json  : valid, client_email = $($parsed.client_email)"

if (-not $MyIp) {
    $MyIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip
}
Write-Host "caller ip : $MyIp"

$ruleAdded = $false
try {
    Write-Step 'Open a firewall window'
    if ($PSCmdlet.ShouldProcess($VaultName, "allow $MyIp temporarily")) {
        az keyvault network-rule add --name $VaultName --ip-address "$MyIp/32" --output none
        $ruleAdded = $true
        Write-Host 'rule added; waiting 20s for it to take effect'
        Start-Sleep -Seconds 20
    }

    Write-Step 'Seed secrets'
    # --file, not --value. See the header.
    if ($PSCmdlet.ShouldProcess($VaultName, 'set GCP-SERVICE-ACCOUNT-JSON')) {
        az keyvault secret set --vault-name $VaultName --name 'GCP-SERVICE-ACCOUNT-JSON' `
            --file $GcpServiceAccountJsonPath --output none
        Write-Host 'GCP-SERVICE-ACCOUNT-JSON  set' -ForegroundColor Green
    }
    Write-Step 'Verify round-trip'
    # Read back and re-parse. A secret that stored but folded its newlines
    # passes a "does it exist" check and fails at runtime.
    $back = az keyvault secret show --vault-name $VaultName --name 'GCP-SERVICE-ACCOUNT-JSON' `
        --query 'value' -o tsv
    try { $null = $back | ConvertFrom-Json; Write-Host 'GCP-SERVICE-ACCOUNT-JSON  round-trips as JSON' -ForegroundColor Green }
    catch { throw 'GCP-SERVICE-ACCOUNT-JSON did not round-trip as JSON — it was probably stored with --value. Re-seed with --file.' }

    Write-Step 'Inventory'
    az keyvault secret list --vault-name $VaultName --query '[].name' -o tsv | Sort-Object |
        ForEach-Object { Write-Host "  $_" }
}
finally {
    if ($ruleAdded) {
        Write-Step 'Close the firewall window'
        az keyvault network-rule remove --name $VaultName --ip-address "$MyIp/32" --output none
        $remaining = az keyvault show -n $VaultName --query 'properties.networkAcls.ipRules' -o tsv
        if ([string]::IsNullOrWhiteSpace($remaining)) {
            Write-Host 'rule removed; no IP rules remain' -ForegroundColor Green
        }
        else {
            Write-Warning "IP rules still present after cleanup: $remaining"
        }
    }
}
