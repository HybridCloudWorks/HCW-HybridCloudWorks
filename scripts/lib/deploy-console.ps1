#requires -Version 7.0
<#
  deploy-console.ps1 — shared console, prompting and Azure-discovery helpers
  for the three deployment scripts. Dot-source it:

      . (Join-Path $PSScriptRoot 'lib/deploy-console.ps1')

  WHY THESE SCRIPTS PROMPT RATHER THAN TAKE FLAGS

  Every value these scripts need is a GUID, and GUIDs passed as flags go wrong
  in three ways that all look like something else later:

    - they land in shell history, alongside the occasional token;
    - one transposed character produces an authentication failure that reads
      like a permissions problem;
    - the operator has to know which of four similar subscription IDs goes in
      which slot, from a terminal that cannot show them the list.

  So the model is: DISCOVER what Azure already knows, PICK from a numbered
  list when there is a genuine choice, PROMPT only for what cannot be found,
  then show everything resolved and ask for ONE confirmation before writing.

  Parameters remain on each script, but every one is optional. Supplying one
  skips its discovery step, which is what makes the scripts usable from CI
  without turning the interactive path into an afterthought.
#>

# Deliberately no Set-StrictMode here. Dot-sourcing runs in the CALLER's
# scope, so setting it would silently change the semantics of every script
# that loads this file — including making an empty `(... | ConvertFrom-Json).name`
# throw rather than yield nothing. A shared helper must not do that to its
# callers; scripts that want strict mode set it themselves.

# ---------------------------------------------------------------------------
# Output. Four shapes, so a long run stays scannable: what is fine, what
# changed, what the operator has to act on, and everything else.
# ---------------------------------------------------------------------------
function Write-Step { param($Message) Write-Host "`n=== $Message" -ForegroundColor Cyan }
function Write-Ok { param($Message) Write-Host "  [ok]     $Message" -ForegroundColor Green }
function Write-Act { param($Message) Write-Host "  [write]  $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "  $Message" -ForegroundColor DarkGray }
function Write-Warn { param($Message) Write-Host "  [warn]   $Message" -ForegroundColor Yellow }

function Stop-WithGuidance {
  param([string] $Problem, [string[]] $Fix)
  Write-Host "`n  [stop] $Problem" -ForegroundColor Red
  foreach ($line in $Fix) { Write-Host "         $line" -ForegroundColor Red }
  exit 1
}

# A prompt with no console reads EOF forever. Fail with the flag list instead
# of hanging, so a CI run says what it needed rather than timing out.
function Assert-Interactive {
  param([string] $Needed, [string[]] $NonInteractiveFix)
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) { return }
  Stop-WithGuidance "Cannot prompt for $Needed — this session has no interactive console." (
    @('Supply it as a parameter instead:') + $NonInteractiveFix
  )
}

# ---------------------------------------------------------------------------
# Prompting
# ---------------------------------------------------------------------------

# A numbered picker. Returns the chosen item from $Options (the objects, not
# the labels), or auto-returns when there is exactly one candidate and
# -AutoSelectSingle is set — the common case once the naming convention has
# narrowed four subscriptions to one.
function Select-Option {
  param(
    [Parameter(Mandatory)][string] $Title,
    [Parameter(Mandatory)][object[]] $Options,
    [Parameter(Mandatory)][scriptblock] $Label,
    [switch] $AutoSelectSingle,
    [string] $AutoSelectNote = 'only candidate'
  )

  if ($Options.Count -eq 0) { return $null }
  if ($Options.Count -eq 1 -and $AutoSelectSingle) {
    Write-Ok "$Title`: $(& $Label $Options[0])  ($AutoSelectNote)"
    return $Options[0]
  }

  Assert-Interactive -Needed $Title -NonInteractiveFix @('see the script help: Get-Help <script> -Full')

  Write-Host "`n  $Title" -ForegroundColor White
  for ($i = 0; $i -lt $Options.Count; $i++) {
    Write-Host ("    {0,2}. {1}" -f ($i + 1), (& $Label $Options[$i]))
  }

  while ($true) {
    $answer = Read-Host '  Number'
    if ($answer -match '^\d+$') {
      $index = [int]$answer - 1
      if ($index -ge 0 -and $index -lt $Options.Count) { return $Options[$index] }
    }
    Write-Host "  Enter a number between 1 and $($Options.Count)." -ForegroundColor Red
  }
}

