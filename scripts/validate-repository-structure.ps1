$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$errors = [System.Collections.Generic.List[string]]::new()
$allowedDirectories = @('.azure', '.github', 'frontend', 'functions', 'infra', 'scripts', 'vps-agent')
$allowedRootFiles = @('.gitignore', 'README.md')

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

$markdownFiles = Get-ChildItem -LiteralPath $repositoryRoot -Recurse -Filter '*.md' -File -Force |
  Where-Object { $_.FullName -NotLike '*\.git\*' -and $_.FullName -NotLike '*\node_modules\*' }
foreach ($markdownFile in $markdownFiles) {
  $relativePath = [System.IO.Path]::GetRelativePath($repositoryRoot, $markdownFile.FullName).Replace('\', '/')
  $isAllowed = $relativePath -eq 'README.md' -or
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
