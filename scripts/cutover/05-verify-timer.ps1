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

Import-Module (Join-Path $PSScriptRoot 'workspace-query.psm1') -Force

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
    Render a workspace timestamp as Chicago local time.

    The zone suffix is computed per-timestamp rather than once, because a
    window can straddle a DST boundary and printing every row as CDT through a
    November re-run would be the same class of error this script exists to
    catch. Returns '(none)' for a null, which is what an empty aggregate gives.

    THE PARSE IS EXPLICIT ABOUT BOTH CULTURE AND KIND, deliberately. The
    obvious `[datetime]::Parse($s).ToUniversalTime()` — which this script used
    until 2026-08-30 — reads the string in the OPERATOR'S culture and, when it
    carries no offset or Z, yields Kind=Unspecified. ToUniversalTime() then
    treats that as local and shifts it by the operator's own offset: five hours
    in Chicago, silently, inside the one tool whose entire job is catching
    five-hour errors. AssumeUniversal says what the workspace actually returns;
    AdjustToUniversal makes the result Kind=Utc rather than re-converted. A
    value that arrives already typed as [datetime] skips parsing and has its
    Kind normalised the same way, since stringifying it first would put the
    operator's culture back into the path we just removed.
#>
function Format-Chicago {
    param([object] $Value)
    if ($null -eq $Value -or ($Value -is [string] -and -not $Value)) { return '(none)' }

    if ($Value -is [datetime]) {
        if ($Value.Kind -eq [System.DateTimeKind]::Utc) { $utc = $Value }
        elseif ($Value.Kind -eq [System.DateTimeKind]::Local) { $utc = $Value.ToUniversalTime() }
        else { $utc = [datetime]::SpecifyKind($Value, [System.DateTimeKind]::Utc) }
    }
    else {
        $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
        try { $utc = [datetime]::Parse([string]$Value, [cultureinfo]::InvariantCulture, $styles) }
        catch { return "(unparseable: $Value)" }
    }

    $local = [System.TimeZoneInfo]::ConvertTimeFromUtc($utc, $chicago)
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
    param(
        [string] $Kql,
        [string[]] $ExpectColumns = @(),
        [string] $What = 'the workspace query'
    )

    # Flattened before it leaves PowerShell. On Windows `az` is a batch file and
    # cannot receive an argument containing a newline, so a multi-line query
    # arrives truncated at the first line break — and the call still exits 0.
    # workspace-query.psm1 carries the full account.
    $oneLine = ConvertTo-SingleLineKql $Kql

    # stderr is CAPTURED, not discarded, and printed when the call fails.
    #
    # It used to be `2>$null`. The intent was that a genuine az error should not
    # spray over the report, and the cost was that az's own explanation of the
    # failure went in the bin with it. Every time this script has failed, the
    # operator has been handed "the workspace query did not run" and a list of
    # three things to go and check by hand, while az had already said which one
    # it was. That happened on 2026-09-03 for the Wave 2 gates, one commit after
    # the same redirect was found hiding an interactive install prompt.
    #
    # A silent redirect is the wrong instrument for "keep the output tidy". The
    # output is only untidy on the failure path, which is exactly the path where
    # the detail is worth more than the tidiness.
    # THREE DIFFERENT FAILURES REACH THE BRANCH BELOW, and saying the wrong one
    # is how this script has misled an operator before. $LASTEXITCODE is only
    # meaningful if az actually launched: when the call throws first, it still
    # holds whatever the PREVIOUS native command left behind, so a message that
    # asserts "az exited non-zero" can be describing a command that never ran.
    # The PowerShell exception is kept for exactly that case.
    $errFile = [System.IO.Path]::GetTempFileName()
    $psError = $null
    try {
        $json = az monitor log-analytics query `
            --workspace $WorkspaceId `
            --subscription $WorkspaceSubscription `
            --analytics-query $oneLine `
            -o json 2>$errFile
    }
    catch {
        $json = $null
        $psError = $_
    }

    if ($null -ne $psError -or $LASTEXITCODE -ne 0 -or -not $json) {
        $exit = $LASTEXITCODE
        $azSaid = (Get-Content -Path $errFile -Raw -ErrorAction SilentlyContinue)
        Remove-Item -Path $errFile -ErrorAction SilentlyContinue
        if ($azSaid -and $azSaid.Trim()) {
            Write-Bad 'az reported:'
            Write-Host $azSaid.Trim() -ForegroundColor DarkYellow
            Write-Host ''
        }
        elseif ($psError) {
            Write-Bad 'The az call itself threw before it could report anything:'
            Write-Host $psError.Exception.Message -ForegroundColor DarkYellow
            Write-Host ''
        }
        else {
            Write-Warn "az exited $exit and produced no output on stdout or stderr."
        }
        return $null
    }
    Remove-Item -Path $errFile -ErrorAction SilentlyContinue

    try { $rows = @($json | ConvertFrom-Json) }
    catch { return $null }

    # Deliberately a throw, not a $null return. $null means "the call failed and
    # you have no observation"; this means "the call succeeded and answered a
    # different question", which is worse, because every number below it looks
    # like data.
    Assert-WorkspaceRowShape -Rows $rows -ExpectColumns $ExpectColumns -What $What
    # The unary comma is load-bearing. `return $rows` unrolls the array onto the
    # pipeline, and an EMPTY array unrolls to nothing — so a query that ran and
    # answered "no rows" reached the caller as $null, which every caller reads
    # as "the query did not run". That is how a zero-row answer was reported
    # as an az failure on 2026-09-03 (syncRssFeeds -Hours 8, after the #321
    # cut) and again on 2026-09-05 (cleanupSoftDeletedContent before its first
    # firing). Wrapping keeps the array one object, empty or not, so $null
    # stays reserved for the call that actually failed.
    return ,$rows
}