# Multi-select over the same shape. Enter alone accepts the pre-selected set,
# which is how "all three deployment targets" stays a single keypress.
function Select-OptionSet {
  param(
    [Parameter(Mandatory)][string] $Title,
    [Parameter(Mandatory)][object[]] $Options,
    [Parameter(Mandatory)][scriptblock] $Label,
    [object[]] $Preselected = @()
  )

  # A preselection derived from the naming convention is a real answer, not a
  # guess, so a session with no console takes it rather than failing. An
  # operator with a console still gets to adjust it; callers put a final
  # confirmation after this either way.
  if ($Preselected.Count -gt 0 -and (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected)) {
    Write-Ok "$Title (no console — taking the $($Preselected.Count) matched by the naming convention):"
    foreach ($item in $Preselected) { Write-Info "  $(& $Label $item)" }
    return $Preselected
  }

  Assert-Interactive -Needed $Title -NonInteractiveFix @('see the script help: Get-Help <script> -Full')

  Write-Host "`n  $Title" -ForegroundColor White
  for ($i = 0; $i -lt $Options.Count; $i++) {
    $mark = if ($Options[$i] -in $Preselected) { '*' } else { ' ' }
    Write-Host ("   {0} {1,2}. {2}" -f $mark, ($i + 1), (& $Label $Options[$i]))
  }
  if ($Preselected.Count -gt 0) {
    Write-Info "* = preselected. Enter to accept, or type numbers separated by commas."
  } else {
    Write-Info 'Type numbers separated by commas.'
  }

  while ($true) {
    $answer = (Read-Host '  Numbers').Trim()
    if ($answer -eq '' -and $Preselected.Count -gt 0) { return $Preselected }
    $parts = $answer -split '[,\s]+' | Where-Object { $_ -ne '' }
    if ($parts.Count -gt 0 -and ($parts | ForEach-Object { $_ -match '^\d+$' }) -notcontains $false) {
      $chosen = @()
      $valid = $true
      foreach ($part in $parts) {
        $index = [int]$part - 1
        if ($index -lt 0 -or $index -ge $Options.Count) { $valid = $false; break }
        $chosen += $Options[$index]
      }
      if ($valid -and $chosen.Count -gt 0) { return ($chosen | Select-Object -Unique) }
    }
    Write-Host "  Enter numbers between 1 and $($Options.Count), separated by commas." -ForegroundColor Red
  }
}

# Free-text with an optional default and validation. The paste path, for the
# values nothing can discover.
function Read-Value {
  param(
    [Parameter(Mandatory)][string] $Prompt,
    [string] $Default,
    [scriptblock] $Validate,
    [string] $ValidationMessage = 'That value is not in the expected format.',
    [string[]] $Hint
  )

  Assert-Interactive -Needed $Prompt -NonInteractiveFix @('see the script help: Get-Help <script> -Full')

  foreach ($line in $Hint) { Write-Info $line }
  $suffix = if ($Default) { " [$Default]" } else { '' }

  while ($true) {
    $answer = (Read-Host "  $Prompt$suffix").Trim()
    if ($answer -eq '' -and $Default) { $answer = $Default }
    if ($answer -eq '') { Write-Host '  A value is required.' -ForegroundColor Red; continue }
    if (-not $Validate -or (& $Validate $answer)) { return $answer }
    Write-Host "  $ValidationMessage" -ForegroundColor Red
  }
}

