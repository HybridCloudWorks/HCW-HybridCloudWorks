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

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$errors = [System.Collections.Generic.List[string]]::new()

$files = @(
    Get-ChildItem -LiteralPath $repositoryRoot -Recurse -File -Include '*.ps1', '*.psm1' |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git)[\\/]' } |
        Sort-Object FullName
)

if ($files.Count -eq 0) {
    # An empty sweep is indistinguishable from a passing one, and this file
    # would then report success forever after a directory move.
    Write-Error 'No PowerShell files found. This gate scans nothing, which is not a pass.'
    exit 1
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
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "PowerShell policy passed: $($files.Count) file(s) parse, none carry a BOM or CRLF."
