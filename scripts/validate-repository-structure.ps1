$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$errors = [System.Collections.Generic.List[string]]::new()

# `.agents` and `.claude` are the agent harness — agent definitions, skills and
# playbooks that drive tooling against this repository. They are deliberately
# source-controlled, but they are not the site and they are not human-facing
# project documentation, so the documentation policy below does not apply to
# them and they are excluded from the Markdown scan entirely.
$harnessDirectories = @('.agents', '.claude')

$allowedDirectories = @('.azure', '.github', 'frontend', 'functions', 'infra', 'scripts', 'vps-agent') + $harnessDirectories

# The engineering plan documents are companions to the approved architecture and
# are referenced from README.md and from each other; they stay at the root.
$allowedRootFiles = @('.gitignore', 'README.md', 'Architecture_Plan.md', 'Migration_Plan.md', 'Variables.md')

# Directory names never walked by the Markdown scan, at any depth.
$unscannedDirectories = @('.git', 'node_modules') + $harnessDirectories
$unscannedPattern = '(^|/)(' + (($unscannedDirectories | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')/'

$actualDirectories = Get-ChildItem -LiteralPath $repositoryRoot -Directory -Force |
  Where-Object Name -ne '.git' |
  Select-Object -ExpandProperty Name
foreach ($directory in $actualDirectories) {
  if ($directory -notin $allowedDirectories) {
    $errors.Add("Unexpected root directory: $directory")
  }
}

$actualRootFiles = Get-ChildItem -LiteralPath $repositoryRoot -File -Force |
  Select-Object -ExpandProperty Name
foreach ($file in $actualRootFiles) {
  if ($file -notin $allowedRootFiles) {
    $errors.Add("Unexpected root file: $file")
  }
}

$prohibitedDocumentationPaths = @(
  'docs',
  'frontend/documentation',
  'frontend/docs',
  'frontend/README.md',
  'frontend/CHANGELOG.md',
  'frontend/TODO.md',
  'frontend/TODO2.0.md',
  'frontend/labs/vps-agent/README.md',
  'frontend/scripts/README.md',
  'vps-agent/README.md'
)
foreach ($relativePath in $prohibitedDocumentationPaths) {
  if (Test-Path -LiteralPath (Join-Path $repositoryRoot $relativePath)) {
    $errors.Add("Human-facing documentation must be in the GitHub Wiki: $relativePath")
  }
}

# Prune the harness (and .git / node_modules) from the walk rather than
# filtering afterwards, so the scan does not descend thousands of agent files.
# The previous filter compared against '*\.git\*' with Windows separators and
# therefore matched nothing on the Linux CI runner.
$scanRoots = Get-ChildItem -LiteralPath $repositoryRoot -Directory -Force |
  Where-Object { $_.Name -notin $unscannedDirectories }

$markdownFiles = @(Get-ChildItem -LiteralPath $repositoryRoot -Filter '*.md' -File -Force)
foreach ($scanRoot in $scanRoots) {
  $markdownFiles += Get-ChildItem -LiteralPath $scanRoot.FullName -Recurse -Filter '*.md' -File -Force |
    Where-Object {
      $rel = [System.IO.Path]::GetRelativePath($repositoryRoot, $_.FullName).Replace('\', '/')
      $rel -notmatch $unscannedPattern
    }
}

foreach ($markdownFile in $markdownFiles) {
  $relativePath = [System.IO.Path]::GetRelativePath($repositoryRoot, $markdownFile.FullName).Replace('\', '/')
  $isAllowed = $relativePath -eq 'README.md' -or
    $relativePath -in $allowedRootFiles -or
    $relativePath.StartsWith('frontend/.copilot/', [System.StringComparison]::OrdinalIgnoreCase) -or
    $relativePath.StartsWith('frontend/.github/templates/', [System.StringComparison]::OrdinalIgnoreCase) -or
    $relativePath.StartsWith('.github/ISSUE_TEMPLATE/', [System.StringComparison]::OrdinalIgnoreCase) -or
    $relativePath -eq '.github/pull_request_template.md'
  if (-not $isAllowed) {
    $errors.Add("Unexpected Markdown outside the Wiki: $relativePath")
  }
}

$readme = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'README.md')
foreach ($requiredText in @('/wiki', '/wiki/Implementation-TODO', 'Production deployment: not authorized')) {
  if (-not $readme.Contains($requiredText)) {
    $errors.Add("README is missing required current-state text: $requiredText")
  }
}

$planPath = Join-Path $repositoryRoot '.azure/infrastructure-plan.json'
if (-not (Test-Path -LiteralPath $planPath)) {
  $errors.Add('Missing machine-readable infrastructure plan.')
} else {
  $plan = Get-Content -Raw -LiteralPath $planPath | ConvertFrom-Json
  if ($plan.meta.status -ne 'approved') {
    $errors.Add('Infrastructure plan status must remain approved until superseded explicitly.')
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output 'Repository structure policy passed.'