# ---------------------------------------------------------------------------
# The log-analytics extension must already be installed
# ---------------------------------------------------------------------------
# `az monitor log-analytics query` is NOT core az. It ships in the
# `log-analytics` extension, and on a machine without it az does not fail — it
# ASKS:
#
#   The command requires the extension log-analytics. Do you want to install
#   it now? The command will continue to run after the extension is installed.
#   (Y/n):
#
# That prompt is written to stderr, and Invoke-WorkspaceQuery redirects stderr
# to $null so a genuine az error cannot spray over the report. The prompt goes
# with it. az then blocks on stdin for an answer nobody can see, and the script
# stops dead after printing "=== Invocations in the last N h ===" with no error,
# no exit, and nothing to read.
#
# That is what happened on 2026-09-02 and again on 2026-09-03, on a laptop whose
# `az extension list` returned EMPTY. It cost the Wave 1 invocation gate, which
# was recorded as observed on the strength of a run that had actually hung.
#
# This check runs BEFORE -SkipPreflight is honoured, because the extension is
# not a telemetry-trustworthiness question — it is whether the query can be
# issued at all. Checked here rather than fixed by
# `extension.use_dynamic_install=yes_without_prompt`, because auto-installing a
# preview extension mid-run is a surprise of its own; the operator is told the
# one command to run instead.
#
# DELIBERATELY NOT ROUTED THROUGH Invoke-AzJson, and the reason is the whole
# point of this block. That helper returns $null for every failure it can have,
# and — because `ConvertFrom-Json '[]'` emits nothing — it ALSO returns $null
# for a perfectly successful `az extension list` on a machine with no
# extensions at all. That machine is exactly the one this guard exists for. A
# check written on top of it therefore cannot tell "az is broken" from "az
# works and there are no extensions", and would either misname the cause or
# miss the case entirely. Splitting on the raw exit code and the raw output is
# what keeps the two apart.
# stderr captured here for the same reason as the workspace query below it:
# discarding az's own explanation is the defect this whole change exists to fix,
# and a guard that hides the cause while complaining about hidden causes is not
# a guard worth having.
$extErrFile = [System.IO.Path]::GetTempFileName()
$extList = $null
$extError = $null
try { $extList = az extension list -o json 2>$extErrFile }
catch { $extList = $null; $extError = $_ }

