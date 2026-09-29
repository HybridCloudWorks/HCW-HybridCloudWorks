<#
    Pester 5 tests for 06-seed-secret.ps1 (#814).

    The script's break-glass job is seeding a Key Vault secret when the site
    itself is down, so it is the one tool that cannot be checked by using it
    on a good day. It read infra/main.tf alone, and from the split (#269)
    until 2026-09-29 every run stopped at "Parsed no secret names" — including
    -Mode List, which changes nothing. What is tested here is that failure:
    which names the script will accept, read from the repository as it stands.

    The functions are loaded from the script's syntax tree, so its main body
    does not run in those tests: no az call, no prompt, no firewall window.
    The one whole-script run is -Mode List, which returns before any of them.

    From the repository root:
        pwsh -NoProfile -Command "Invoke-Pester scripts/cutover -Output Detailed"
#>

BeforeAll {
    $scriptPath = Join-Path $PSScriptRoot '06-seed-secret.ps1'
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref] $null, [ref] $parseErrors)
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        throw "06-seed-secret.ps1 does not parse: $($parseErrors[0].Message)"
    }
    $definitions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
    foreach ($definition in $definitions) {
        . ([scriptblock]::Create($definition.Extent.Text))
    }

    # The script's own -Generate allowlist, read from its syntax tree rather
    # than copied here, where it could drift from the script.
    $generatableAssignment = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
            $node.Left.Extent.Text -eq '$GENERATABLE'
        }, $false)
    $generatable = @($generatableAssignment.Right.FindAll({
                param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
            }, $true) | ForEach-Object { $_.Value })

    $infra = Join-Path $PSScriptRoot '../../infra'

    function New-TfFixture {
        param([string[]] $Bodies)
        $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir | Out-Null
        for ($i = 0; $i -lt $Bodies.Count; $i++) {
            Set-Content -LiteralPath (Join-Path $dir "file$i.tf") -Value $Bodies[$i] -NoNewline
        }
        $dir
    }
}

Describe 'Get-ReferencedSecretName, against the repository' {
    It 'finds the references wherever the module keeps them, not in main.tf alone' {
        # The failure itself: main.tf holds none of them since the split.
        $names = Get-ReferencedSecretName -InfraPath $infra
        $names.Count | Should -BeGreaterThan 15
        (Get-Content -LiteralPath (Join-Path $infra 'main.tf') -Raw) | Should -Not -Match 'secrets/'
    }

    It 'names each secret once, in the UPPER-KEBAB-CASE Key Vault requires' {
        $names = Get-ReferencedSecretName -InfraPath $infra
        @($names | Select-Object -Unique).Count | Should -Be $names.Count
        foreach ($name in $names) { $name | Should -MatchExactly '^[A-Z0-9]+(-[A-Z0-9]+)*$' }
    }

    It 'accepts every name -Generate is allowed for, or -Generate could never run' {
        $generatable.Count | Should -BeGreaterThan 0
        $names = Get-ReferencedSecretName -InfraPath $infra
        foreach ($name in $generatable) { $names | Should -Contain $name }
    }
}

Describe 'Get-ReferencedSecretName, against fixtures' {
    It 'keeps a single reference an array' {
        $dir = New-TfFixture @(
            '"A" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/ONLY-ONE)"',
            '', '', ''
        )
        $names = Get-ReferencedSecretName -InfraPath $dir
        $names.GetType().IsArray | Should -BeTrue
        $names.Count | Should -Be 1
        $names[0] | Should -Be 'ONLY-ONE'
    }

    It 'reads every .tf file in the directory' {
        $dir = New-TfFixture @(
            '"A" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/FROM-FIRST)"',
            '"B" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.hcw.vault_uri}secrets/FROM-LAST)"',
            '', ''
        )
        (Get-ReferencedSecretName -InfraPath $dir) -join ',' | Should -Be 'FROM-FIRST,FROM-LAST'
    }

    It 'refuses a directory that is not the root module' {
        { Get-ReferencedSecretName -InfraPath (Join-Path $TestDrive 'nowhere') } | Should -Throw '*run this from the repository*'
    }

    It 'refuses a module it can parse no names from, rather than accepting nothing' {
        $dir = New-TfFixture @('', '', '', '')
        { Get-ReferencedSecretName -InfraPath $dir } | Should -Throw '*Parsed no secret names*'
    }
}

Describe '06-seed-secret.ps1 -Mode List' {
    It 'lists the referenced names from a clean checkout, and changes nothing' {
        # -Mode List returns before the first az call, so this runs anywhere.
        $output = & $scriptPath -Mode List 6>&1 | Out-String
        $output | Should -Match 'Secrets referenced by infra/'
        foreach ($name in $generatable) { $output | Should -Match ([regex]::Escape($name)) }
    }
}
