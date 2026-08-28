$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$errors = [System.Collections.Generic.List[string]]::new()

# `.agents`, `.claude`, `hooks` and `tooling` are the agent harness — agent
# definitions, skills, playbooks, the Claude Code lifecycle hooks and the local
# workflow state manager that drive tooling against this repository. They are
# deliberately source-controlled, but they are not the site and they are not
# human-facing project documentation, so the documentation policy below does
# not apply to them and they are excluded from the Markdown scan entirely.
#
# `.agentic` is that harness's per-run state and is gitignored, but the check
# below enumerates the live filesystem with -Force rather than the git index,
# so it must be allowlisted here or every local run reports it as unexpected.
$harnessDirectories = @('.agents', '.claude', 'hooks', 'tooling', '.agentic')

# .vscode is the Azure Functions dev loop — the tasks.json that runs
# `func host start` against functions/, and the launch.json that attaches the
# debugger to it. The Azure Functions extension generates them and expects
# them tracked, so they are source-controlled rather than gitignored. Note
# this check enumerates the live filesystem with -Force, not the git index:
# gitignoring .vscode would not have quieted it, only allowlisting does.
# node_modules is gitignored and never reaches a CI checkout, but a root-level
# `vitest` run leaves a .vite cache there and this check walks the live
# filesystem, not the git index. It is already pruned from the Markdown scan by
# $unscannedDirectories below; allowlisting it here keeps local runs from going
# red on a regenerable cache that CI will never see.
# `edge` holds Cloudflare Worker source (ADR 0024) — code that runs on the
# edge rather than in Azure, deployed by the owner with wrangler, unit-tested
# in CI. Its documentation lives in the Wiki (Availability-Probe) like every
# other component's; the directory carries only source, config and tests.
$allowedDirectories = @('.azure', '.github', '.vscode', 'edge', 'frontend', 'functions', 'infra', 'node_modules', 'scripts', 'vps-agent', 'wiki') + $harnessDirectories

# The engineering plan documents are companions to the approved architecture and
# are referenced from README.md and from each other; they stay at the root.
#
# CHANGELOG.md, REVIEW.md and TODO.md are the working documents mandated by the
# Code Review SOP (CODE_REVIEW_PROMPT.md v1.0, Phase 10). They are the
# machine-readable handoff surface an orchestrating agent reads between sessions
# — TODO.md in particular must exist even when empty, so that "no outstanding
# work" is a readable state rather than a missing file. They are deliberately
# exempt from the Wiki policy below: the Wiki holds human-facing narrative
# documentation, these hold review state.
#
# The former CHECKLIST.md and Variables.md were merged into REVIEW.md on
# 2026-08-20 and deleted. They had drifted into three documents describing one thing — the
# required-input inventory, the variable catalogue, and the blockers that depend
# on both — with the same facts recorded in each and disagreeing between them.
# REVIEW.md Part 4 is now the single inventory. Do not recreate either file;
# the split is what allowed a variable to be `Missing` in one and `Set` in
# another.
#
# REVIEW.md is upper-case per the SOP. It was `Review.md` until the SOP was
# adopted; the rename is intentional and the lower-case spelling must not come
# back.
$allowedRootFiles = @(
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'README.md',
  'Architecture_Plan.md',
  'Migration_Plan.md',
  'CHANGELOG.md',
  'REVIEW.md',
  'TODO.md'
)

# Guard the casing explicitly: on a case-insensitive filesystem (Windows,
# default macOS) `Review.md` and `REVIEW.md` collide, so a careless checkout or
# editor save can silently reintroduce the old name. The allowlist above is
# compared case-sensitively by -in on Linux CI but not on Windows, so this
# check is what actually holds the line for local runs.
$casingSensitiveNames = @('REVIEW.md', 'TODO.md', 'CHANGELOG.md')

# Directory names never walked by the Markdown scan, at any depth.
#
# .terraform holds vendored provider plugins, several of which ship their own
# CHANGELOG.md. It is gitignored, so CI never sees it — but this scan walks the
# filesystem, not the git index, so without this entry the gate fails for any
# developer who has run `terraform init`. Same for build and coverage output.
$unscannedDirectories = @('.git', 'node_modules', '.terraform', 'dist', 'coverage', '.reports') + $harnessDirectories
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
  # Reject a case variant of a SOP document (e.g. Review.md vs REVIEW.md).
  $casingMatch = $casingSensitiveNames |
    Where-Object { $_ -ieq $file -and $_ -cne $file }
  if ($casingMatch) {
    $errors.Add("Root file has wrong casing: found '$file', expected '$casingMatch'")
  }
}

# The SOP documents must exist. TODO.md is the one an orchestrating agent reads
# to decide whether there is outstanding work, so its absence is indistinguishable
# from "the file was never written" — require it even when it holds no items.
foreach ($requiredFile in @('README.md', 'CHANGELOG.md', 'REVIEW.md', 'TODO.md')) {
  if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $requiredFile))) {
    $errors.Add("Missing required SOP document: $requiredFile")
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
    $relativePath.StartsWith('.github/templates/', [System.StringComparison]::OrdinalIgnoreCase) -or
    $relativePath -eq '.github/pull_request_template.md' -or
    # Tooling-adjacent documentation, allowed by the same README clause that
    # keeps Markdown "next to that tooling": GitHub renders CONTRIBUTING and
    # SECURITY from .github/, and infra/README.md is the Terraform-standard
    # module doc for the deployment source of truth. Narrative documentation
    # still belongs in the Wiki.
    $relativePath -eq '.github/CONTRIBUTING.md' -or
    $relativePath -eq '.github/SECURITY.md' -or
    $relativePath -eq 'infra/README.md' -or
    # Wiki-as-code staging area: pages here ARE Wiki content, reviewed via PR
    # and overlaid onto the GitHub Wiki by .github/workflows/sync-wiki.yml on
    # merge to main. This is the one sanctioned in-repo home for narrative
    # documentation, precisely because its destination is the Wiki.
    $relativePath.StartsWith('wiki/', [System.StringComparison]::OrdinalIgnoreCase)
  if (-not $isAllowed) {
    $errors.Add("Unexpected Markdown outside the Wiki: $relativePath")
  }
}

$readme = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'README.md')
foreach ($requiredText in @('/wiki', 'Azure Static Web Apps', 'Azure Functions')) {
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
