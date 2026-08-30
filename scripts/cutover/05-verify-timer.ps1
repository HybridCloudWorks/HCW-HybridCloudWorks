<#
.SYNOPSIS
    Cutover step 5 — prove a timer fires, at the right LOCAL time.

.DESCRIPTION
    Migration-Plan §6 step 7 and §7's scheduled-job gate. Timers are armed one
    at a time, and each must be observed firing once before the next is added.

    The gate is not "did it run". It is "did it run at the intended Chicago
    local time". `WEBSITE_TIME_ZONE = America/Chicago` is set on the app, and a
    timer that fires five hours early passes a naive "fired once" check and
    fails the real one — that is the documented trap, and it is invisible unless
    something converts the timestamp deliberately.

    ==========================================================================
    REWRITTEN 2026-08-29. THE PREVIOUS VERSION COULD NOT SUCCEED.
    ==========================================================================
    It queried `requests` through `az monitor app-insights query --app <id>`.
    The Cutover-Runbook warns against BOTH, in its own words:

      - "AppRequests is empty and is not the oracle. Zero rows for this app's
        entire history" (T-514).
      - "Query the workspace, never `az monitor app-insights query --app
        <appId>`. The component is workspace-based with the workspace in
        another subscription, and that proxy returns ZERO ROWS FOR EVERY QUERY
        rather than erroring — it produced two wrong conclusions on 2026-08-22."

    An empty table read through an endpoint that cannot return rows. And the
    old script answered that with "no invocations recorded / that is the
    expected result while the flag is false" — a reassuring sentence for a
    query that was never able to return anything. It re-enacted the exact
    failure it was written to catch.

    This version reads AppTraces from the WORKSPACE, and separates "no
    evidence" from "evidence of absence", which is the whole T-514 lesson.

    AMENDED 2026-08-30. It used to fetch every matching trace row and classify
    them here, one printed line per row. At the T-518 arming gate it printed
    57,581 lines for a query that returns 2 rows — and the query was then run
    by hand and did return 2, so the fault lay somewhere between the fetch and
    the render. That was never root-caused. Rather than patch a path nobody
    understood, the aggregation moved into KQL: the workspace now returns one
    summarized row per timer, and every number printed is its own. See the long
    note above the query for what that does and does not buy.

    ==========================================================================
    IT WORKS WITH NOTHING ARMED, WHICH IS THE POINT
    ==========================================================================
    `app.timer()` registers with the real schedule unconditionally — the flag
    check lives INSIDE the handler (functions/src/functions/schedulers.js). So
    every timer has been firing since the day it deployed, logging
    "[name] disabled — skipping" and returning.

    That means the CLOCK half of the gate needs nothing armed and carries no
    risk: the host writes `Trigger Details: ScheduleStatus: {"Last": ...,
    "Next": ...}` on every invocation, already carrying the Chicago offset. The
    schedule can be proven correct from history, today, before any decision to
    arm anything.

    What arming proves is different and comes second: that the HANDLER does its
    work. Prove the clock from the skip traces first; then arm.

.PARAMETER Name
    Function name, e.g. syncRssFeeds. Omit to report on every registered timer.

.PARAMETER Hours
    How far back to look. Default 24 — enough for a daily timer. Use 192 for
    the weekly ones (checkLiveLinks, reVerifyCertifications, scrapeSkillsHubRss).

.PARAMETER SkipPreflight
    Skip the telemetry-plane check. Only when you have already run it this
    session — an over-cap workspace makes every result below meaningless.

.EXAMPLE
    ./05-verify-timer.ps1 -Name cleanupTempStorage
    ./05-verify-timer.ps1 -Hours 192 -Name checkLiveLinks

.NOTES
    Requires: az CLI signed in, with Log Analytics Reader on the workspace and
    reader on the Function App. Read-only throughout — this script changes
    nothing.

    Turning a timer ON is a Terraform variable edit, not a code change: add its
    flag suffix to `enabled_timers` in the HCP Terraform workspace and apply.
    `schedulers_master_enabled` is a separate master kill switch that holds
    every timer off regardless — arming the first timer means setting BOTH.
#>
[CmdletBinding()]
param(
    [string] $Name,
    [int] $Hours = 24,
    [switch] $SkipPreflight,
    [string] $WorkspaceId = 'cf80dc24-2499-49a0-8c66-9522bcc294ed',
    [string] $WorkspaceName = 'log-plat-prod-cus-01',
    [string] $WorkspaceResourceGroup = 'rg-mgmt-plat-prod-cus',
    [string] $WorkspaceSubscription = '02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e',
    [string] $FunctionApp = 'func-site-prod-cus-01',
    [string] $ResourceGroup = 'rg-web-site-prod-cus'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

<#
    Run an `az` command and parse its JSON.

    Wrapped because PowerShell 7.4+ turns $PSNativeCommandUseErrorActionPreference
    on by default: with $ErrorActionPreference = 'Stop' a non-zero az exit THROWS
    at the call site, before any $LASTEXITCODE check below it can run. Returns
    $null on failure so callers can say something useful instead.
#>
function Invoke-AzJson {
    param([string[]] $AzArgs)
    try {
        $json = az @AzArgs -o json 2>$null
    }
    catch {
        return $null
    }
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    try { return ($json | ConvertFrom-Json) }
    catch { return $null }
}
function Write-Warn { param($Text) Write-Host $Text -ForegroundColor Yellow }
function Write-Good { param($Text) Write-Host $Text -ForegroundColor Green }
function Write-Bad { param($Text) Write-Host $Text -ForegroundColor Red }

$chicago = [System.TimeZoneInfo]::FindSystemTimeZoneById('America/Chicago')

<#
    Render a UTC timestamp from the workspace as Chicago local time.

    The zone suffix is computed per-timestamp rather than once, because a
    window can straddle a DST boundary and printing every row as CDT through a
    November re-run would be the same class of error this script exists to
    catch. Returns '(none)' for a null, which is what an empty aggregate gives.
#>
function Format-Chicago {
    param([string] $Utc)
    if (-not $Utc) { return '(none)' }
    try { $parsed = ([datetime]::Parse($Utc)).ToUniversalTime() }
    catch { return "(unparseable: $Utc)" }
    $local = [System.TimeZoneInfo]::ConvertTimeFromUtc($parsed, $chicago)
    $zone = if ($chicago.IsDaylightSavingTime($local)) { 'CDT' } else { 'CST' }
    return ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f $local, $zone)
}

<#
    Run one KQL query against the WORKSPACE.

    Never `az monitor app-insights query --app` — see the header. Returns the
    row array, or $null when the CALL ITSELF failed. A caller must not read
    $null as "no rows": that conflation is what put two wrong conclusions in
    the record on 2026-08-22.
#>
function Invoke-WorkspaceQuery {
    param([string] $Kql)

    try {
        $json = az monitor log-analytics query `
            --workspace $WorkspaceId `
            --subscription $WorkspaceSubscription `
            --analytics-query $Kql `
            -o json 2>$null
    }
    catch {
        return $null
    }
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }

    try { return @($json | ConvertFrom-Json) }
    catch { return $null }
}

# ---------------------------------------------------------------------------
# Preflight — is the telemetry plane itself alive?
# ---------------------------------------------------------------------------
# Both of these failure modes turn "the timer did not fire" and "the timer
# fired and nobody heard it" into the same observation, so they are settled
# BEFORE anything below is read as evidence.
if (-not $SkipPreflight) {
    Write-Step 'Preflight — is telemetry trustworthy right now?'

    $workspace = Invoke-AzJson @(
        'monitor', 'log-analytics', 'workspace', 'show',
        '-g', $WorkspaceResourceGroup, '-n', $WorkspaceName,
        '--subscription', $WorkspaceSubscription
    )
    $capping = $workspace.workspaceCapping.dataIngestionStatus

    if (-not $capping) {
        Write-Bad 'Could not read the workspace capping status.'
        $msg = 'Preflight failed: the workspace could not be read, so nothing below can be ' +
        'trusted as evidence. Re-run with -SkipPreflight only if you have just confirmed it by hand.'
        throw $msg
    }

    if ($capping -eq 'RespectQuota') {
        Write-Good "ingestion: $capping"
    }
    else {
        Write-Bad "ingestion: $capping"
        $msg = "The workspace is over its ingestion cap ($capping). Traces are being DISCARDED, " +
        'so an empty result below would mean nothing at all. Raise the cap or wait for the ' +
        'reset before using this script as evidence.'
        throw $msg
    }

    $alive = Invoke-WorkspaceQuery @"
AppTraces
| where TimeGenerated > ago(2h)
| extend cat = tostring(Properties.Category)
| where cat startswith 'Function'
| summarize n = count()
"@

    if ($null -eq $alive) {
        throw 'Preflight failed: the workspace query did not run. Check az login and Log Analytics Reader.'
    }

    $aliveCount = if ($alive.Count -gt 0) { [int]$alive[0].n } else { 0 }
    if ($aliveCount -gt 0) {
        Write-Good "worker traces in the last 2 h: $aliveCount"
    }
    else {
        Write-Warn 'No worker traces in the last 2 h.'
        Write-Host 'always_ready = 0, so the app scales to zero and a worker torn down between'
        Write-Host 'flush intervals takes its buffered telemetry with it. Send sustained traffic'
        Write-Host 'for a few minutes and re-run. An empty result from a cold app is not evidence.'
    }
}

# ---------------------------------------------------------------------------
# What is registered, and what is armed
# ---------------------------------------------------------------------------
Write-Step 'Armed flags'
$settings = Invoke-AzJson @('functionapp', 'config', 'appsettings', 'list', '-n', $FunctionApp, '-g', $ResourceGroup)
if ($null -eq $settings) { throw "Could not read app settings for $FunctionApp. Check az login and reader access." }
$master = ($settings | Where-Object { $_.name -eq 'FEATURE_FLAG_SCHEDULERS' }).value

if ($master -eq 'false') {
    Write-Warn "FEATURE_FLAG_SCHEDULERS = false   <-- master kill switch: every handler is a no-op"
    Write-Host 'The timers still FIRE on this schedule — the flag is checked inside the handler.'
    Write-Host 'That is what makes the clock provable below without arming anything.'
}
else {
    Write-Good "FEATURE_FLAG_SCHEDULERS = $master"
}

$armed = @($settings |
        Where-Object { $_.name -like 'FEATURE_FLAG_*' -and $_.name -ne 'FEATURE_FLAG_SCHEDULERS' -and $_.value -eq 'true' } |
        ForEach-Object { $_.name -replace '^FEATURE_FLAG_', '' })
Write-Host "armed: $(if ($armed.Count) { $armed -join ', ' } else { '(none)' })"

Write-Step 'Registered schedules'
$allFunctions = Invoke-AzJson @('functionapp', 'function', 'list', '-n', $FunctionApp, '-g', $ResourceGroup)
if ($null -eq $allFunctions) { throw "Could not list functions on $FunctionApp. Check az login and reader access." }
$timers = @($allFunctions |
        Where-Object { $_.config.bindings[0].type -eq 'timerTrigger' } |
        ForEach-Object {
            [pscustomobject]@{
                Name     = ($_.name -split '/')[-1]
                Schedule = $_.config.bindings[0].schedule
            }
        })
if ($Name) { $timers = @($timers | Where-Object { $_.Name -eq $Name }) }
if ($timers.Count -eq 0) { throw "No timer trigger named '$Name' is registered on $FunctionApp." }
$timers | Sort-Object Name | Format-Table -AutoSize | Out-String | Write-Host

# ---------------------------------------------------------------------------
# The evidence
# ---------------------------------------------------------------------------
# `Trigger Details: ScheduleStatus: {"Last":"...-05:00","Next":"...-05:00"}` is
# written by the HOST on every invocation, armed or not, and its offsets are
# already WEBSITE_TIME_ZONE. That is the comparison §7 asks for, delivered by
# the platform rather than computed here — so a bug in this script's own
# arithmetic cannot manufacture a pass.
Write-Step "Invocations in the last $Hours h"

# The host writes 'Function.<name>'; the handler's own context.log writes
# 'Function.<name>.User'. Splitting on '.' and taking element 1 catches BOTH,
# which matters because "disabled — skipping" only ever appears on the .User row.
$nameList = ($timers.Name | ForEach-Object { "'$_'" }) -join ','

# ---------------------------------------------------------------------------
# REWRITTEN 2026-08-30. THE AGGREGATION HAPPENS IN KQL, NOT HERE.
# ---------------------------------------------------------------------------
# The previous version fetched every matching trace row and classified them in
# PowerShell, printing one line per row. During the T-518 arming gate on
# 2026-08-30 it printed 57,581 lines for a query that returns 2 rows. The query
# was then run by hand against the same workspace and returned 2, so the fault
# was in the client-side path between the fetch and the render. It was NOT
# root-caused, and nothing below assumes it has been.
#
# Instead the workspace now returns ONE ROW PER TIMER, already summarized, and
# every number printed is the workspace's own. A client-side bug can no longer
# inflate a count, because there is no client-side counting left to get wrong,
# and there is no per-row listing to bury the answer in. The number of rows
# fetched is printed next to the table, so any future disagreement between what
# was fetched and what was rendered is visible in one line instead of a wall.
#
# An invocation is identified by OperationId, which the host row and the
# handler's own .User row of a single invocation share. It counts as SKIPPED if
# any of its rows carries "disabled — skipping", RAN otherwise — the same rule
# as before, applied where it cannot be miscounted. Rows with an empty
# OperationId collapse into one pseudo-invocation; that has not been observed,
# and the raw row count beside the table is what would expose it.
$summary = Invoke-WorkspaceQuery @"
AppTraces
| where TimeGenerated > ago(${Hours}h)
| extend cat = tostring(Properties.Category)
| where cat startswith 'Function.'
| extend timerName = tostring(split(cat, '.')[1])
| where timerName in ($nameList)
| where Message has 'disabled' or Message has 'Executed'
| summarize skips = countif(Message has 'disabled'), started = min(TimeGenerated) by timerName, OperationId
| summarize invocations = count(), ran = countif(skips == 0), skipped = countif(skips > 0), firstSeen = min(started), lastSeen = max(started) by timerName
| order by timerName asc
"@

if ($null -eq $summary) {
    Write-Bad 'The workspace query did not run.'
    $msg = 'This is NOT "the timer did not fire" — the query itself failed, so there is no ' +
    'observation either way. Check az login, the subscription, and Log Analytics Reader on ' +
    "$WorkspaceName."
    throw $msg
}

if ($summary.Count -eq 0) {
    Write-Warn "No invocation rows for these timers in the last $Hours h."
    Write-Host ''
    Write-Host 'Read this carefully — it has two very different causes:'
    Write-Host '  1. The timer genuinely is not firing.            <- a real failure'
    Write-Host '  2. The app was cold and its telemetry was lost.  <- not evidence of anything'
    Write-Host ''
    Write-Host 'The preflight above distinguishes them. If it reported worker traces, cause 1'
    Write-Host 'is the live hypothesis. If it warned about a cold app, send sustained traffic'
    Write-Host 'and re-run before concluding anything. Widen with -Hours for a weekly timer.'
}
else {
    foreach ($s in $summary) {
        $first = Format-Chicago $s.firstSeen
        $last = Format-Chicago $s.lastSeen
        $colour = if ([int]$s.ran -gt 0) { 'Green' } else { 'Gray' }
        $line = "  {0,-28} {1,5} invocations  {2,5} ran  {3,5} skipped   first {4}   last {5}"
        Write-Host ($line -f $s.timerName, $s.invocations, $s.ran, $s.skipped, $first, $last) -ForegroundColor $colour
    }
    Write-Host ''
    Write-Host ("  ({0} summary row(s) returned by the workspace)" -f $summary.Count)
}

# ---------------------------------------------------------------------------
# The clock
# ---------------------------------------------------------------------------
# `Trigger Details: ScheduleStatus: {"Last":"...-05:00","Next":"...-05:00"}` is
# written by the HOST on every invocation, armed or not, and its offsets are
# already WEBSITE_TIME_ZONE. That is the comparison §7 asks for, delivered by
# the platform rather than computed here — so a bug in this script's own
# arithmetic cannot manufacture a pass. Bounded to the ten most recent, because
# the whole point is to read them, and ten is more than enough to see an offset.
Write-Step 'Schedule status, as the host itself reported it'
$schedule = Invoke-WorkspaceQuery @"
AppTraces
| where TimeGenerated > ago(${Hours}h)
| extend cat = tostring(Properties.Category)
| where cat startswith 'Function.'
| extend timerName = tostring(split(cat, '.')[1])
| where timerName in ($nameList)
| where Message has 'Trigger Details'
| project TimeGenerated, timerName, Message
| order by TimeGenerated desc
| take 10
"@

if ($null -eq $schedule) {
    throw 'The ScheduleStatus query did not run. Check az login and Log Analytics Reader.'
}

$sawSchedule = $false
foreach ($r in $schedule) {
    $status = @([regex]::Matches($r.Message, '"Last"\s*:\s*"([^"]+)"'))
    if ($status.Count -eq 0) { continue }
    $sawSchedule = $true
    $last = $status[0].Groups[1].Value
    $nextMatch = @([regex]::Matches($r.Message, '"Next"\s*:\s*"([^"]+)"'))
    $next = if ($nextMatch.Count -gt 0) { $nextMatch[0].Groups[1].Value } else { '(none)' }
    Write-Host ("  {0,-28} Last {1}   Next {2}" -f $r.timerName, $last, $next) -ForegroundColor Green
}
if (-not $sawSchedule) { Write-Warn '  (none in this window)' }

Write-Step 'How to read this'
Write-Host 'NCRONTAB is {second} {minute} {hour} {day} {month} {day-of-week}, and the hour is'
Write-Host 'interpreted in WEBSITE_TIME_ZONE (America/Chicago).'
Write-Host ''
if ($sawSchedule) {
    Write-Host 'The Last/Next offsets above are the host''s own words, and they are already local.'
    Write-Host 'A daily 04:00 job whose Last reads 04:00:00-05:00 is CORRECT. One reading'
    Write-Host '04:00:00+00:00 means WEBSITE_TIME_ZONE is NOT being applied and every ported'
    Write-Host 'expression is off by five or six hours.'
}
else {
    Write-Warn 'No ScheduleStatus row was seen, so the CLOCK is still unproven.'
    Write-Host 'Only "Trigger Details" carries the platform''s local-time view. Widen -Hours,'
    Write-Host 'or pick a fixed-hour timer: a 5-minute timer fires at :00 :05 :10 in EVERY'
    Write-Host 'zone, so it can never prove the clock however many times you watch it.'
}
Write-Host ''
Write-Host 'A SKIPPED invocation proves the trigger fires and the flag gate works. That is the'
Write-Host 'expected state before arming, and it is sufficient for the clock half of the gate.'
Write-Host 'A RAN invocation is one whose traces carry no skip line — which is weaker than it'
Write-Host 'sounds, since a dropped .User trace would look the same. Pair it with the timer''s'
Write-Host 'own durable side effect (Cutover-Runbook, "Gate 4 needs two independent witnesses").'
Write-Host ''
Write-Host 'first/last are the Chicago local times of the earliest and latest invocation seen.'
Write-Host 'For a 5-minute timer they should straddle most of the window with no long gap.'