if ($null -ne $extError -or $LASTEXITCODE -ne 0 -or -not $extList) {
    $extExit = $LASTEXITCODE
    $extSaid = (Get-Content -Path $extErrFile -Raw -ErrorAction SilentlyContinue)
    Remove-Item -Path $extErrFile -ErrorAction SilentlyContinue
    Write-Bad 'Could not run `az extension list`.'
    Write-Host ''
    if ($extSaid -and $extSaid.Trim()) {
        Write-Host 'az reported:'
        Write-Host $extSaid.Trim() -ForegroundColor DarkYellow
        Write-Host ''
    }
    elseif ($extError) {
        Write-Host 'The call threw before az could report anything:'
        Write-Host $extError.Exception.Message -ForegroundColor DarkYellow
        Write-Host ''
    }
    else {
        Write-Host "az exited $extExit and produced no output on stdout or stderr."
        Write-Host ''
    }
    Write-Host 'This is NOT "the extension is missing" — az itself did not answer, so its'
    Write-Host 'extensions were never enumerated. Check that az is installed and on PATH,'
    Write-Host 'then that you are signed in:'
    Write-Host ''
    Write-Host '  az account show -o json | ConvertFrom-Json | Select-Object name, id' -ForegroundColor Cyan
    Write-Host ''
    throw 'az extension list did not run; the extension state is unknown.'
}
Remove-Item -Path $extErrFile -ErrorAction SilentlyContinue

# Parsed inside a try, because $ErrorActionPreference is 'Stop' and an
# unguarded ConvertFrom-Json on non-JSON stdout would terminate this script with
# a raw parser exception — a failure that does not name its own cause, which is
# the exact thing this whole block exists to stop happening.
$installed = $null
try { $installed = @($extList | ConvertFrom-Json) }
catch { $installed = $null }

if ($null -eq $installed) {
    Write-Bad 'az extension list returned something that is not JSON.'
    Write-Host ''
    Write-Host 'The extension state is unknown — this is neither "az is broken" nor "the'
    Write-Host 'extension is missing". Run it without redirection to see what came back:'
    Write-Host ''
    Write-Host '  az extension list -o json' -ForegroundColor Cyan
    Write-Host ''
    throw 'az extension list output could not be parsed; the extension state is unknown.'
}

