<#
.SYNOPSIS
    Cutover step 5 — prove a timer fired, at the right LOCAL time.

.DESCRIPTION
    Migration_Plan §6 step 7 and §7's scheduled-job gate. Timers are armed one
    at a time, and each must be observed firing once before the next is added.

    The gate is not "did it run". It is "did it run at the intended Chicago
    local time". `WEBSITE_TIME_ZONE = America/Chicago` is set on the app, and a
    timer that fires five hours early passes a naive "fired once" check and
    fails the real one — that is the documented trap, and it is invisible unless
    something converts the timestamp deliberately.

    So this reports each invocation in BOTH zones and compares against the
    NCRONTAB schedule the function actually registered.

.PARAMETER Name
    Function name, e.g. syncRssFeeds. Omit to report on every timer that is
    currently armed.

.PARAMETER Hours
    How far back to look. Default 24 — enough for a daily timer.

.EXAMPLE
    ./05-verify-timer.ps1 -Name syncRssFeeds
    ./05-verify-timer.ps1 -Hours 48

.NOTES
    Requires: az CLI signed in, with reader on the Application Insights
    component. Read-only.

    Turning a timer ON is a Terraform variable edit, not a code change: add its
    flag suffix to `enabled_timers` in the HCP Terraform workspace and apply.
    FEATURE_FLAG_SCHEDULERS is a separate master kill switch that holds every
    timer off regardless — arming the first timer means setting BOTH.
#>
[CmdletBinding()]
param(
    [string] $Name,
    [int] $Hours = 24,
    [string] $AppInsightsId = '03cb0512-0fcb-4714-8b3e-fe732a791fff',
    [string] $FunctionApp = 'func-site-prod-cus-01',
    [string] $ResourceGroup = 'rg-web-site-prod-cus'
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

$chicago = [System.TimeZoneInfo]::FindSystemTimeZoneById('America/Chicago')

Write-Step 'Armed timers'
$settings = az functionapp config appsettings list -n $FunctionApp -g $ResourceGroup -o json |
    ConvertFrom-Json
$master = ($settings | Where-Object { $_.name -eq 'FEATURE_FLAG_SCHEDULERS' }).value
Write-Host "FEATURE_FLAG_SCHEDULERS = $master$(if ($master -eq 'false') { '   <-- MASTER KILL SWITCH: every timer is held off' })" `
    -ForegroundColor $(if ($master -eq 'false') { 'Yellow' } else { 'Green' })

$armed = $settings |
    Where-Object { $_.name -like 'FEATURE_FLAG_*' -and $_.name -ne 'FEATURE_FLAG_SCHEDULERS' -and $_.value -eq 'true' } |
    ForEach-Object { $_.name -replace '^FEATURE_FLAG_', '' }
Write-Host "armed flags: $(if ($armed) { $armed -join ', ' } else { '(none)' })"

Write-Step 'Registered schedules'
$timers = az functionapp function list -n $FunctionApp -g $ResourceGroup -o json |
    ConvertFrom-Json |
    Where-Object { $_.config.bindings[0].type -eq 'timerTrigger' } |
    ForEach-Object {
        [pscustomobject]@{
            Name     = ($_.name -split '/')[-1]
            Schedule = $_.config.bindings[0].schedule
        }
    }
if ($Name) { $timers = $timers | Where-Object { $_.Name -eq $Name } }
if (-not $timers) { throw "No timer trigger named '$Name' is registered on $FunctionApp." }
$timers | Sort-Object Name | Format-Table -AutoSize | Out-String | Write-Host

Write-Step "Invocations in the last $Hours h"
$names = ($timers.Name | ForEach-Object { "'$_'" }) -join ','
$query = @"
requests
| where timestamp > ago(${Hours}h)
| where name in ($names)
| project timestamp, name, success, duration
| order by timestamp asc
"@

$raw = az monitor app-insights query --app $AppInsightsId --analytics-query $query -o json |
    ConvertFrom-Json
$rows = $raw.tables[0].rows

if (-not $rows -or $rows.Count -eq 0) {
    Write-Host "no invocations recorded" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'That is the expected result while the flag is false: the function is'
    Write-Host 'registered and the host calls it on schedule, but the handler returns'
    Write-Host 'immediately with "[name] disabled - skipping" and never records a request.'
    Write-Host 'Check the trace instead:'
    Write-Host "  traces | where timestamp > ago(${Hours}h) | where message contains 'disabled'"
    return
}

foreach ($r in $rows) {
    $utc = [datetime]::Parse($r[0]).ToUniversalTime()
    $local = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $chicago)
    $ok = if ($r[2] -eq 'True' -or $r[2] -eq $true) { 'ok  ' } else { 'FAIL' }
    Write-Host ("{0}  {1,-28} UTC {2:HH:mm:ss}   Chicago {3:yyyy-MM-dd HH:mm:ss}  ({4})" -f `
            $ok, $r[1], $utc, $local, $chicago.IsDaylightSavingTime($local) ? 'CDT' : 'CST')
}

Write-Step 'Read this against the schedule above'
Write-Host 'NCRONTAB is {second} {minute} {hour} {day} {month} {day-of-week}, and the'
Write-Host 'hour is interpreted in WEBSITE_TIME_ZONE. Compare the Chicago column, not'
Write-Host 'the UTC one. A daily 04:00 job showing Chicago 22:00 or 23:00 means the'
Write-Host 'time zone is not being applied and the job is running on UTC.'
