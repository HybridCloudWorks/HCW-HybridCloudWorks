#!/usr/bin/env pwsh
<#
.SYNOPSIS
    One-shot bootstrap for the HCW secrets pipeline.

.DESCRIPTION
    After 2 manual prerequisites are done, this script wires up everything else:
      1. Generates a fresh age keypair (or reuses existing one)
      2. Updates .sops.yaml with the public key
      3. Pushes all 4 bootstrap secrets to GitHub repo via gh CLI
      4. Dispatches the secret-encrypt-and-sync workflow
      5. Tails the run until done

.PREREQUISITES (you must do these 2 things first)
    A) Notion: create an internal integration at https://www.notion.so/profile/integrations
       Then share the Secrets database with that integration.
       Have ready: the integration token + the 32-char DB ID from the URL.

    B) GitHub PAT: create a fine-grained PAT at
       https://github.com/settings/personal-access-tokens/new
       Scope: repo saulpatinojr/Personal-Site_HCW
       Permissions: Secrets (R/W), Actions (R/W)
       Have ready: the PAT string (starts with github_pat_).

.REQUIREMENTS
    - gh CLI authenticated (run: gh auth status)
    - age installed (winget install FiloSottile.age  OR  choco install age)
    - Run from repo root.

.EXAMPLE
    .\scripts\bootstrap-secrets.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipDispatch,
    [switch]$ReuseExistingAgeKey
)

$ErrorActionPreference = 'Stop'
$repo = 'saulpatinojr/Personal-Site_HCW'
$ageDir = Join-Path $env:USERPROFILE '.config\sops\age'
$ageKeyFile = Join-Path $ageDir 'keys.txt'
$sopsConfig = Join-Path $PSScriptRoot '..\.sops.yaml'

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# ── Preflight ────────────────────────────────────────────────────────────────
Write-Host "`n=== HCW Secrets Bootstrap ===" -ForegroundColor Cyan

if (-not (Test-Command gh)) { throw 'gh CLI not found. Install: winget install GitHub.cli' }
if (-not (Test-Command age-keygen)) { throw 'age not found. Install: winget install FiloSottile.age' }

$ghStatus = gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "gh not authenticated. Run: gh auth login`n$ghStatus" }
Write-Host "✓ gh CLI authenticated" -ForegroundColor Green

# ── Step 1: age key ──────────────────────────────────────────────────────────
Write-Host "`n[1/4] Age keypair..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $ageDir | Out-Null

if ((Test-Path $ageKeyFile) -and -not $ReuseExistingAgeKey) {
    $reuse = Read-Host "Existing key at $ageKeyFile. Reuse it? (Y/n)"
    if ($reuse -ne 'n' -and $reuse -ne 'N') { $ReuseExistingAgeKey = $true }
}

if (-not $ReuseExistingAgeKey -or -not (Test-Path $ageKeyFile)) {
    age-keygen -o $ageKeyFile
    Write-Host "✓ New age keypair generated" -ForegroundColor Green
} else {
    Write-Host "✓ Reusing existing age key" -ForegroundColor Green
}

$keyContents = Get-Content $ageKeyFile -Raw
$pubMatch = [regex]::Match($keyContents, 'public key: (age1\w+)')
if ($pubMatch.Success) {
    $publicKey = $pubMatch.Groups[1].Value
} else {
    # File only contains the private key — derive the public key
    $publicKey = (age-keygen -y $ageKeyFile).Trim()
}
if (-not $publicKey) { throw 'Could not extract or derive public key from age key file' }
Write-Host "  Public key: $publicKey" -ForegroundColor Gray

# ── Step 2: .sops.yaml ───────────────────────────────────────────────────────
Write-Host "`n[2/4] Updating .sops.yaml..." -ForegroundColor Yellow
$sopsContent = @"
# SOPS Configuration
# Defines encryption rules for secret files using age
# Auto-managed by scripts/bootstrap-secrets.ps1

creation_rules:
  - path_regex: infrastructure/secrets/.*\.yaml$
    age: $publicKey
"@
Set-Content -Path $sopsConfig -Value $sopsContent -NoNewline
Write-Host "✓ .sops.yaml written" -ForegroundColor Green

# ── Step 3: GitHub secrets ───────────────────────────────────────────────────
Write-Host "`n[3/4] Pushing 4 bootstrap secrets to GitHub..." -ForegroundColor Yellow

# Load values from infrastructure/secrets/env/.env when present
$envFile = Join-Path $PSScriptRoot '..\infrastructure\secrets\env\.env'
$envValues = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$') {
            $envValues[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    Write-Host "  ✓ Loaded $($envValues.Count) values from infrastructure/secrets/env/.env" -ForegroundColor Green
} else {
    Write-Host "  ⚠ No .env at $envFile — will prompt for everything" -ForegroundColor Yellow
}

function ConvertFrom-Secure($s) {
    [System.Net.NetworkCredential]::new('', $s).Password
}

