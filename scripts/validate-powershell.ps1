<#
    Parse and encoding gate for every PowerShell file in this repository.

    WHY THIS EXISTS. On 2026-08-30 four defects were found in one script,
    `cutover/05-verify-timer.ps1`, in a single evening:

      - every skipped timer invocation reported twice, once as a run;
      - a UTF-8 BOM introduced by an editing tool, where its four siblings
        have none;
      - a `disabled` match broad enough to catch a handler that RAN;
      - a timestamp parsed in the operator's culture, able to shift an
        offsetless value by five hours inside the one tool whose job is
        catching five-hour errors.

    Not one was caught by a check. Two were caught by a reviewer, one by an
    operator noticing a number looked wrong, one by reading the diff again.
    The repository had — and this is the whole point — no way at all to
    discover that a .ps1 did not even parse: `validate-repository-structure.ps1`
    is itself PowerShell and CI runs it, but nothing looks at any of the others.
    A script that gates a cutover decision and is never loaded until an operator
    runs it at 1 a.m. is the worst place to keep a syntax error.

    This closes the two classes a machine can settle without executing
    anything, which is what makes it safe to run in CI against scripts that
    talk to live Azure:

      PARSE  - the file is valid PowerShell. Catches an unterminated
               here-string, an unbalanced brace, a broken line continuation.
      BYTES  - no UTF-8 BOM, and no CRLF. The BOM is the exact defect above;
               CRLF is included because a .ps1 in this repository is LF and a
               mixed-ending file makes every later diff unreadable.

    IT DELIBERATELY DOES NOT EXECUTE ANYTHING. Every script here is written to
    reach a live subscription, and a validator that ran them would be a
    validator nobody could run. Behaviour is tested where behaviour can be
    tested without Azure: see scripts/powershell-hygiene.test.mjs, which pins
    the timer script's skip matcher against the actual log lines it has to
    tell apart.
#>

<#
.PARAMETER Root
    Directory to sweep. Defaults to the repository root, which is what CI runs.
    It exists so `validate-powershell.tests.ps1` can point this at a fixture of
    deliberately broken files and check that each one is actually reported — a
    guard whose failure path is never exercised is a guard nobody has tested,
    which is how the $ErrorActionPreference defect below survived its first
    review and four rounds of mutation testing.
#>
param(
    [string] $Root
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = if ($Root) {
    (Resolve-Path -LiteralPath $Root).Path
}
else {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
}
$errors = [System.Collections.Generic.List[string]]::new()

$files = @(
    Get-ChildItem -LiteralPath $repositoryRoot -Recurse -File -Include '*.ps1', '*.psm1' |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git)[\\/]' } |
        Sort-Object FullName
)

if ($files.Count -eq 0) {
    # An empty sweep is indistinguishable from a passing one, and this file
    # would then report success forever after a directory move.
    # `throw` rather than Write-Error + exit: this is a fatal precondition, not
    # one of the collected findings, and under $ErrorActionPreference = 'Stop'
    # a Write-Error here would terminate anyway — leaving the `exit 1` beneath
    # it unreachable and the intent unclear.
    throw 'No PowerShell files found. This gate scans nothing, which is not a pass.'
}

foreach ($file in $files) {
    $relative = $file.FullName.Substring($repositoryRoot.Length).TrimStart('\', '/') -replace '\\', '/'

    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $errors.Add("${relative}: starts with a UTF-8 BOM. Save it without one.")
    }
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($bytes[$i] -eq 0x0D) {
            $errors.Add("${relative}: contains a CR byte. PowerShell here is LF-only.")
            break
        }
    }

    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$parseErrors)
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        foreach ($parseError in ($parseErrors | Select-Object -First 5)) {
            $errors.Add("${relative}:$($parseError.Extent.StartLineNumber): $($parseError.Message)")
        }
    }
}

if ($errors.Count -gt 0) {
    # -ErrorAction Continue, because $ErrorActionPreference is 'Stop' at the top
    # of this file and Write-Error is therefore TERMINATING: without it the
    # first finding stops the script, the rest are never printed and `exit 1`
    # is never reached. The job still fails — the terminating error exits
    # non-zero on its own — so the bug is invisible from CI's red/green and
    # shows up only as an operator fixing one problem, re-running, and finding
    # another. Measured on pwsh 7.4.6: 1 of 3 findings printed before, 3 of 3
    # after, exit code 1 either way.
    $errors | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Output "PowerShell policy passed: $($files.Count) file(s) parse, none carry a BOM or CRLF."
