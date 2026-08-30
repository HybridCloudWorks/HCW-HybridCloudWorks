<#
    Tests for validate-powershell.ps1, run against fixtures of deliberately
    broken files.

    WHY THIS EXISTS. The gate it tests was itself shipped with a defect that
    review caught and four rounds of mutation testing did not: under
    `$ErrorActionPreference = 'Stop'`, `Write-Error` is TERMINATING, so the
    findings loop stopped after the first problem and the `exit 1` beneath it
    never ran. Measured on pwsh 7.4.6: one of three findings printed.

    It survived because the exit code is 1 either way — the terminating error
    exits non-zero on its own — so CI's red and green look identical with the
    bug and without it. And it survived the mutation tests because every one of
    them planted exactly ONE defect in ONE file, which a validator that stops
    after the first finding passes perfectly.

    That is the shape of the whole problem: a guard nobody exercises through its
    failure path is a guard nobody has tested. So the cases below assert on the
    OUTPUT, not merely the exit code, and the multi-finding case is the one that
    would have caught the original bug.

    No test framework. Pester is not guaranteed on a runner and pulling a module
    in to assert four strings would be a heavier dependency than the thing under
    test.
#>

$ErrorActionPreference = 'Stop'

$validator = Join-Path $PSScriptRoot 'validate-powershell.ps1'
if (-not (Test-Path -LiteralPath $validator)) { throw "Not found: $validator" }

$failures = [System.Collections.Generic.List[string]]::new()
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("psgate-" + [guid]::NewGuid().ToString('n'))

<#
    Run the validator over one fixture directory and hand back both halves of
    what it did. Merging the streams matters: findings go to stderr and the
    pass line to stdout, and a test that watched only one of them would be the
    same half-blind instrument this all started with.
#>
function Invoke-Gate {
    param([string] $Directory)
    $output = & pwsh -NoProfile -File $validator -Root $Directory 2>&1 | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
}

function New-Fixture {
    param([string] $Name)
    $path = Join-Path $fixtureRoot $Name
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function Assert {
    param([string] $Case, [bool] $Condition, [string] $Detail)
    if ($Condition) { Write-Host "  ok   $Case" }
    else {
        Write-Host "  FAIL $Case"
        $failures.Add("${Case}: $Detail")
    }
}

try {
    # -- a clean tree passes, and says how much it looked at ------------------
    $clean = New-Fixture 'clean'
    [System.IO.File]::WriteAllText((Join-Path $clean 'good.ps1'), "<#`n  fine`n#>`nWrite-Output 1`n")
    $r = Invoke-Gate $clean
    Assert 'clean tree exits 0' ($r.ExitCode -eq 0) "exit was $($r.ExitCode)"
    Assert 'clean tree reports the count' ($r.Output -match '1 file\(s\) parse') $r.Output

    # -- THE REGRESSION CASE -------------------------------------------------
    # Four findings across two files. The bug this file exists for printed only
    # the first and still exited 1, so asserting the exit code alone passes
    # against the broken version. Every finding has to appear.
    $many = New-Fixture 'many'
    [System.IO.File]::WriteAllBytes(
        (Join-Path $many 'a.ps1'),
        [byte[]] (0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes("<#`r`n ok`r`n#>`r`n`$x = @`"`r`nunterminated`r`n"))
    [System.IO.File]::WriteAllText((Join-Path $many 'b.ps1'), "function f {`n  Write-Output 1`n")
    $r = Invoke-Gate $many
    Assert 'multi-finding tree fails' ($r.ExitCode -ne 0) "exit was $($r.ExitCode)"
    Assert 'reports the BOM'                ($r.Output -match 'a\.ps1: starts with a UTF-8 BOM') $r.Output
    Assert 'reports the CR byte'            ($r.Output -match 'a\.ps1: contains a CR byte') $r.Output
    Assert 'reports the parse error in a'   ($r.Output -match 'a\.ps1:\d+:') $r.Output
    Assert 'reports the parse error in b'   ($r.Output -match 'b\.ps1:\d+:') $r.Output

    # -- each class alone, so a pass cannot come from one check covering another
    $bom = New-Fixture 'bom'
    [System.IO.File]::WriteAllBytes(
        (Join-Path $bom 'c.ps1'),
        [byte[]] (0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes("Write-Output 1`n"))
    $r = Invoke-Gate $bom
    Assert 'a BOM alone fails' (($r.ExitCode -ne 0) -and ($r.Output -match 'UTF-8 BOM')) $r.Output

    $crlf = New-Fixture 'crlf'
    [System.IO.File]::WriteAllText((Join-Path $crlf 'd.ps1'), "Write-Output 1`r`n")
    $r = Invoke-Gate $crlf
    Assert 'a CR byte alone fails' (($r.ExitCode -ne 0) -and ($r.Output -match 'CR byte')) $r.Output

    $syntax = New-Fixture 'syntax'
    [System.IO.File]::WriteAllText((Join-Path $syntax 'e.ps1'), "`$x = @`"`nnever terminated`n")
    $r = Invoke-Gate $syntax
    Assert 'an unterminated here-string alone fails' (($r.ExitCode -ne 0) -and ($r.Output -match 'terminator')) $r.Output

    # -- an empty sweep is not a pass ---------------------------------------
    $empty = New-Fixture 'empty'
    $r = Invoke-Gate $empty
    Assert 'an empty sweep fails' (($r.ExitCode -ne 0) -and ($r.Output -match 'scans nothing')) $r.Output
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}
Write-Output 'validate-powershell.ps1 tests passed.'