if (-not ($installed | Where-Object name -eq 'log-analytics')) {
    Write-Bad 'The az log-analytics extension is not installed.'
    Write-Host ''
    Write-Host 'Every workspace query below needs it. Without it az prompts to install it,'
    Write-Host 'the prompt is swallowed by the stderr redirect, and this script hangs with no'
    Write-Host 'error rather than reporting anything. Install it and re-run:'
    Write-Host ''
    Write-Host '  az extension add --name log-analytics' -ForegroundColor Cyan
    Write-Host ''
    throw 'log-analytics extension missing; no query was attempted.'
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

    $alive = Invoke-WorkspaceQuery -ExpectColumns 'n' -What 'the preflight liveness query' -Kql @"
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
# ---------------------------------------------------------------------------
# Since #321 the workspace no longer carries the rows this section reads
# ---------------------------------------------------------------------------
# The query below counts `Function.<name>` traces, which the host writes at
# INFORMATION level. host.json's `Function` category has been Warning since the
# 2026-09-02 17:59Z deploy of #321, so for every invocation after that moment
# the host wrote nothing and there is nothing here to find. A zero below is not
# "the timer did not fire" — it is "this instrument was switched off", and the
# two must not be confused on a timer someone has just armed.
#
# The repo's host.json is the deployed one (Deploy Functions ships it), so it is
# read here as the authority. History from before the cut is still queryable,
# which is why this warns and continues rather than stopping: -Hours 24 on
# 2026-09-03 correctly returned 37 sweeper invocations from before 18:00Z.
#
# For anything after the cut, the witness is the timer's durable side effect:
#   node scripts/verify-timer-witness.mjs --timer <name> --since <ISO>
#
# A per-category override — "Function.<name>": "Information" — restores the
# rows for that one timer (the T-766 per-wave path), so it is read first.
$hostJsonPath = Join-Path $PSScriptRoot '..' '..' 'functions' 'host.json'
$functionLevel = $null
$levelSource = 'Function'
try {
    $logLevel = (Get-Content -Path $hostJsonPath -Raw | ConvertFrom-Json).logging.logLevel
    $override = $logLevel.PSObject.Properties["Function.$Name"]
    if ($override) { $functionLevel = $override.Value; $levelSource = "Function.$Name" }
    else { $functionLevel = $logLevel.Function }
}
catch { $functionLevel = $null }
if ($functionLevel -and $functionLevel -notin @('Information', 'Debug', 'Trace')) {
    Write-Warn "host.json gates '$levelSource' at $functionLevel, so the host has written no Executed/ScheduleStatus"
    Write-Warn 'traces since that shipped (#321, 2026-09-02 17:59Z). Rows below can only predate it.'
    Write-Warn 'For invocations after the cut, read the durable side effect instead:'
    Write-Host "  node scripts/verify-timer-witness.mjs --timer $Name --since <the apply time, ISO 8601>" -ForegroundColor Cyan
    Write-Host ''
}

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
# was assumed to be in the client-side path between the fetch and the render.
#
# THAT ASSUMPTION WAS WRONG, and this aggregation did not fix the miscount —
# it survived into 2026-08-31, when the real cause was found one layer lower:
# the query was being TRUNCATED before Azure ever saw it. See
# workspace-query.psm1. Moving the counting into KQL was still worth doing, but
# it is not what makes the numbers below trustworthy; the flatten and the
# row-shape assertion in Invoke-WorkspaceQuery are.
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
# any of its rows carries the master-flag skip, RAN otherwise. Rows with an
# empty OperationId collapse into one pseudo-invocation; that has not been
# observed, and the raw row count beside the table is what would expose it.
#
# THE SKIP MATCH IS ANCHORED, AND MATCHES TWO SHAPES.
#
# Most timers go through schedulers.js's `timer()` helper and skip with
# `[<name>] disabled — skipping`. `platformJobSweeper` does not: jobs-sweeper.js
# registers it with `app.timer()` directly and logs
# `platformJobSweeper: disabled (FEATURE_FLAG_PLATFORM_JOB_SWEEPER)` — no
# brackets. A pattern requiring the bracketed form counted that genuine skip as
# a RUN, which is the worse direction of the two errors available here: it tells
# an operator the handler did its work when it did not, on a timer they have
# just armed and are watching. Found 2026-08-30 while checking why the
# enabled_timers catalogue lists eighteen names and schedulers.js registers
# seventeen — it registers seventeen because the eighteenth lives elsewhere.
#
# Anchoring still matters, because `disabled` is not exclusive to a skip:
# forge-scheduled.js:77 writes `[forgeScheduled] auto-forge disabled, skipping
# run.` from a handler that RAN and found its own feature switched off. A bare
# `has 'disabled'` files that as a skip — the opposite error, reporting an armed
# timer as unarmed. So the pattern requires `disabled` to follow either a
# bracketed name or a bare `name:`, which both skip lines do and the forge line
# does not.
#
# Written as a KQL verbatim literal (@'...') so the backslashes reach RE2
# instead of being eaten as KQL escapes, and it stops short of the em dash so
# nothing depends on that character surviving the trip through az.
$summary = Invoke-WorkspaceQuery -ExpectColumns 'timerName', 'invocations', 'ran', 'skipped' -What 'the invocation summary query' -Kql @"
AppTraces
| where TimeGenerated > ago(${Hours}h)
| extend cat = tostring(Properties.Category)
| where cat startswith 'Function.'
| extend timerName = tostring(split(cat, '.')[1])
| where timerName in ($nameList)
| extend isSkip = Message matches regex @'^(\[[^\]]+\]|[A-Za-z][A-Za-z0-9]*:) disabled'
| where isSkip or Message has 'Executed'
| summarize skips = countif(isSkip), started = min(TimeGenerated) by timerName, OperationId
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
$schedule = Invoke-WorkspaceQuery -ExpectColumns 'timerName', 'Message' -What 'the ScheduleStatus query' -Kql @"
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

