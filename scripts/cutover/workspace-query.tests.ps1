<#
.SYNOPSIS
    Tests for workspace-query.psm1 — the KQL transport helpers.

.DESCRIPTION
    These exist because the defect they cover was reported four times before it
    was found, and every intervening "fix" was written against code that could
    not be executed without an Azure login. Asserting on OUTPUT, off-line, is
    what makes the difference between a guard and a claim.

    Run: pwsh -File scripts/cutover/workspace-query.tests.ps1
#>

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'workspace-query.psm1') -Force

$script:failures = 0
$script:checks = 0

function Assert-Equal {
    param($Expected, $Actual, [string] $Because)
    $script:checks++
    if ($Expected -ceq $Actual) { Write-Host "  ok   $Because" -ForegroundColor Green; return }
    $script:failures++
    Write-Host "  FAIL $Because" -ForegroundColor Red
    Write-Host "       expected: [$Expected]"
    Write-Host "       actual:   [$Actual]"
}

function Assert-Throws {
    param([scriptblock] $Action, [string] $Match, [string] $Because)
    $script:checks++
    try { & $Action }
    catch {
        if ("$_" -like "*$Match*") { Write-Host "  ok   $Because" -ForegroundColor Green; return }
        $script:failures++
        Write-Host "  FAIL $Because" -ForegroundColor Red
        Write-Host "       threw, but the message did not contain [$Match]: $_"
        return
    }
    $script:failures++
    Write-Host "  FAIL $Because — it did not throw" -ForegroundColor Red
}

function Assert-NoThrow {
    param([scriptblock] $Action, [string] $Because)
    $script:checks++
    try { & $Action; Write-Host "  ok   $Because" -ForegroundColor Green }
    catch { $script:failures++; Write-Host "  FAIL $Because — it threw: $_" -ForegroundColor Red }
}

Write-Host "`n=== ConvertTo-SingleLineKql ===" -ForegroundColor Cyan

# The case that matters: a real query. If the join ever stops happening, the
# argument goes back to carrying a newline and the whole failure returns.
$multi = @"
AppTraces
| where TimeGenerated > ago(24h)
| summarize n = count()
"@
Assert-Equal 'AppTraces | where TimeGenerated > ago(24h) | summarize n = count()' `
    (ConvertTo-SingleLineKql $multi) `
    'a three-line query becomes one line with single spaces at the joins'

Assert-Equal $false `
    ((ConvertTo-SingleLineKql $multi).Contains("`n")) `
    'the result contains no newline at all — the property az.cmd actually requires'

Assert-Equal 'AppTraces | count' (ConvertTo-SingleLineKql "`r`nAppTraces`r`n| count`r`n") `
    'CRLF input is flattened too, and leading and trailing breaks are trimmed'

Assert-Equal 'AppTraces | count' (ConvertTo-SingleLineKql "AppTraces`n    | count") `
    'indentation at a line start collapses into the single joining space'

Assert-Equal 'AppTraces | where Message has ''a b''' `
    (ConvertTo-SingleLineKql "AppTraces`n| where Message has 'a b'") `
    'spaces inside a single-line string literal are preserved'

Assert-Equal 'AppTraces' (ConvertTo-SingleLineKql 'AppTraces') `
    'a query that is already one line is returned unchanged'

Assert-Equal '' (ConvertTo-SingleLineKql "  `n  ") `
    'whitespace-only input flattens to the empty string rather than a lone space'

Write-Host "`n=== Assert-WorkspaceRowShape ===" -ForegroundColor Cyan

$good = @([pscustomobject]@{ timerName = 'checkAgentHealth'; invocations = 288; ran = 288; skipped = 0 })
Assert-NoThrow { Assert-WorkspaceRowShape -Rows $good -ExpectColumns 'timerName', 'invocations' } `
    'rows carrying every expected column pass'

# The observed failure: a truncated query returns raw AppTraces rows. They carry
# Message and TimeGenerated, and none of the aggregate columns the caller reads.
$truncated = @(
    [pscustomobject]@{ TimeGenerated = '2026-08-30T23:43:40Z'; Message = 'Executed'; OperationId = 'abc' }
) * 3
Assert-Throws { Assert-WorkspaceRowShape -Rows $truncated -ExpectColumns 'timerName', 'invocations', 'ran' } `
    'timerName' 'raw rows from a truncated query throw, naming the missing column'

Assert-Throws { Assert-WorkspaceRowShape -Rows $truncated -ExpectColumns 'timerName' } `
    'did not run as written' 'the message says the query did not run as written'

Assert-Throws { Assert-WorkspaceRowShape -Rows $truncated -ExpectColumns 'timerName' } `
    'must not be read as data' 'the message forbids reading the counts as data'

Assert-Throws { Assert-WorkspaceRowShape -Rows $truncated -ExpectColumns 'timerName' -What 'the summary query' } `
    'the summary query' 'the message names which query failed'

# Zero rows is a legitimate answer, not a shape failure. The caller has its own
# branch that separates "no evidence" from "evidence of absence", and a throw
# here would take that decision away from it.
Assert-NoThrow { Assert-WorkspaceRowShape -Rows @() -ExpectColumns 'timerName' } `
    'an empty result is not a shape failure'

Assert-NoThrow { Assert-WorkspaceRowShape -Rows $null -ExpectColumns 'timerName' } `
    'a null result is not a shape failure'

Assert-NoThrow { Assert-WorkspaceRowShape -Rows $truncated -ExpectColumns @() } `
    'a caller that declares no columns opts out'

# A partial match must still fail: the wall of blank columns in the field report
# came from rows that carried SOME of what was asked for.
$partial = @([pscustomobject]@{ timerName = 'x'; Message = 'y' })
Assert-Throws { Assert-WorkspaceRowShape -Rows $partial -ExpectColumns 'timerName', 'invocations' } `
    'invocations' 'one missing column out of two is still a failure'

Write-Host ''
if ($script:failures -gt 0) {
    Write-Host "$($script:failures) of $($script:checks) checks FAILED." -ForegroundColor Red
    exit 1
}
Write-Host "All $($script:checks) checks passed." -ForegroundColor Green
exit 0