function Get-OrPrompt($key, [switch]$Secure) {
    if ($envValues.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($envValues[$key])) {
        Write-Host "  ✓ $key from .env" -ForegroundColor Gray
        return $envValues[$key]
    }
    if ($Secure) {
        return ConvertFrom-Secure (Read-Host "  $key" -AsSecureString)
    }
    return (Read-Host "  $key").Trim()
}

function Get-NotionSecret($variable, $token, $dbId) {
    # Query the Notion Secrets DB for a row where Variable == $variable, return its Value
    $headers = @{
        'Authorization'  = "Bearer $token"
        'Notion-Version' = '2022-06-28'
        'Content-Type'   = 'application/json'
    }
    $body = @{
        filter = @{
            property  = 'Variable'
            rich_text = @{ equals = $variable }
        }
        page_size = 1
    } | ConvertTo-Json -Depth 5
    try {
        $resp = Invoke-RestMethod -Method Post -Uri "https://api.notion.com/v1/databases/$dbId/query" -Headers $headers -Body $body
    } catch {
        Write-Host "  ⚠ Notion lookup for $variable failed: $_" -ForegroundColor Yellow
        return $null
    }
    $page = $resp.results | Select-Object -First 1
    if (-not $page) { return $null }
    $valueProp = $page.properties.Value
    if (-not $valueProp -or -not $valueProp.rich_text) { return $null }
    return ($valueProp.rich_text | ForEach-Object { $_.plain_text }) -join ''
}

$notionTokenVal = Get-OrPrompt 'NOTION_API_TOKEN' -Secure
$notionDbIdVal  = Get-OrPrompt 'NOTION_SECRETS_DB_ID'

# Try to pull GH_PAT_KEY from the Notion Secrets DB before prompting
$ghPatVal = $null
if ($envValues.ContainsKey('GH_PAT_KEY') -and -not [string]::IsNullOrWhiteSpace($envValues['GH_PAT_KEY'])) {
    $ghPatVal = $envValues['GH_PAT_KEY']
    Write-Host "  ✓ GH_PAT_KEY from .env" -ForegroundColor Gray
} else {
    Write-Host "  → Looking up GH_PAT_KEY in Notion Secrets DB..." -ForegroundColor Gray
    $ghPatVal = Get-NotionSecret 'GH_PAT_KEY' $notionTokenVal $notionDbIdVal
    if ($ghPatVal) {
        Write-Host "  ✓ GH_PAT_KEY from Notion" -ForegroundColor Green
    } else {
        $ghPatVal = ConvertFrom-Secure (Read-Host "  GH_PAT_KEY" -AsSecureString)
    }
}

$secrets = @{
    NOTION_API_TOKEN     = $notionTokenVal
    NOTION_SECRETS_DB_ID = $notionDbIdVal
    SOPS_AGE_KEY         = $keyContents
    GH_PAT_KEY           = $ghPatVal
}

foreach ($name in $secrets.Keys) {
    $value = $secrets[$name]
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$name is empty" }
    # Pass value as argument (not stdin) to avoid PowerShell appending CRLF.
    # SOPS_AGE_KEY is multi-line — keep its internal newlines but strip trailing whitespace only.
    $clean = $value -replace "`r", ''
    $clean = $clean.TrimEnd("`n").TrimEnd()
    gh secret set $name --repo $repo --body $clean
    if ($LASTEXITCODE -ne 0) { throw "Failed to set $name" }
    Write-Host "  ✓ $name" -ForegroundColor Green
}

# Clear plaintext from memory
$secrets.Clear()
[GC]::Collect()

# ── Step 4: Dispatch full sync ───────────────────────────────────────────────
if ($SkipDispatch) {
    Write-Host "`n[4/4] Skipped (--SkipDispatch). Run manually:" -ForegroundColor Yellow
    Write-Host "  gh workflow run secrets-resync.yml --repo $repo" -ForegroundColor Gray
} else {
    Write-Host "`n[4/4] Dispatching secrets-resync workflow..." -ForegroundColor Yellow
    gh workflow run secrets-resync.yml --repo $repo --ref main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠ Dispatch failed — the workflow may not exist on main yet." -ForegroundColor Yellow
        Write-Host "    Commit + push .github/workflows/secrets-resync.yml first, then re-run with -SkipDispatch=`$false" -ForegroundColor Gray
    } else {
        Start-Sleep -Seconds 3
        gh run list --workflow=secrets-resync.yml --repo $repo --limit 1
        Write-Host "`n  Tail the run with:" -ForegroundColor Gray
        Write-Host "    gh run watch --repo $repo" -ForegroundColor Gray
    }
}

Write-Host "`n=== Bootstrap complete ===" -ForegroundColor Cyan
Write-Host "From now on, edit secrets in Notion → run 'gh workflow run secrets-resync.yml' to redistribute." -ForegroundColor White