function Read-SecretValue {
  param([Parameter(Mandatory)][string] $Prompt, [string[]] $Hint)
  Assert-Interactive -Needed $Prompt -NonInteractiveFix @('see the script help: Get-Help <script> -Full')
  foreach ($line in $Hint) { Write-Info $line }
  while ($true) {
    $secure = Read-Host "  $Prompt" -AsSecureString
    if ($secure.Length -gt 0) { return $secure }
    Write-Host '  A value is required.' -ForegroundColor Red
  }
}

# One confirmation covering everything resolved, rather than a prompt per
# value. This is the screen where a wrong subscription gets caught, so it
# prints what will be written and to where.
function Confirm-Plan {
  param(
    [Parameter(Mandatory)][string] $Title,
    # IDictionary, not hashtable: callers pass [ordered] so the rows read in a
    # deliberate order rather than alphabetically.
    [Parameter(Mandatory)][System.Collections.IDictionary] $Values,
    [string[]] $Order,
    [switch] $Force
  )

  Write-Step $Title
  $keys = if ($Order) { $Order } else { $Values.Keys | Sort-Object }
  $width = ($keys | Measure-Object -Property Length -Maximum).Maximum
  foreach ($key in $keys) {
    Write-Host ("    {0,-$width}  {1}" -f $key, $Values[$key]) -ForegroundColor White
  }

  if ($Force) { return $true }
  if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $true }

  $answer = (Read-Host "`n  Proceed? [Y/n]").Trim()
  return ($answer -eq '' -or $answer -match '^[Yy]')
}

function Test-Guid {
  param([string] $Value)
  return [guid]::TryParse($Value, [ref]([guid]::Empty))
}

# ---------------------------------------------------------------------------
# Azure
# ---------------------------------------------------------------------------

# az writes progress and warnings to stderr, which PowerShell 7 promotes to a
# terminating error under $ErrorActionPreference = 'Stop'. Judge success by
# exit code instead.
function Invoke-Az {
  param([Parameter(Mandatory)][string[]] $Arguments, [switch] $AllowFailure)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & az @Arguments 2>&1 } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) { return $null }
    throw "az $($Arguments -join ' ') failed:`n$output"
  }
  $text = ($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  try { return $text | ConvertFrom-Json } catch { return $text }
}

function Test-AzInstalled {
  if (Get-Command az -ErrorAction SilentlyContinue) { return $true }
  return $false
}

# Every subscription this sign-in can see, enabled only. Cached per session:
# the scripts ask for it repeatedly while resolving four different slots.
function Get-AzSubscriptionList {
  param([switch] $Refresh)
  if ($script:AzSubscriptionCache -and -not $Refresh) { return $script:AzSubscriptionCache }
  $all = Invoke-Az @('account', 'list', '--all', '-o', 'json') -AllowFailure
  if (-not $all) { return @() }
  $script:AzSubscriptionCache = @($all | Where-Object { $_.state -eq 'Enabled' } | Sort-Object name)
  return $script:AzSubscriptionCache
}

function Format-Subscription {
  param($Subscription)
  return "$($Subscription.name)  [$($Subscription.id)]"
}

# Resolve one subscription slot: filter by the naming convention, auto-select
# an unambiguous match, fall back to a picker over everything otherwise. The
# pattern is a hint, never a requirement — a tenant that has not adopted the
# convention still gets a working picker.
function Select-Subscription {
  param(
    [Parameter(Mandatory)][string] $Purpose,
    [string] $Pattern,
    [object[]] $Subscriptions
  )

  if (-not $Subscriptions) { $Subscriptions = Get-AzSubscriptionList }
  if ($Subscriptions.Count -eq 0) { return $null }

  $candidates = if ($Pattern) { @($Subscriptions | Where-Object { $_.name -like $Pattern }) } else { @() }
  if ($candidates.Count -eq 1) {
    return (Select-Option -Title $Purpose -Options $candidates -Label ${function:Format-Subscription} `
        -AutoSelectSingle -AutoSelectNote "matched $Pattern")
  }

  $options = if ($candidates.Count -gt 1) { $candidates } else { $Subscriptions }
  return (Select-Option -Title $Purpose -Options $options -Label ${function:Format-Subscription})
}
