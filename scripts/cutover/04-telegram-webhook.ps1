<#
.SYNOPSIS
    Cutover step 3d — point the Telegram bot at Azure (TODO.md T-512).

.DESCRIPTION
    Migration_Plan §6 step 6. The URL and its secret token are registered with
    TELEGRAM, not in code, so deploying the receiver changes nothing on its own
    — the bot keeps POSTing at the Cloud Functions URL until `setWebhook` is
    re-run. That is the half of this step that gets forgotten, and nothing
    breaks until GCP is decommissioned, at which point the bot goes quiet with
    no error anywhere in Azure.

    The receiver now exists here: POST /api/telegram/webhook, implemented in
    functions/src/functions/telegram-http.js. It is anonymous because Telegram
    cannot send a bearer token, and guarded instead by:

      1. X-Telegram-Bot-Api-Secret-Token, which Telegram echoes back from
         whatever is registered below, compared in constant time against
         sha256(TELEGRAM_BOT_TOKEN).
      2. The sending chat id, which must equal TELEGRAM_CHAT_ID.

    The secret is DERIVED from the bot token rather than stored separately —
    one secret to rotate, and no way for the two to drift apart. This script
    computes it the same way the running code does, so there is nothing to keep
    in sync by hand.

.PARAMETER Mode
    Set     - register the Azure webhook URL (default)
    Show    - print current webhook info from Telegram, change nothing
    Delete  - unregister entirely (the "retire the bot" option)

.PARAMETER BotToken
    The bot token. Omitted, the script reads it from Key Vault, which needs a
    firewall window — pass it directly if you have it to hand.

.EXAMPLE
    ./04-telegram-webhook.ps1 -Mode Show
    ./04-telegram-webhook.ps1
    ./04-telegram-webhook.ps1 -Mode Delete

.NOTES
    Run this AFTER the receiver is deployed. Registering a webhook that 404s
    makes Telegram retry and back off, and the bot looks broken for a while
    after you fix it.

    Requires: PowerShell 7. Key Vault access only when -BotToken is omitted.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Set', 'Show', 'Delete')]
    [string] $Mode = 'Set',
    [string] $BotToken,
    [string] $ApiBase = 'https://api-azure.hybridcloudworks.com/api',
    [string] $VaultName = 'kv-site-prod-cus-01'
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

$ruleAdded = $false
$myIp = $null
try {
    if (-not $BotToken) {
        Write-Step 'Read the bot token from Key Vault'
        $myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip
        Write-Host "opening a firewall window for $myIp"
        az keyvault network-rule add --name $VaultName --ip-address "$myIp/32" --output none
        $ruleAdded = $true
        Start-Sleep -Seconds 20
        $BotToken = az keyvault secret show --vault-name $VaultName --name 'TELEGRAM-BOT-TOKEN' `
            --query 'value' -o tsv
    }
    if ([string]::IsNullOrWhiteSpace($BotToken)) { throw 'No bot token available.' }
    Write-Host "bot token: $($BotToken.Length) characters (value not printed)"

    # Same derivation as expectedWebhookSecret() in lib/telegram/bot.js.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $secret = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($BotToken)) |
        ForEach-Object { $_.ToString('x2') }) -join ''
    $sha.Dispose()
    Write-Host "derived secret: $($secret.Substring(0,8))... (sha256 of the token)"

    $api = "https://api.telegram.org/bot$BotToken"

    Write-Step 'Current webhook'
    $info = Invoke-RestMethod -Uri "$api/getWebhookInfo" -TimeoutSec 20
    if ($info.result.url) {
        Write-Host "url               : $($info.result.url)"
        Write-Host "pending updates   : $($info.result.pending_update_count)"
        if ($info.result.last_error_message) {
            Write-Host "last error        : $($info.result.last_error_message)" -ForegroundColor Yellow
            Write-Host "last error at     : $([datetimeoffset]::FromUnixTimeSeconds($info.result.last_error_date).ToString('u'))"
        }
    }
    else { Write-Host 'no webhook registered' }

    if ($Mode -eq 'Show') { return }

    if ($Mode -eq 'Delete') {
        Write-Step 'Unregister'
        if ($PSCmdlet.ShouldProcess('Telegram bot', 'deleteWebhook — inbound commands stop working')) {
            $r = Invoke-RestMethod -Uri "$api/deleteWebhook?drop_pending_updates=true" -TimeoutSec 20
            if (-not $r.ok) { throw "deleteWebhook failed: $($r.description)" }
            Write-Host 'webhook deleted; outbound alerts are unaffected' -ForegroundColor Green
        }
        return
    }

    $target = "$ApiBase/telegram/webhook"

    Write-Step 'Preflight the receiver'
    # A webhook pointed at a 404 makes Telegram retry and back off, so the bot
    # stays broken for a while after the real fix. Check first: an unauthorized
    # POST must answer 401, which proves the route exists AND that the secret
    # gate is actually running.
    try {
        $probe = Invoke-WebRequest -Uri $target -Method POST -Body '{}' `
            -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 25
        Write-Host "POST $target -> $($probe.StatusCode)"
        if ($probe.StatusCode -eq 404) {
            throw 'The receiver is not deployed (404). Deploy functions first, then re-run.'
        }
        if ($probe.StatusCode -ne 401) {
            Write-Warning "Expected 401 from an unauthenticated POST, got $($probe.StatusCode). Continuing, but check the route."
        }
        else { Write-Host 'secret gate is live (401 without a valid token)' -ForegroundColor Green }
    }
    catch [System.Net.Http.HttpRequestException] {
        throw "Could not reach $target — $($_.Exception.Message)"
    }

    Write-Step 'Register'
    if ($PSCmdlet.ShouldProcess('Telegram bot', "setWebhook -> $target")) {
        $body = @{
            url                  = $target
            secret_token         = $secret
            allowed_updates      = @('message')
            drop_pending_updates = $true
        } | ConvertTo-Json -Compress
        $r = Invoke-RestMethod -Uri "$api/setWebhook" -Method POST -Body $body `
            -ContentType 'application/json' -TimeoutSec 20
        if (-not $r.ok) { throw "setWebhook failed: $($r.description)" }
        Write-Host "registered: $target" -ForegroundColor Green
    }

    Write-Step 'Verify'
    Start-Sleep -Seconds 3
    $after = (Invoke-RestMethod -Uri "$api/getWebhookInfo" -TimeoutSec 20).result
    Write-Host "url             : $($after.url)"
    Write-Host "custom secret   : $(if ($after.has_custom_certificate -or $secret) { 'set' } else { 'NOT set' })"
    Write-Host "pending updates : $($after.pending_update_count)"
    if ($after.url -ne $target) { throw "Webhook URL is '$($after.url)', expected '$target'." }

    Write-Host ''
    Write-Host 'Now send /help to the bot. If nothing comes back, check:' -ForegroundColor Yellow
    Write-Host '  - your chat id matches TELEGRAM_CHAT_ID (an unauthorized chat is ignored SILENTLY, by design)'
    Write-Host '  - App Insights traces for "[telegram]"'
    Write-Host '  - ./04-telegram-webhook.ps1 -Mode Show, for last_error_message from Telegram'
}
finally {
    if ($ruleAdded) {
        Write-Step 'Close the firewall window'
        az keyvault network-rule remove --name $VaultName --ip-address "$myIp/32" --output none
        Write-Host 'rule removed' -ForegroundColor Green
    }
}
