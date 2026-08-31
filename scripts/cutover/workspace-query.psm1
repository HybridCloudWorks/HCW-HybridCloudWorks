<#
    Pure helpers for talking to a Log Analytics workspace through `az`.

    They live in a module rather than inside 05-verify-timer.ps1 so they can be
    tested without an Azure login, a workspace, or a network. That is not a
    style preference. The defect these exist to prevent survived two rewrites of
    that script precisely because nothing could execute its internals off-line,
    so every "fix" was reasoning about code that had never been run against a
    known input.
#>

<#
    Flatten a KQL query onto a single line.

    THIS IS LOAD-BEARING ON WINDOWS, NOT COSMETIC.

    `az` is `az.cmd` there, so every argument is handed to a batch file through
    cmd.exe, and a batch file cannot receive an argument containing a newline.
    A multi-line query passed to --analytics-query arrives truncated at the
    first line break: `AppTraces` survives and the entire pipeline after it is
    discarded. The call then SUCCEEDS. Azure runs the truncated query, returns
    tens of thousands of unfiltered rows, and exits 0 — so nothing in the
    caller's error handling fires, and the numbers that come back are real
    numbers about the wrong question.

    That is what produced 57,581 "invocations" for a query whose aggregate
    returns one row, on 2026-08-30, and what made the same script report zero
    worker traces in the same breath. The tell was in the record for a week and
    was read as a client-side counting bug twice: the count barely moved
    between `-Hours 1` and `-Hours 24`. A window that changes 24-fold cannot
    return the same total unless the window is not being applied.

    KQL treats a newline and a space identically between tokens, so joining is
    semantically free. The one thing it would break is a string literal spanning
    lines; none of the queries here contain one, and a future query that does
    must be written with an explicit `\n` rather than a real line break.
#>
function ConvertTo-SingleLineKql {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Kql)
    return ($Kql -replace '\s*\r?\n\s*', ' ').Trim()
}

<#
    Fail loudly when the workspace returned rows that are not the rows asked for.

    A truncated query does not error. It answers a different question, and every
    projection the caller reads comes back empty while the row count comes back
    enormous — which renders as a wall of blank columns rather than as a fault.
    Checking the SHAPE of the first row turns that silent substitution into a
    stop, and is the check whose absence let the same wrong number be reported
    four times.

    Zero rows is not a shape failure: an aggregate with no matching input
    legitimately returns nothing, and the caller distinguishes "no evidence"
    from "evidence of absence" itself.
#>
function Assert-WorkspaceRowShape {
    param(
        [object[]] $Rows,
        [string[]] $ExpectColumns,
        [string] $What = 'the workspace query'
    )

    if (-not $ExpectColumns -or $ExpectColumns.Count -eq 0) { return }
    if (-not $Rows -or $Rows.Count -eq 0) { return }

    $present = @($Rows[0].PSObject.Properties.Name)
    $missing = @($ExpectColumns | Where-Object { $_ -notin $present })
    if ($missing.Count -eq 0) { return }

    $msg = "$What returned $($Rows.Count) row(s) that do not carry: $($missing -join ', '). " +
    "The rows that came back have: $($present -join ', '). " +
    'The query did not run as written — an argument-passing failure can truncate it and ' +
    'still exit 0, so this is NOT "no results" and the counts above must not be read as data.'
    throw $msg
}

Export-ModuleMember -Function ConvertTo-SingleLineKql, Assert-WorkspaceRowShape
