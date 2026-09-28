#Requires -Version 7.2
<#
.SYNOPSIS
    Azure Arc onboarding of the lab host in two runs: the first prepares the
    onboarding identity and says what to set in hcw-azure; the second, with
    -Connect, connects the host and removes the credential.

.DESCRIPTION
    Run it as the owner, from a desktop that reaches the lab host as hcw-lab
    (scripts/lab/Connect-Lab.ps1), with az signed in to the tenant. The
    procedure around it is docs/runbooks/labs-host.md, "Arc onboarding".

    Without -Connect it:

      1. checks that az is signed in to -TenantDomain, and stops with the
         az login line when it is not;
      2. resolves the -SubscriptionName subscription by name (never a
         committed id) and checks that rg-lab-hybrid-prod-cus exists there;
      3. reads the host over ssh: whether azcmagent is installed and
         Connected, whether the arc fact is set, whether the vault helper
         /usr/local/sbin/hcw-vault-set is there, and which of the four
         vault_arc_* keys the vault holds (names only; the identifiers are
         GUIDs and are compared, the secret is never read back);
      4. finds or creates the single-tenant app registration and service
         principal -DisplayName, with no role and no credential;
      5. grants the Terraform run identity (id-plat-terraform-prod-cus-01)
         Resource Policy Contributor on the resource group, unless the audit
         policy assignment already exists or the grant is already there. The
         run identity cannot write a policy assignment without it, and
         Terraform does not grant itself rights (infra/lab-hybrid.tf);
      6. unless the host is already Connected, puts a live onboarding secret
         in the vault: a client secret valid for -SecretLifetimeHours, added
         with az ad app credential reset --append, captured in a variable,
         piped over ssh into hcw-vault-set as vault_arc_service_principal_secret
         and cleared, with the application, tenant and subscription ids beside
         it. A secret this script already put there is reused while it has an
         hour left; anything else on the registration is deleted first. When
         the vault write fails, the new secret is deleted from Entra again;
      7. checks whether hcw-azure has applied the onboarding grant (Azure
         Connected Machine Onboarding on the group, which is Terraform's,
         azurerm_role_assignment.arc_onboarding) and the audit policy
         assignment. For each that is missing it prints the workspace
         variable to set, the address to set it at, and the plan to expect.

    With -Connect it:

      1. repeats steps 1 to 3 and finds the service principal (it stops if
         there is none: run without -Connect first);
      2. checks, read only, that the onboarding grant exists, and stops with
         the workspace variables when it does not;
      3. when the host is not Connected: stops if a machine resource of the
         same name is left from a previous host, puts a live secret in the
         vault as in step 6 above, writes the arc fact
         /etc/ansible/facts.d/hcw_arc.fact ({"enabled": true}; arc_enabled in
         lab-host/ansible/group_vars/all.yml reads it), runs bootstrap.sh and
         waits for azcmagent to report Connected. If it does not connect, the
         fact this run wrote is removed again so later bootstrap.sh runs are
         not stopped by the arc role;
      4. once Connected, deletes every client secret on the registration and
         the four vault_arc_* keys from the vault, and checks both are gone.
         The credential does not outlive onboarding;
      5. installs the Azure Monitor Agent extension and associates the data
         collection rule dcr-lab-hybrid-prod-cus with the machine, unless
         each is already there (az rest, so no CLI extension is needed), and
         prints the read-backs.

    Every step is idempotent: a second run of either form changes nothing
    and says so. Under -WhatIf nothing changes: Entra, Azure and the host are
    read, each change is reported as what it would do, the vault removal
    runs in check mode on the host, and bootstrap.sh does not run.

    The secret is never printed, written to a file on the desktop, or put on
    a command line: az returns it on standard output into a variable, and it
    reaches the host on ssh's standard input.

.PARAMETER TenantDomain
    The Entra tenant az must be signed in to.

.PARAMETER DisplayName
    The onboarding app registration and service principal
    (docs/runbooks/labs-host.md, "What each side owns").

.PARAMETER SubscriptionName
    The application subscription the machine is onboarded into, resolved to
    its id with az account list.

.PARAMETER HostAlias
    The ssh name of the lab host, as scripts/lab/Connect-Lab.ps1 writes it.

.PARAMETER SecretLifetimeHours
    How long a new onboarding secret is valid. It only has to last until the
    -Connect run, which deletes it.

.PARAMETER Connect
    The second run: connect the host and remove the credential.

.EXAMPLE
    ./scripts/lab/Register-LabArc.ps1

.EXAMPLE
    ./scripts/lab/Register-LabArc.ps1 -Connect

.EXAMPLE
    ./scripts/lab/Register-LabArc.ps1 -Connect -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidatePattern('\A[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\z')]
    [string] $TenantDomain = 'saulpatinojrhotmail.onmicrosoft.com',

    [ValidatePattern('\A[A-Za-z0-9][A-Za-z0-9-]{0,118}[A-Za-z0-9]\z')]
    [string] $DisplayName = 'sp-arc-onboarding-lab-hybrid-prod-cus',

    [ValidatePattern('\A[A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9]\z')]
    [string] $SubscriptionName = 'sub-app-site-prod-cus',

    [ValidatePattern('\A[A-Za-z0-9][A-Za-z0-9.-]{0,62}\z')]
    [string] $HostAlias = 'hcw-lab',

    [ValidateRange(1, 72)]
    [int] $SecretLifetimeHours = 24,

    [switch] $Connect
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Native exit codes are read explicitly below: az and ssh report failure by
# exit code.
$PSNativeCommandUseErrorActionPreference = $false

# -----------------------------------------------------------------------------
# Functions. Everything above the "Main" line is a definition only, so the
# Pester tests can load these from the file's syntax tree without running the
# script: no az call, no ssh, nothing on the host.
# -----------------------------------------------------------------------------

function Get-LabArcTarget {
    <#
    .SYNOPSIS
        The names and paths this script works on, in one place. Each matches
        its source: infra/lab-hybrid.tf and infra/variables.tf for the Azure
        side, lab-host/ansible/group_vars/all.yml for the machine, and the
        host's own layout for the paths.
    #>
    [OutputType([pscustomobject])]
    param()

    return [pscustomobject]@{
        ResourceGroup        = 'rg-lab-hybrid-prod-cus'
        MachineName          = 'arcs-lab-hybrid-prod-cus-01'
        Location             = 'centralus'
        RuleName             = 'dcr-lab-hybrid-prod-cus'
        AssociationName      = 'dcra-lab-hybrid-prod-cus'
        ExtensionName        = 'AzureMonitorLinuxAgent'
        PolicyAssignmentName = 'audit-linux-baseline-lab-hybrid'
        OnboardingRole       = 'Azure Connected Machine Onboarding'
        OnboardingRoleId     = 'b64e21ea-ac4e-4cdf-9dc9-5b892992bee7'
        PolicyWriterRole     = 'Resource Policy Contributor'
        TerraformIdentity    = 'id-plat-terraform-prod-cus-01'
        WorkspaceUrl         = 'https://app.terraform.io/app/hcw/workspaces/hcw-azure'
        VariablesUrl         = 'https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables'
        HybridComputeApi     = '2025-01-13'
        MonitorApi           = '2022-06-01'
        Agent                = '/opt/azcmagent/bin/azcmagent'
        Helper               = '/usr/local/sbin/hcw-vault-set'
        Fact                 = '/etc/ansible/facts.d/hcw_arc.fact'
        Bootstrap            = '/opt/hcw-src/lab-host/bootstrap.sh'
        VaultDirectory       = '/etc/hcw/ansible'
        AnsibleVault         = '/usr/local/bin/ansible-vault'
    }
}

function Get-LabArcVaultKeys {
    <#
    .SYNOPSIS
        The four vault keys the arc role reads (lab-host/ansible/roles/arc),
        in the order they are written.
    #>
    [OutputType([string[]])]
    param()

    return [string[]]@(
        'vault_arc_tenant_id',
        'vault_arc_subscription_id',
        'vault_arc_service_principal_id',
        'vault_arc_service_principal_secret'
    )
}

function Test-LabGuid {
    <#
    .SYNOPSIS
        True for a GUID in its 8-4-4-4-12 form, and nothing else. \A and \z,
        because $ also matches before a trailing newline.
    #>
    [OutputType([bool])]
    param([AllowEmptyString()] [string] $Value)

    return $Value -match '\A[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\z'
}

function Get-LabTenantIdFromIssuer {
    <#
    .SYNOPSIS
        The tenant id in a v2 OpenID issuer
        (https://login.microsoftonline.com/<tenant id>/v2.0), or $null.
    #>
    [OutputType([string])]
    param([AllowEmptyString()] [string] $Issuer)

    if ($Issuer -match '\Ahttps://login\.microsoftonline\.com/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/v2\.0/?\z') {
        return $Matches[1].ToLowerInvariant()
    }
    return $null
}

function Get-LabProperty {
    <#
    .SYNOPSIS
        A property of an object parsed from az's JSON, or $null when the
        object or the property is absent. Strict mode throws on a missing
        property, and az omits some keys rather than writing null.
    #>
    param(
        [AllowNull()] $Object,
        [Parameter(Mandatory)] [string] $Name
    )

    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function ConvertTo-LabArcUtc {
    <#
    .SYNOPSIS
        A credential's endDateTime as a UTC DateTime, or $null. ConvertFrom-Json
        turns an ISO 8601 string into a DateTime by itself, so both forms are
        read.
    #>
    [OutputType([datetime])]
    param([AllowNull()] $Value)

    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [datetimeoffset]) {
        return $Value.UtcDateTime
    }
    if ($Value -is [datetime]) {
        if ($Value.Kind -eq [System.DateTimeKind]::Local) {
            return $Value.ToUniversalTime()
        }
        return [datetime]::SpecifyKind($Value, [System.DateTimeKind]::Utc)
    }
    $parsed = [datetimeoffset]::MinValue
    $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal
    if ([datetimeoffset]::TryParse([string]$Value, [cultureinfo]::InvariantCulture, $styles, [ref] $parsed)) {
        return $parsed.UtcDateTime
    }
    return $null
}

function Get-LabArcSecretEndDate {
    <#
    .SYNOPSIS
        --end-date for a new onboarding secret: Hours from now, in UTC, in
        the form az documents ('2020-12-31T11:59:59+00:00').
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [datetime] $NowUtc,
        [Parameter(Mandatory)] [int] $Hours
    )

    $utc = if ($NowUtc.Kind -eq [System.DateTimeKind]::Local) { $NowUtc.ToUniversalTime() } else { [datetime]::SpecifyKind($NowUtc, [System.DateTimeKind]::Utc) }
    return $utc.AddHours($Hours).ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'", [cultureinfo]::InvariantCulture)
}

function Get-LabArcSecretResetArguments {
    <#
    .SYNOPSIS
        The az arguments that add one client secret to the registration and
        print only its value.

    .DESCRIPTION
        --append is the load-bearing flag: without it az ad app credential
        reset deletes every existing password and certificate on the
        registration first. --end-date alone sets the expiry; --years is left
        out, because it is the coarser form of the same setting. --query
        password -o tsv makes the value the only thing on standard output, so
        nothing else in the response has to be parsed around it.
    #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)] [string] $AppId,
        [Parameter(Mandatory)] [string] $EndDate,
        [Parameter(Mandatory)] [string] $KeyDisplayName
    )

    return [string[]]@(
        'ad', 'app', 'credential', 'reset',
        '--id', $AppId,
        '--append',
        '--display-name', $KeyDisplayName,
        '--end-date', $EndDate,
        '--query', 'password',
        '-o', 'tsv',
        '--only-show-errors'
    )
}

function Test-LabArcSecretShape {
    <#
    .SYNOPSIS
        True when Value looks like a client secret: printable ASCII, no
        whitespace, 16 to 256 characters. A value that is not is never
        written to the vault, and never shown.
    #>
    [OutputType([bool])]
    param([AllowNull()] [AllowEmptyString()] [string] $Value)

    return $null -ne $Value -and $Value -cmatch '\A[\x21-\x7E]{16,256}\z'
}

function Test-LabArcHint {
    <#
    .SYNOPSIS
        True for a password credential's hint, the first characters of the
        secret Entra shows in the portal, when it is safe to hand to the host
        script inside single quotes.
    #>
    [OutputType([bool])]
    param([AllowNull()] [AllowEmptyString()] [string] $Value)

    return $null -ne $Value -and $Value -cmatch '\A[A-Za-z0-9~._-]{1,3}\z'
}

function Get-LabArcSecretPlan {
    <#
    .SYNOPSIS
        Whether the vault already holds a live onboarding secret this
        registration knows, or a new one has to be minted.

    .DESCRIPTION
        Reuse needs all of these: exactly one client secret on the
        registration with at least MinimumRemainingMinutes left; an expiry no
        later than LifetimeHours from now (a longer one was not made by this
        script, and a long-lived onboarding secret is what this replaces);
        the vault's application, tenant and subscription ids equal to the
        ones given; and the vault's secret starting with that credential's
        hint, which the host checks without printing either. Anything else
        mints, and every existing secret on the registration is listed for
        deletion first, because a secret nobody can match to the vault is
        one nobody will remember to delete.
    #>
    [OutputType([pscustomobject])]
    param(
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Registered,
        [Parameter(Mandatory)] [pscustomobject] $HostState,
        [Parameter(Mandatory)] [string] $AppId,
        [Parameter(Mandatory)] [string] $TenantId,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [datetime] $NowUtc,
        [Parameter(Mandatory)] [int] $LifetimeHours,
        [int] $MinimumRemainingMinutes = 60
    )

    $all = [object[]]@(@($Registered) | Where-Object { $null -ne $_ })
    $threshold = $NowUtc.AddMinutes($MinimumRemainingMinutes)
    $live = [object[]]@($all | Where-Object {
            $end = ConvertTo-LabArcUtc -Value (Get-LabProperty -Object $_ -Name 'endDateTime')
            $null -ne $end -and $end -gt $threshold
        })
    $mint = {
        param([string] $Reason)
        [pscustomobject]@{ Action = 'Mint'; Reason = $Reason; Remove = $all; Keep = $null }
    }

    if ($live.Count -eq 0) {
        if ($all.Count -eq 0) {
            return (& $mint 'the registration has no client secret yet')
        }
        return (& $mint "the registration's $($all.Count) client secret(s) expire within $MinimumRemainingMinutes minutes or already have")
    }
    if ($live.Count -gt 1) {
        return (& $mint "the registration has $($live.Count) live client secrets, so which one the vault holds cannot be told")
    }
    $credential = $live[0]
    $end = ConvertTo-LabArcUtc -Value (Get-LabProperty -Object $credential -Name 'endDateTime')
    if ($end -gt $NowUtc.AddHours($LifetimeHours).AddMinutes(10)) {
        return (& $mint "its client secret lasts until $($end.ToString('yyyy-MM-dd HH:mm')) UTC, longer than $LifetimeHours hours, so this script did not make it")
    }

    $expected = [ordered]@{
        vault_arc_service_principal_id = $AppId.ToLowerInvariant()
        vault_arc_tenant_id            = $TenantId.ToLowerInvariant()
        vault_arc_subscription_id      = $SubscriptionId.ToLowerInvariant()
    }
    foreach ($key in $expected.Keys) {
        $entry = $HostState.VaultKeys[$key]
        if ($null -eq $entry -or $entry.State -ne 'set') {
            $state = if ($null -eq $entry) { 'unknown' } else { $entry.State }
            return (& $mint "the vault's $key is $state")
        }
        if ($entry.Detail -ne $expected[$key]) {
            return (& $mint "the vault's $key is not this onboarding's")
        }
    }
    $secret = $HostState.VaultKeys['vault_arc_service_principal_secret']
    if ($null -eq $secret -or $secret.State -ne 'set') {
        $state = if ($null -eq $secret) { 'unknown' } else { $secret.State }
        return (& $mint "the vault's vault_arc_service_principal_secret is $state")
    }
    if ($secret.Detail -ne 'hint-match') {
        return (& $mint "the vault's secret is not the registration's live one")
    }
    $keep = [string](Get-LabProperty -Object $credential -Name 'keyId')
    $remove = [object[]]@($all | Where-Object { [string](Get-LabProperty -Object $_ -Name 'keyId') -ne $keep })
    return [pscustomobject]@{
        Action = 'Reuse'
        Reason = "the vault holds the registration's live client secret, valid until $($end.ToString('yyyy-MM-dd HH:mm')) UTC"
        Remove = $remove
        Keep   = $credential
    }
}

function Get-LabArcCandidateHint {
    <#
    .SYNOPSIS
        The hint of the one live client secret on the registration, which the
        host compares with the vault's secret; empty when there is not
        exactly one, or its hint is not a plain one.
    #>
    [OutputType([string])]
    param(
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Registered,
        [Parameter(Mandatory)] [datetime] $NowUtc,
        [int] $MinimumRemainingMinutes = 60
    )

    $threshold = $NowUtc.AddMinutes($MinimumRemainingMinutes)
    $live = @(@($Registered) | Where-Object {
            $end = if ($null -eq $_) { $null } else { ConvertTo-LabArcUtc -Value (Get-LabProperty -Object $_ -Name 'endDateTime') }
            $null -ne $end -and $end -gt $threshold
        })
    if ($live.Count -ne 1) {
        return ''
    }
    $hint = [string](Get-LabProperty -Object $live[0] -Name 'hint')
    if (Test-LabArcHint -Value $hint) {
        return $hint
    }
    return ''
}

function Assert-LabShellValue {
    <#
    .SYNOPSIS
        Throws unless Value can sit between single quotes in bash and mean
        itself: no quote, backslash, dollar, backtick, space or newline.
    #>
    param(
        [Parameter(Mandatory)] [string] $Name,
        [AllowEmptyString()] [string] $Value
    )

    if ($Value -notmatch '\A[A-Za-z0-9._:/@%+=,-]*\z') {
        throw "$Name holds a character that is not safe in the host script: '$Value'."
    }
}

function Get-LabArcRemoteCommand {
    <#
    .SYNOPSIS
        One ssh command line that runs BashScript as root on the host.

    .DESCRIPTION
        The script travels as base64, so the command line holds only
        [A-Za-z0-9+/=], which neither PowerShell's argument passing, ssh, nor
        the remote login shell can reinterpret. sudo -n, because a sudo that
        would prompt must fail rather than wait for a password nobody will
        type. bash reads the script from the pipe, so every command inside
        that could read standard input is given /dev/null instead.
    #>
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $BashScript)

    $normalized = $BashScript -replace "`r`n", "`n"
    $encoded = [Convert]::ToBase64String([System.Text.UTF8Encoding]::new($false).GetBytes($normalized))
    return "echo $encoded | base64 -d | sudo -n bash -s"
}

function Get-LabArcHostScript {
    <#
    .SYNOPSIS
        The bash, run as root on the host, that reports the host's Arc state
        or removes the four vault_arc_* keys from the Ansible vault.

    .DESCRIPTION
        Mode report prints, and never anything else:

          HCW AGENT <status> <resource name> <resource group> <agent version>
          HCW HELPER yes|no            /usr/local/sbin/hcw-vault-set is there
          HCW BOOTSTRAP yes|no         /opt/hcw-src/lab-host/bootstrap.sh is there
          HCW FACT enabled|disabled|absent|invalid
          HCW KEY <key> <state> <detail>   state set, empty or absent
          HCW VAULT present|missing|<reason it could not be read>

        For the three identifier keys the detail is the GUID, lower-cased, or
        not-a-guid; they are identifiers, not secrets. For the secret it is
        hint-match or hint-mismatch when Hint is given (whether the secret
        starts with it), and - otherwise: the secret itself is never printed
        or compared outside the host.

        Modes check and remove print one line,

          HCW REMOVE <removed|would-remove|unchanged> removed=<keys> absent=<keys>

        and remove decrypts the vault into a root-only temporary directory
        (tmpfs when /dev/shm is there), drops the four keys and any indented
        continuation lines, refuses the result unless the four are gone and
        every other key equals what it was, encrypts with the existing
        password file, decrypts that again and compares, and only then
        replaces vault.yml, by rename. Check mode writes nothing. The
        temporary files are shredded on every exit. A failure prints
        HCW ERROR <code> <message> and exits 3.

        Python for the vault is the ansible-core environment's own, found
        beside ansible-vault, because it has PyYAML; -Python overrides it for
        tests. The agent's JSON is read with the system python3.
    #>
    [OutputType([string])]
    param(
        [ValidateSet('report', 'check', 'remove')] [string] $Mode = 'report',
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [AllowEmptyString()] [string] $Hint = '',
        [AllowEmptyString()] [string] $Python = ''
    )

    foreach ($name in 'VaultDirectory', 'AnsibleVault', 'Agent', 'Helper', 'Fact', 'Bootstrap') {
        Assert-LabShellValue -Name $name -Value ([string]$Target.$name)
    }
    Assert-LabShellValue -Name 'Python' -Value $Python
    if ($Hint -and -not (Test-LabArcHint -Value $Hint)) {
        throw 'The hint is not safe in the host script.'
    }

    $template = @'
set -uo pipefail
umask 077
cd /
mode='@@HCW_MODE@@'
dir='@@HCW_VAULT_DIR@@'
av='@@HCW_ANSIBLE_VAULT@@'
py='@@HCW_PYTHON@@'
agent='@@HCW_AGENT@@'
helper='@@HCW_HELPER@@'
fact='@@HCW_FACT@@'
bootstrap='@@HCW_BOOTSTRAP@@'
hint='@@HCW_HINT@@'
vault="$dir/vault.yml"
password="$dir/vault-password"
all_keys='vault_arc_service_principal_id,vault_arc_service_principal_secret,vault_arc_tenant_id,vault_arc_subscription_id'
say() { printf 'HCW %s\n' "$*"; }
fail() { say "ERROR $1 $2"; exit 3; }
stop() {
  if [ "$mode" = report ]; then say "VAULT $1"; exit 0; fi
  fail "$1" "$2"
}

if [ "$mode" = report ]; then
  if [ -x "$agent" ]; then
    shown="$("$agent" show --json < /dev/null 2> /dev/null | python3 -c '
import json
import sys
try:
    data = json.load(sys.stdin)
except ValueError:
    data = {}
if not isinstance(data, dict):
    data = {}
def field(key):
    value = data.get(key)
    text = str(value) if value not in (None, "") else "-"
    return "".join(c if c.isalnum() or c in "-._" else "_" for c in text)
print(" ".join(field(k) for k in ("status", "resourceName", "resourceGroup", "agentVersion")))
' 2> /dev/null)" || shown=''
    say "AGENT ${shown:-Unknown - - -}"
  else
    say 'AGENT NotInstalled - - -'
  fi
  if [ -x "$helper" ]; then say 'HELPER yes'; else say 'HELPER no'; fi
  if [ -f "$bootstrap" ]; then say 'BOOTSTRAP yes'; else say 'BOOTSTRAP no'; fi
  if [ -f "$fact" ]; then
    state="$(python3 -c '
import json
import sys
try:
    with open(sys.argv[1]) as handle:
        data = json.load(handle)
except (OSError, ValueError):
    print("invalid")
    sys.exit(0)
print("enabled" if isinstance(data, dict) and data.get("enabled") is True else "disabled")
' "$fact" < /dev/null 2> /dev/null)" || state=''
    say "FACT ${state:-invalid}"
  else
    say 'FACT absent'
  fi
fi

if [ ! -f "$vault" ]; then
  if [ "$mode" = report ]; then say 'VAULT missing'; else say "REMOVE unchanged removed= absent=$all_keys"; fi
  exit 0
fi
[ -f "$password" ] || stop no-password "$password does not exist, so $vault cannot be read; nothing was changed"
[ -x "$av" ] || stop no-ansible-vault "$av is missing; bootstrap.sh installs it (lab-host/README.md, First run)"
if [ -z "$py" ]; then
  py="$(dirname "$(readlink -f "$av")")/python"
fi
command -v "$py" > /dev/null 2>&1 || stop no-python "$py is missing; it is the ansible-core environment's interpreter, which bootstrap.sh installs"
"$py" -c 'import yaml' < /dev/null > /dev/null 2>&1 || stop no-yaml "$py cannot import yaml"

work="$(mktemp -d /dev/shm/hcw-arc.XXXXXX 2> /dev/null || mktemp -d)"
cleanup() {
  find "$work" -type f -exec shred -u {} + 2> /dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

"$av" decrypt --vault-password-file "$password" --output "$work/current.yml" "$vault" < /dev/null > "$work/vault.log" 2>&1 \
  || stop undecryptable "ansible-vault could not decrypt $vault with $password; nothing was changed"

cat > "$work/arc.py" <<'PY'
import os
import re
import sys

import yaml

KEYS = (
    'vault_arc_service_principal_id',
    'vault_arc_service_principal_secret',
    'vault_arc_tenant_id',
    'vault_arc_subscription_id',
)
SECRET = 'vault_arc_service_principal_secret'
GUID = re.compile(r'\A[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\Z')


class Loader(yaml.SafeLoader):
    pass


def tagged(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return ('!' + suffix, loader.construct_scalar(node))
    if isinstance(node, yaml.SequenceNode):
        return ('!' + suffix, repr(loader.construct_sequence(node, deep=True)))
    return ('!' + suffix, repr(loader.construct_mapping(node, deep=True)))


Loader.add_multi_constructor('!', tagged)


def fail(code, message):
    print('HCW ERROR %s %s' % (code, message))
    sys.exit(3)


def load(text, what):
    try:
        data = yaml.load(text, Loader=Loader) if text.strip() else {}
    except yaml.YAMLError:
        fail('not-yaml', '%s does not parse as YAML; nothing was changed' % what)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        fail('not-a-mapping', '%s is not a mapping of keys; nothing was changed' % what)
    return data


def describe(data, key):
    if key not in data:
        return 'absent', '-'
    value = data[key]
    if value is None or (isinstance(value, str) and not value.strip()):
        return 'empty', '-'
    if key == SECRET:
        hint = os.environ.get('HCW_HINT', '')
        if not hint:
            return 'set', '-'
        same = isinstance(value, str) and value.startswith(hint)
        return 'set', 'hint-match' if same else 'hint-mismatch'
    text = str(value)
    return 'set', text.lower() if GUID.match(text) else 'not-a-guid'


def main(mode, source, target):
    with open(source, 'rb') as handle:
        raw = handle.read()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        fail('not-utf8', 'the vault is not UTF-8 text; nothing was changed')
    before = load(text, 'the vault')
    if mode == 'report':
        for key in KEYS:
            state, detail = describe(before, key)
            print('HCW KEY %s %s %s' % (key, state, detail))
        return
    present = [key for key in KEYS if key in before]
    absent = [key for key in KEYS if key not in before]
    if not present:
        print('HCW REMOVE unchanged removed= absent=%s' % ','.join(absent))
        return
    owned = re.compile(r'^(?:%s)\s*:' % '|'.join(KEYS))
    kept = []
    dropping = False
    for line in text.splitlines(keepends=True):
        bare = line.rstrip('\r\n')
        if owned.match(bare):
            dropping = True
            continue
        if dropping and bare[:1] in (' ', '\t'):
            continue
        dropping = False
        kept.append(line)
    result = ''.join(kept)
    if result and not result.endswith('\n'):
        result += '\n'
    after = load(result, 'the vault without the Arc keys')
    if not after:
        # bootstrap.sh passes the vault with -e @vault.yml, and ansible
        # refuses an extra-vars file that is not a mapping.
        result += '{}\n'
        after = load(result, 'the vault without the Arc keys')
    for key in KEYS:
        if key in after:
            fail('verify', 'the vault would still hold %s after the rewrite; nothing was changed' % key)
    kept_before = {key: value for key, value in before.items() if key not in KEYS}
    if kept_before != after:
        fail('verify', 'the rewrite would change a key this script does not own; nothing was changed')
    with open(target, 'wb') as handle:
        handle.write(result.encode('utf-8'))
    state = 'would-remove' if mode == 'check' else 'removed'
    print('HCW REMOVE %s removed=%s absent=%s' % (state, ','.join(present), ','.join(absent)))


main(sys.argv[1], sys.argv[2], sys.argv[3])
PY

if ! HCW_HINT="$hint" "$py" "$work/arc.py" "$mode" "$work/current.yml" "$work/next.yml" < /dev/null > "$work/arc.out" 2> "$work/arc.err"; then
  if [ "$mode" = report ]; then
    code="$(grep '^HCW ERROR ' "$work/arc.out" | head -n 1 | cut -d ' ' -f 3)" || code=''
    say "VAULT ${code:-unreadable}"
    exit 0
  fi
  grep '^HCW ERROR ' "$work/arc.out" || say 'ERROR vault the vault step stopped unexpectedly; nothing was changed'
  exit 3
fi

if [ "$mode" = report ]; then
  grep '^HCW KEY ' "$work/arc.out" || true
  say 'VAULT present'
  exit 0
fi

line="$(grep '^HCW REMOVE ' "$work/arc.out" | tail -n 1)" || line=''
[ -n "$line" ] || fail vault 'the vault step printed no result; nothing was changed'
state="$(printf '%s' "$line" | cut -d ' ' -f 3)"
if [ "$state" = removed ]; then
  "$av" encrypt --vault-password-file "$password" --output "$work/next.enc" "$work/next.yml" < /dev/null > "$work/vault.log" 2>&1 \
    || fail encrypt 'ansible-vault could not encrypt the rewritten vault; nothing was changed'
  "$av" decrypt --vault-password-file "$password" --output "$work/check.yml" "$work/next.enc" < /dev/null > "$work/vault.log" 2>&1 \
    || fail verify 'the re-encrypted vault does not decrypt; nothing was changed'
  cmp -s "$work/check.yml" "$work/next.yml" || fail verify 'the re-encrypted vault does not decrypt to the rewrite; nothing was changed'
  install -m 0600 "$work/next.enc" "$dir/.vault.yml.next" || fail write "could not write $dir/.vault.yml.next; nothing was changed"
  mv -f "$dir/.vault.yml.next" "$vault" || fail write "could not replace $vault; nothing was changed"
fi
printf '%s\n' "$line"
'@
    $tokens = [ordered]@{
        '@@HCW_MODE@@'          = $Mode
        '@@HCW_VAULT_DIR@@'     = [string]$Target.VaultDirectory
        '@@HCW_ANSIBLE_VAULT@@' = [string]$Target.AnsibleVault
        '@@HCW_PYTHON@@'        = $Python
        '@@HCW_AGENT@@'         = [string]$Target.Agent
        '@@HCW_HELPER@@'        = [string]$Target.Helper
        '@@HCW_FACT@@'          = [string]$Target.Fact
        '@@HCW_BOOTSTRAP@@'     = [string]$Target.Bootstrap
        '@@HCW_HINT@@'          = $Hint
    }
    $text = $template
    foreach ($token in $tokens.Keys) {
        $text = $text.Replace([string]$token, [string]$tokens[$token])
    }
    $text = $text -replace "`r`n", "`n"
    if ($text.Contains('@@HCW_')) {
        throw 'A placeholder in the host script was not filled in.'
    }
    return $text
}

function Get-LabArcFactScript {
    <#
    .SYNOPSIS
        The bash, run as root on the host, that writes or removes the arc
        fact, printing HCW FACT written, removed or unchanged.

    .DESCRIPTION
        arc_enabled in lab-host/ansible/group_vars/all.yml is true exactly
        when this file is JSON whose "enabled" is true. Ansible reads every
        *.fact file under /etc/ansible/facts.d when it gathers facts, and
        runs one that is executable, so the file is written 0644. It is
        replaced by rename, so a run that reads it never sees half a file.
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [ValidateSet('enabled', 'absent')] [string] $State = 'enabled'
    )

    Assert-LabShellValue -Name 'Fact' -Value ([string]$Target.Fact)
    $template = @'
set -euo pipefail
umask 022
fact='@@HCW_FACT@@'
want='@@HCW_STATE@@'
content='{"enabled": true, "set_by": "scripts/lab/Register-LabArc.ps1"}'
say() { printf 'HCW %s\n' "$*"; }
if [ "$want" = enabled ]; then
  if [ -f "$fact" ] && [ "$(cat -- "$fact" < /dev/null)" = "$content" ]; then
    say 'FACT unchanged'
    exit 0
  fi
  mkdir -p -- "$(dirname -- "$fact")"
  printf '%s\n' "$content" > "$fact.next"
  chmod 0644 -- "$fact.next"
  mv -f -- "$fact.next" "$fact"
  say 'FACT written'
elif [ -e "$fact" ]; then
  rm -f -- "$fact"
  say 'FACT removed'
else
  say 'FACT unchanged'
fi
'@
    $text = $template.Replace('@@HCW_FACT@@', [string]$Target.Fact).Replace('@@HCW_STATE@@', $State)
    return ($text -replace "`r`n", "`n")
}

function ConvertFrom-LabArcHostState {
    <#
    .SYNOPSIS
        Reads the HCW lines the report script printed into one object.
    #>
    [OutputType([pscustomobject])]
    param([AllowEmptyCollection()] [AllowNull()] [string[]] $Lines)

    $keys = [ordered]@{}
    foreach ($key in Get-LabArcVaultKeys) {
        $keys[$key] = [pscustomobject]@{ State = 'unknown'; Detail = '-' }
    }
    $result = [ordered]@{
        AgentStatus   = 'Unknown'
        ResourceName  = $null
        ResourceGroup = $null
        AgentVersion  = $null
        Helper        = $false
        Bootstrap     = $false
        Fact          = 'unknown'
        Vault         = 'unknown'
        ErrorCode     = $null
        ErrorMessage  = $null
    }
    $undash = { param([string] $Value) if ($Value -and $Value -ne '-') { $Value } else { $null } }
    foreach ($line in @($Lines)) {
        if ($null -eq $line) {
            continue
        }
        if ($line -match '\AHCW AGENT (\S+) (\S+) (\S+) (\S+)\s*\z') {
            $result.AgentStatus = if ($Matches[1] -eq '-') { 'Unknown' } else { $Matches[1] }
            $result.ResourceName = & $undash $Matches[2]
            $result.ResourceGroup = & $undash $Matches[3]
            $result.AgentVersion = & $undash $Matches[4]
        }
        elseif ($line -match '\AHCW HELPER (yes|no)\s*\z') {
            $result.Helper = $Matches[1] -eq 'yes'
        }
        elseif ($line -match '\AHCW BOOTSTRAP (yes|no)\s*\z') {
            $result.Bootstrap = $Matches[1] -eq 'yes'
        }
        elseif ($line -match '\AHCW FACT (\S+)\s*\z') {
            $result.Fact = $Matches[1]
        }
        elseif ($line -match '\AHCW KEY (vault_arc_[a-z_]+) (set|empty|absent) (\S+)\s*\z') {
            if ($keys.Contains($Matches[1])) {
                $keys[$Matches[1]] = [pscustomobject]@{ State = $Matches[2]; Detail = $Matches[3] }
            }
        }
        elseif ($line -match '\AHCW VAULT (\S+)\s*\z') {
            $result.Vault = $Matches[1]
        }
        elseif ($line -match '\AHCW ERROR (\S+) ?(.*)\z') {
            $result.ErrorCode = $Matches[1]
            $result.ErrorMessage = $Matches[2]
        }
    }
    if ($result.Vault -eq 'missing') {
        foreach ($key in @($keys.Keys)) {
            $keys[$key] = [pscustomobject]@{ State = 'absent'; Detail = '-' }
        }
    }
    $state = [pscustomobject]$result
    $state | Add-Member -NotePropertyName VaultKeys -NotePropertyValue $keys
    return $state
}

function ConvertFrom-LabArcRemovalOutput {
    <#
    .SYNOPSIS
        Reads the HCW REMOVE line, or the HCW ERROR line, of a removal run.
    #>
    [OutputType([pscustomobject])]
    param([AllowEmptyCollection()] [AllowNull()] [string[]] $Lines)

    $result = [ordered]@{ State = $null; Removed = [string[]]@(); Absent = [string[]]@(); ErrorCode = $null; ErrorMessage = $null }
    foreach ($line in @($Lines)) {
        if ($null -eq $line) {
            continue
        }
        if ($line -match '\AHCW REMOVE (\S+) removed=(\S*) absent=(\S*)\s*\z') {
            $result.State = $Matches[1]
            $result.Removed = [string[]]@($Matches[2] -split ',' | Where-Object { $_ })
            $result.Absent = [string[]]@($Matches[3] -split ',' | Where-Object { $_ })
        }
        elseif ($line -match '\AHCW ERROR (\S+) ?(.*)\z') {
            $result.ErrorCode = $Matches[1]
            $result.ErrorMessage = $Matches[2]
        }
    }
    return [pscustomobject]$result
}

function Get-LabArcHostSummary {
    <#
    .SYNOPSIS
        One line saying what the host reported.
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [pscustomobject] $State,
        [Parameter(Mandatory)] [string] $HostAlias
    )

    $agent = switch ($State.AgentStatus) {
        'NotInstalled' { 'azcmagent is not installed' }
        'Connected' { "azcmagent is Connected as $($State.ResourceName) in $($State.ResourceGroup)" }
        default { "azcmagent reports $($State.AgentStatus)" }
    }
    $fact = switch ($State.Fact) {
        'enabled' { 'the arc fact is set' }
        'absent' { 'the arc fact is not set' }
        default { "the arc fact is $($State.Fact)" }
    }
    $helper = if ($State.Helper) { 'the vault helper is there' } else { 'the vault helper is missing' }
    $held = @($State.VaultKeys.Keys | Where-Object { $State.VaultKeys[$_].State -eq 'set' })
    $vault = switch ($State.Vault) {
        'present' { if ($held.Count -eq 0) { 'the vault holds no vault_arc_* key' } else { "the vault holds $($held -join ', ')" } }
        'missing' { 'there is no vault yet' }
        default { "the vault could not be read ($($State.Vault))" }
    }
    return "Host: on $HostAlias $agent; $fact; $helper; $vault."
}

function Get-LabArcExpectedPlan {
    <#
    .SYNOPSIS
        The hcw-azure plan line to expect: the permanent diff every plan in
        that workspace carries (3 to add, 1 to change, 3 to destroy: three
        azapi_* replacements and the RUNTIME_CONFIG_WRITER change,
        infra/functionapp.tf), plus one add for each resource the variables
        switch on.
    #>
    [OutputType([string])]
    param(
        [switch] $NeedGrant,
        [switch] $NeedPolicy
    )

    $add = 3 + [int][bool]$NeedGrant + [int][bool]$NeedPolicy
    return "Plan: $add to add, 1 to change, 3 to destroy"
}

function Get-LabArcTerraformLines {
    <#
    .SYNOPSIS
        What to set in the hcw-azure workspace, where, and the plan to expect,
        as lines to print. Every value is written in; nothing is left for the
        owner to fill.
    #>
    [OutputType([string[]])]
    param(
        [AllowEmptyString()] [string] $ObjectId = '',
        [switch] $NeedGrant,
        [switch] $NeedPolicy,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [Parameter(Mandatory)] [string] $NextCommand
    )

    if ($NeedGrant -and -not (Test-LabGuid -Value $ObjectId)) {
        throw "'$ObjectId' is not a service principal object id."
    }
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('Terraform: the onboarding grant and the audit policy assignment are created by hcw-azure (infra/lab-hybrid.tf), never by this script. Open')
    $lines.Add('')
    $lines.Add("  $($Target.VariablesUrl)")
    $lines.Add('')
    $lines.Add('and add each variable below with + Add variable: category Terraform variable (not Environment variable), Sensitive left unticked. If one is already there, edit it to this value.')
    $lines.Add('')
    $created = [System.Collections.Generic.List[string]]::new()
    if ($NeedGrant) {
        $lines.Add("  Key: arc_onboarding_principal_id   Value: $($ObjectId.ToLowerInvariant())   HCL: off")
        $created.Add('azurerm_role_assignment.arc_onboarding[0] will be created')
    }
    if ($NeedPolicy) {
        $lines.Add('  Key: lab_hybrid_policy_enabled     Value: true   HCL: on')
        $created.Add('azurerm_resource_group_policy_assignment.lab_hybrid_linux_baseline[0] will be created')
    }
    $lines.Add('')
    $lines.Add("Then open $($Target.WorkspaceUrl), press New run, choose Plan and apply, and start it. The plan should read:")
    $lines.Add('')
    $lines.Add('  ' + (Get-LabArcExpectedPlan -NeedGrant:$NeedGrant -NeedPolicy:$NeedPolicy))
    $lines.Add('')
    $lines.Add("The new lines are: $($created -join '; '). The other 3 to add, 1 to change and 3 to destroy are the permanent diff every plan in this workspace carries (three azapi_* replacements and the RUNTIME_CONFIG_WRITER change, infra/functionapp.tf). Anything else is not this change: discard the run and read the plan. Otherwise press Confirm & apply, and when the apply has finished, run this in PowerShell from the repository root:")
    $lines.Add('')
    $lines.Add("  $NextCommand")
    return [string[]]$lines.ToArray()
}

function Get-LabArcResourcePaths {
    <#
    .SYNOPSIS
        The ARM ids and REST addresses of the machine, its Azure Monitor Agent
        extension, the data collection rule and the rule's association.
    #>
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [pscustomobject] $Target
    )

    if (-not (Test-LabGuid -Value $SubscriptionId)) {
        throw "'$SubscriptionId' is not a subscription id."
    }
    $group = "/subscriptions/$($SubscriptionId.ToLowerInvariant())/resourceGroups/$($Target.ResourceGroup)"
    $machine = "$group/providers/Microsoft.HybridCompute/machines/$($Target.MachineName)"
    $extension = "$machine/extensions/$($Target.ExtensionName)"
    $rule = "$group/providers/Microsoft.Insights/dataCollectionRules/$($Target.RuleName)"
    $association = "$machine/providers/Microsoft.Insights/dataCollectionRuleAssociations/$($Target.AssociationName)"
    $base = 'https://management.azure.com'
    return [pscustomobject]@{
        MachineId      = $machine
        ExtensionId    = $extension
        RuleId         = $rule
        AssociationId  = $association
        MachineUrl     = "$base$($machine)?api-version=$($Target.HybridComputeApi)"
        ExtensionUrl   = "$base$($extension)?api-version=$($Target.HybridComputeApi)"
        RuleUrl        = "$base$($rule)?api-version=$($Target.MonitorApi)"
        AssociationUrl = "$base$($association)?api-version=$($Target.MonitorApi)"
    }
}

function Get-LabArcReadbackLines {
    <#
    .SYNOPSIS
        The PowerShell read-backs the owner can run after -Connect, with what
        each should show.
    #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [Parameter(Mandatory)] [string] $SubscriptionName
    )

    return [string[]]@(
        'Read back from Azure, PowerShell; success is one row with status Connected:',
        '',
        "  az connectedmachine list -g $($Target.ResourceGroup) --subscription $SubscriptionName -o json | ConvertFrom-Json | Select-Object name, status, agentVersion, osName",
        '',
        'The first az connectedmachine command offers to install its CLI extension; accept it. The first Heartbeat reaches the Management workspace about ten minutes after the agent extension, and the first compliance result for the audit baseline can take hours: docs/runbooks/labs-host.md, "Arc onboarding", has the Heartbeat, syslog and compliance queries.'
    )
}

function Invoke-LabAz {
    <#
    .SYNOPSIS
        Runs az and returns its exit code, standard output and standard error
        separately. The seam the tests mock.
    #>
    [OutputType([pscustomobject])]
    param([Parameter(Mandatory)] [string[]] $Arguments)

    $stdout = [System.Collections.Generic.List[string]]::new()
    $stderr = [System.Collections.Generic.List[string]]::new()
    & az @Arguments 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
            $stderr.Add($_.ToString())
        }
        else {
            $stdout.Add([string]$_)
        }
    }
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Stdout   = ($stdout -join "`n")
        Stderr   = ($stderr -join "`n")
    }
}

function Invoke-LabAzJson {
    <#
    .SYNOPSIS
        Runs az, retrying while Entra has not caught up with an object this
        run created, and writes the parsed JSON to the pipeline (a JSON list
        as its items, so an empty list writes nothing).

    .DESCRIPTION
        RetryPattern names the answers that mean Entra has not replicated an
        object yet. AcceptPattern names an answer that means there is nothing
        there, or that the change is already made; the call then writes
        nothing and succeeds.
    #>
    param(
        [Parameter(Mandatory)] [string[]] $Arguments,
        [Parameter(Mandatory)] [string] $What,
        [ValidateRange(1, 20)] [int] $Attempts = 1,
        [int] $DelaySeconds = 10,
        [string] $RetryPattern = '',
        [string] $AcceptPattern = ''
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $result = Invoke-LabAz -Arguments $Arguments
        if ($result.ExitCode -eq 0) {
            if (-not [string]::IsNullOrWhiteSpace($result.Stdout)) {
                $result.Stdout | ConvertFrom-Json
            }
            return
        }
        if ($AcceptPattern -and $result.Stderr -match $AcceptPattern) {
            return
        }
        if ($attempt -lt $Attempts -and $RetryPattern -and $result.Stderr -match $RetryPattern) {
            Write-Host "  $What`: Entra has not caught up yet; trying again in $DelaySeconds seconds ($attempt of $Attempts)."
            Start-Sleep -Seconds $DelaySeconds
            continue
        }
        $detail = (@($result.Stderr -split "`n" | Where-Object { $_.Trim() }) | Select-Object -First 4) -join ' '
        throw "$What failed: az exited $($result.ExitCode). $detail"
    }
}

function Invoke-LabSsh {
    <#
    .SYNOPSIS
        Runs one command on the host and returns its exit code and output
        lines; with -Stream the lines are also shown as they arrive. The
        seam the tests mock.
    #>
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [string] $Command,
        [switch] $Stream
    )

    $lines = [System.Collections.Generic.List[string]]::new()
    & ssh -o ConnectTimeout=20 $HostAlias $Command 2>&1 | ForEach-Object {
        $line = [string]$_
        $lines.Add($line)
        if ($Stream) {
            Write-Host $line
        }
    }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Lines = [string[]]$lines.ToArray() }
}

function Invoke-LabSshInput {
    <#
    .SYNOPSIS
        Runs one command on the host with InputText, then one line feed, on
        its standard input, and returns its exit code and output lines. The
        seam the tests mock.

    .DESCRIPTION
        A PowerShell pipe into a native command ends each line with the
        platform's newline, which on Windows is a carriage return and a line
        feed; a helper that strips only the line feed would store the value
        with a trailing carriage return. So the bytes are written here, UTF-8
        without a byte order mark and with a bare line feed, and the buffer
        is cleared after. The value is never on a command line.
    #>
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(Mandatory)] [string] $InputText
    )

    $ssh = Get-Command ssh -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $ssh.Source
    foreach ($argument in @('-o', 'ConnectTimeout=20', $HostAlias, $Command)) {
        $start.ArgumentList.Add($argument)
    }
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($start)
    $bytes = $null
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($InputText + "`n")
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        $process.WaitForExit()
        $text = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
        $lines = [string[]]@($text -split "`r?`n" | Where-Object { $_ -ne '' })
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Lines = $lines }
    }
    finally {
        if ($null -ne $bytes) {
            [System.Array]::Clear($bytes, 0, $bytes.Length)
        }
        $process.Dispose()
    }
}

function Read-LabArcHostState {
    <#
    .SYNOPSIS
        The host's Arc state, read on the host with the report script.
    #>
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [AllowEmptyString()] [string] $Hint = ''
    )

    $run = Invoke-LabSsh -HostAlias $HostAlias -Command (Get-LabArcRemoteCommand -BashScript (Get-LabArcHostScript -Mode report -Target $Target -Hint $Hint))
    if ($run.ExitCode -eq 255) {
        throw "ssh could not reach $HostAlias. Set this desktop up with scripts/lab/Connect-Lab.ps1 (docs/runbooks/labs-host.md, ""Connect from a desktop""), check that ssh $HostAlias hostname prints the host's name, then run this again."
    }
    if ($run.ExitCode -ne 0) {
        throw "Reading the Arc state on $HostAlias failed (exit $($run.ExitCode)): $((@($run.Lines) | Select-Object -Last 3) -join ' ')"
    }
    return ConvertFrom-LabArcHostState -Lines $run.Lines
}

function Wait-LabArcConnected {
    <#
    .SYNOPSIS
        Reads the host until azcmagent reports Connected, or Attempts reads
        have not, and returns the last state.
    #>
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [ValidateRange(1, 60)] [int] $Attempts = 6,
        [int] $DelaySeconds = 10
    )

    $state = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $state = Read-LabArcHostState -HostAlias $HostAlias -Target $Target
        if ($state.AgentStatus -eq 'Connected' -or $attempt -eq $Attempts) {
            break
        }
        Write-Host "  Host: azcmagent reports $($state.AgentStatus); reading again in $DelaySeconds seconds ($attempt of $Attempts)."
        Start-Sleep -Seconds $DelaySeconds
    }
    return $state
}

function Set-LabArcFact {
    <#
    .SYNOPSIS
        Writes or removes the arc fact on the host. Returns written, removed,
        unchanged, or would-write / would-remove under -WhatIf.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [ValidateSet('enabled', 'absent')] [string] $State = 'enabled'
    )

    $verb = if ($State -eq 'enabled') { 'Write {"enabled": true} to' } else { 'Remove' }
    if (-not $PSCmdlet.ShouldProcess("$($Target.Fact) on $HostAlias", $verb)) {
        if ($State -eq 'enabled') { return 'would-write' } else { return 'would-remove' }
    }
    $run = Invoke-LabSsh -HostAlias $HostAlias -Command (Get-LabArcRemoteCommand -BashScript (Get-LabArcFactScript -Target $Target -State $State))
    $result = $null
    foreach ($line in @($run.Lines)) {
        if ($line -match '\AHCW FACT (written|removed|unchanged)\s*\z') {
            $result = $Matches[1]
        }
    }
    if ($run.ExitCode -ne 0 -or -not $result) {
        throw "Changing $($Target.Fact) on $HostAlias failed (exit $($run.ExitCode)): $((@($run.Lines) | Select-Object -Last 3) -join ' ')"
    }
    return $result
}

function Remove-LabArcVaultKeys {
    <#
    .SYNOPSIS
        Removes the four vault_arc_* keys from the vault on the host; under
        -WhatIf runs the same script in check mode, which writes nothing.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target
    )

    $mode = if ($PSCmdlet.ShouldProcess("$($Target.VaultDirectory)/vault.yml on $HostAlias", 'Remove the four vault_arc_* keys')) { 'remove' } else { 'check' }
    $run = Invoke-LabSsh -HostAlias $HostAlias -Command (Get-LabArcRemoteCommand -BashScript (Get-LabArcHostScript -Mode $mode -Target $Target))
    $result = ConvertFrom-LabArcRemovalOutput -Lines $run.Lines
    if ($run.ExitCode -ne 0 -or -not $result.State) {
        $reason = if ($result.ErrorMessage) { $result.ErrorMessage } else { "exit $($run.ExitCode): " + ((@($run.Lines) | Select-Object -Last 3) -join ' ') }
        throw "The vault on $HostAlias was not changed: $reason"
    }
    return $result
}

function Set-LabArcVaultValue {
    <#
    .SYNOPSIS
        Sets one vault_arc_* key in the vault on the host through
        hcw-vault-set, the value on standard input.

    .DESCRIPTION
        The helper prints no value. Its output is still searched for the
        value before any of it is repeated in an error, so a helper that
        misbehaved could not make this script print a secret.
    #>
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [Parameter(Mandatory)] [string] $Key,
        [Parameter(Mandatory)] [string] $Value
    )

    if ((Get-LabArcVaultKeys) -notcontains $Key) {
        throw "$Key is not one of the four vault_arc_* keys."
    }
    Assert-LabShellValue -Name 'Helper' -Value ([string]$Target.Helper)
    $run = Invoke-LabSshInput -HostAlias $HostAlias -Command "sudo -n $($Target.Helper) $Key" -InputText $Value
    if ($run.ExitCode -ne 0) {
        $detail = (@($run.Lines) | Where-Object { $_ } | Select-Object -Last 3) -join ' '
        if ($Value) {
            $detail = $detail.Replace($Value, '[value not shown]')
        }
        throw "$($Target.Helper) $Key on $HostAlias exited $($run.ExitCode): $detail"
    }
}

function Resolve-LabArcSubscription {
    <#
    .SYNOPSIS
        The id of the subscription with this name in the signed-in tenant.
        Resolved rather than committed: the repository holds no subscription
        id (docs/standards/required-inputs.md).
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $TenantId
    )

    $subscriptions = @(Invoke-LabAzJson -Arguments @('account', 'list', '--all', '-o', 'json') -What 'Listing the subscriptions az can see')
    $found = @($subscriptions | Where-Object {
            [string](Get-LabProperty -Object $_ -Name 'name') -ceq $Name -and ([string](Get-LabProperty -Object $_ -Name 'tenantId')).ToLowerInvariant() -eq $TenantId.ToLowerInvariant()
        })
    if ($found.Count -eq 0) {
        throw "az sees no subscription named $Name in tenant $TenantId. Sign in as an account that can read it (az login --tenant with the tenant domain), then run this again."
    }
    if ($found.Count -gt 1) {
        throw "$($found.Count) subscriptions in tenant $TenantId are named $Name; which one is meant is not a guess to make."
    }
    $id = [string](Get-LabProperty -Object $found[0] -Name 'id')
    if (-not (Test-LabGuid -Value $id)) {
        throw "az returned no id for the subscription $Name."
    }
    return $id.ToLowerInvariant()
}

function Get-LabArcResourceGroup {
    <#
    .SYNOPSIS
        The resource group, or $null when it does not exist.
    #>
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $Name
    )

    return Invoke-LabAzJson -Arguments @('group', 'show', '--name', $Name, '--subscription', $SubscriptionId, '-o', 'json') -What "Reading the resource group $Name" -AcceptPattern '(?i)ResourceGroupNotFound|could not be found'
}

function Confirm-LabArcApplication {
    <#
    .SYNOPSIS
        Finds the onboarding app registration by display name, or creates it
        (single tenant, no credential, no role), then does the same for its
        service principal. With -NoCreate it only finds them. More than one
        registration of that name is a stop.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $DisplayName,
        [switch] $NoCreate
    )

    $replication = '(?i)does not exist|not found|can''t find|cannot find|NoSuchObject|ResourceNotFound'
    $apps = @(Invoke-LabAzJson -Arguments @('ad', 'app', 'list', '--display-name', $DisplayName, '-o', 'json') -What "Looking up the app registration $DisplayName" |
            Where-Object { [string](Get-LabProperty -Object $_ -Name 'displayName') -ceq $DisplayName })
    if ($apps.Count -gt 1) {
        $ids = ($apps | ForEach-Object { [string](Get-LabProperty -Object $_ -Name 'appId') }) -join ', '
        throw "$($apps.Count) app registrations are named $DisplayName ($ids). Delete the ones onboarding does not use, then run this again."
    }
    $none = [pscustomobject]@{ AppId = $null; ServicePrincipalId = $null; AppCreated = $false; ServicePrincipalCreated = $false }

    $appCreated = $false
    if ($apps.Count -eq 1) {
        $app = $apps[0]
    }
    elseif ($NoCreate) {
        return $none
    }
    elseif ($PSCmdlet.ShouldProcess($DisplayName, 'Create the app registration')) {
        $app = Invoke-LabAzJson -Arguments @('ad', 'app', 'create', '--display-name', $DisplayName, '--sign-in-audience', 'AzureADMyOrg', '-o', 'json') -What "Creating the app registration $DisplayName"
        $appCreated = $true
    }
    else {
        return $none
    }

    $appId = [string](Get-LabProperty -Object $app -Name 'appId')
    if (-not (Test-LabGuid -Value $appId)) {
        throw "az returned no appId for $DisplayName."
    }
    $sps = @(Invoke-LabAzJson -Arguments @('ad', 'sp', 'list', '--filter', "appId eq '$appId'", '-o', 'json') -What "Looking up the service principal of $DisplayName" -Attempts 6 -RetryPattern $replication)
    $spCreated = $false
    $spId = $null
    if ($sps.Count -ge 1) {
        $spId = [string](Get-LabProperty -Object $sps[0] -Name 'id')
    }
    elseif (-not $NoCreate -and $PSCmdlet.ShouldProcess($DisplayName, 'Create the service principal')) {
        $sp = Invoke-LabAzJson -Arguments @('ad', 'sp', 'create', '--id', $appId, '-o', 'json') -What "Creating the service principal of $DisplayName" -Attempts 6 -RetryPattern $replication
        $spId = [string](Get-LabProperty -Object $sp -Name 'id')
        $spCreated = $true
    }
    if ($spId -and -not (Test-LabGuid -Value $spId)) {
        throw "az returned no object id for the service principal of $DisplayName."
    }
    return [pscustomobject]@{
        AppId                   = $appId.ToLowerInvariant()
        ServicePrincipalId      = if ($spId) { $spId.ToLowerInvariant() } else { $null }
        AppCreated              = $appCreated
        ServicePrincipalCreated = $spCreated
    }
}

function Get-LabArcPasswordCredentials {
    <#
    .SYNOPSIS
        The registration's client secrets, as metadata: keyId, displayName,
        endDateTime and hint. Entra never returns a secret's value again.
    #>
    [OutputType([object[]])]
    param([Parameter(Mandatory)] [string] $AppId)

    $replication = '(?i)does not exist|not found|can''t find|cannot find|NoSuchObject|ResourceNotFound'
    $credentials = @(Invoke-LabAzJson -Arguments @('ad', 'app', 'credential', 'list', '--id', $AppId, '-o', 'json') -What 'Listing the registration''s client secrets' -Attempts 6 -RetryPattern $replication)
    return , [object[]]$credentials
}

function Remove-LabArcPasswordCredentials {
    <#
    .SYNOPSIS
        Deletes each of these client secrets from the registration. Returns
        how many it deleted.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)] [string] $AppId,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Registered
    )

    $removed = 0
    foreach ($credential in @($Registered)) {
        if ($null -eq $credential) {
            continue
        }
        $keyId = [string](Get-LabProperty -Object $credential -Name 'keyId')
        if (-not (Test-LabGuid -Value $keyId)) {
            continue
        }
        if ($PSCmdlet.ShouldProcess($AppId, "Delete the client secret $keyId")) {
            $null = Invoke-LabAzJson -Arguments @('ad', 'app', 'credential', 'delete', '--id', $AppId, '--key-id', $keyId, '-o', 'none') -What "Deleting the client secret $keyId" -AcceptPattern '(?i)No (password|key|credential)|not found'
            $removed++
        }
    }
    return $removed
}

function New-LabArcSecret {
    <#
    .SYNOPSIS
        Adds one client secret to the registration and returns its value.
        The only function that ever holds it before it is piped to the host.
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [string] $AppId,
        [Parameter(Mandatory)] [string] $EndDate,
        [Parameter(Mandatory)] [string] $KeyDisplayName,
        [ValidateRange(1, 20)] [int] $Attempts = 6,
        [int] $DelaySeconds = 10
    )

    $replication = '(?i)does not exist|not found|can''t find|cannot find|NoSuchObject|ResourceNotFound'
    $arguments = Get-LabArcSecretResetArguments -AppId $AppId -EndDate $EndDate -KeyDisplayName $KeyDisplayName
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $result = Invoke-LabAz -Arguments $arguments
        if ($result.ExitCode -eq 0) {
            $value = ([string]$result.Stdout).Trim()
            $result = $null
            if (-not (Test-LabArcSecretShape -Value $value)) {
                $value = $null
                throw 'az added a client secret but did not return a usable value (it is not shown). The next run deletes it.'
            }
            return $value
        }
        if ($attempt -lt $Attempts -and $result.Stderr -match $replication) {
            Write-Host "  Minting the onboarding secret: Entra has not caught up yet; trying again in $DelaySeconds seconds ($attempt of $Attempts)."
            Start-Sleep -Seconds $DelaySeconds
            continue
        }
        $detail = (@($result.Stderr -split "`n" | Where-Object { $_.Trim() }) | Select-Object -First 4) -join ' '
        throw "Minting the onboarding secret failed: az exited $($result.ExitCode). $detail"
    }
}

function Publish-LabArcSecret {
    <#
    .SYNOPSIS
        Deletes the registration's other client secrets, writes the three
        identifiers to the vault, mints a new secret and pipes it into the
        vault. Returns Minted, or WouldMint under -WhatIf.

    .DESCRIPTION
        The secret lives only in a variable between az and the ssh pipe, and
        the variable is cleared in a finally block. When the vault write
        fails the new secret is deleted from Entra again, so a secret on the
        registration always means the vault has it.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [Parameter(Mandatory)] [string] $AppId,
        [Parameter(Mandatory)] [string] $TenantId,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [AllowNull()] [AllowEmptyCollection()] [object[]] $Remove,
        [Parameter(Mandatory)] [string] $EndDate
    )

    if (-not $PSCmdlet.ShouldProcess($AppId, "Mint an onboarding secret valid until $EndDate and write it, with its three identifiers, to the vault on $HostAlias")) {
        return 'WouldMint'
    }
    $null = Remove-LabArcPasswordCredentials -AppId $AppId -Registered $Remove -Confirm:$false
    Set-LabArcVaultValue -HostAlias $HostAlias -Target $Target -Key 'vault_arc_tenant_id' -Value $TenantId.ToLowerInvariant()
    Set-LabArcVaultValue -HostAlias $HostAlias -Target $Target -Key 'vault_arc_subscription_id' -Value $SubscriptionId.ToLowerInvariant()
    Set-LabArcVaultValue -HostAlias $HostAlias -Target $Target -Key 'vault_arc_service_principal_id' -Value $AppId.ToLowerInvariant()

    $secret = New-LabArcSecret -AppId $AppId -EndDate $EndDate -KeyDisplayName 'Register-LabArc.ps1 azcmagent connect'
    try {
        Set-LabArcVaultValue -HostAlias $HostAlias -Target $Target -Key 'vault_arc_service_principal_secret' -Value $secret
    }
    catch {
        $reason = $_.Exception.Message
        $secret = $null
        $null = Remove-LabArcPasswordCredentials -AppId $AppId -Registered (Get-LabArcPasswordCredentials -AppId $AppId) -Confirm:$false
        throw "Writing the onboarding secret to the vault on $HostAlias failed, so it was deleted from Entra again. $reason"
    }
    finally {
        $secret = $null
        Remove-Variable -Name secret -ErrorAction SilentlyContinue
    }
    return 'Minted'
}

function Confirm-LabArcSecret {
    <#
    .SYNOPSIS
        Makes sure the vault holds a live onboarding secret the registration
        knows: keeps the one there while it has an hour left, mints one
        otherwise (Get-LabArcSecretPlan says which). Returns the Action
        (Kept, Minted or WouldMint) and how many other secrets it deleted.

    .DESCRIPTION
        After a mint it reads the vault back: all four keys set, the three
        identifiers the ones written, and, once Entra lists the new secret,
        the vault's secret starting with its hint. A vault that does not
        read back as written has the new secret deleted from Entra again.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $HostAlias,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [Parameter(Mandatory)] [string] $AppId,
        [Parameter(Mandatory)] [string] $TenantId,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [pscustomobject] $HostState,
        [Parameter(Mandatory)] [datetime] $NowUtc,
        [Parameter(Mandatory)] [int] $LifetimeHours
    )

    $registered = Get-LabArcPasswordCredentials -AppId $AppId
    $hint = Get-LabArcCandidateHint -Registered $registered -NowUtc $NowUtc
    $state = if ($hint) { Read-LabArcHostState -HostAlias $HostAlias -Target $Target -Hint $hint } else { $HostState }
    $plan = Get-LabArcSecretPlan -Registered $registered -HostState $state -AppId $AppId -TenantId $TenantId -SubscriptionId $SubscriptionId -NowUtc $NowUtc -LifetimeHours $LifetimeHours
    if ($plan.Action -eq 'Reuse') {
        Write-Host "Secret: kept, because $($plan.Reason)."
        $removed = Remove-LabArcPasswordCredentials -AppId $AppId -Registered $plan.Remove
        return [pscustomobject]@{ Action = 'Kept'; Removed = $removed }
    }
    if (-not $HostState.Helper) {
        throw "Secret: $($Target.Helper) is not on $HostAlias, and this script writes the vault only through it, so nothing was minted. Install it (it takes the value on standard input and sets one key), then run this again."
    }
    if ($HostState.Vault -notin 'present', 'missing') {
        throw "Secret: the vault on $HostAlias could not be read ($($HostState.Vault)), so nothing was minted. lab-host/README.md, ""The vault"", is how it is made."
    }
    $endDate = Get-LabArcSecretEndDate -NowUtc $NowUtc -Hours $LifetimeHours
    $removing = @($plan.Remove).Count
    $also = if ($removing -gt 0) { ", after deleting the registration's $removing other client secret(s)" } else { '' }
    Write-Host "Secret: minting one, because $($plan.Reason)$also."
    $result = Publish-LabArcSecret -HostAlias $HostAlias -Target $Target -AppId $AppId -TenantId $TenantId -SubscriptionId $SubscriptionId -Remove $plan.Remove -EndDate $endDate
    if ($result -ne 'Minted') {
        Write-Host "Secret: would mint one valid until $endDate and write it, with the three identifiers, to the vault on $HostAlias."
        return [pscustomobject]@{ Action = 'WouldMint'; Removed = 0 }
    }

    $check = Read-LabArcHostState -HostAlias $HostAlias -Target $Target -Hint (Get-LabArcCandidateHint -Registered (Get-LabArcPasswordCredentials -AppId $AppId) -NowUtc $NowUtc)
    $expected = @{
        vault_arc_service_principal_id = $AppId.ToLowerInvariant()
        vault_arc_tenant_id            = $TenantId.ToLowerInvariant()
        vault_arc_subscription_id      = $SubscriptionId.ToLowerInvariant()
    }
    $problems = [System.Collections.Generic.List[string]]::new()
    foreach ($key in Get-LabArcVaultKeys) {
        $entry = $check.VaultKeys[$key]
        if ($entry.State -ne 'set') {
            $problems.Add("$key is $($entry.State)")
        }
        elseif ($expected.ContainsKey($key) -and $entry.Detail -ne $expected[$key]) {
            $problems.Add("$key is not the value written")
        }
        elseif ($key -eq 'vault_arc_service_principal_secret' -and $entry.Detail -eq 'hint-mismatch') {
            $problems.Add('the secret is not the one minted')
        }
    }
    if ($problems.Count -gt 0) {
        $null = Remove-LabArcPasswordCredentials -AppId $AppId -Registered (Get-LabArcPasswordCredentials -AppId $AppId) -Confirm:$false
        throw "The vault on $HostAlias does not read back as written ($($problems -join '; ')), so the new secret was deleted from Entra again."
    }
    Write-Host "Secret: a client secret valid until $endDate is in the vault on $HostAlias as vault_arc_service_principal_secret, with the application, tenant and subscription ids. It was never shown or written to this desktop."
    return [pscustomobject]@{ Action = 'Minted'; Removed = $removing }
}

function Test-LabArcRoleAssignment {
    <#
    .SYNOPSIS
        True when PrincipalId holds RoleName (or the role with RoleId) at
        exactly Scope.
    #>
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)] [string] $Scope,
        [Parameter(Mandatory)] [string] $PrincipalId,
        [Parameter(Mandatory)] [string] $RoleName,
        [string] $RoleId = ''
    )

    $assignments = @(Invoke-LabAzJson -Arguments @('role', 'assignment', 'list', '--scope', $Scope, '-o', 'json') -What "Reading the role assignments on $Scope")
    foreach ($assignment in $assignments) {
        $principal = [string](Get-LabProperty -Object $assignment -Name 'principalId')
        $at = [string](Get-LabProperty -Object $assignment -Name 'scope')
        $name = [string](Get-LabProperty -Object $assignment -Name 'roleDefinitionName')
        $definition = [string](Get-LabProperty -Object $assignment -Name 'roleDefinitionId')
        $sameRole = $name -eq $RoleName -or ($RoleId -and $definition -like "*/$RoleId")
        if ($principal -eq $PrincipalId -and $at -eq $Scope -and $sameRole) {
            return $true
        }
    }
    return $false
}

function Confirm-LabArcPolicyWriter {
    <#
    .SYNOPSIS
        Grants the Terraform run identity RoleName on Scope unless it holds
        it. Returns Unchanged, Granted, WouldGrant or NotFound (the identity
        is not in the directory, or its name is not unique).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [string] $Scope,
        [Parameter(Mandatory)] [string] $IdentityName,
        [Parameter(Mandatory)] [string] $RoleName
    )

    $found = @(Invoke-LabAzJson -Arguments @('ad', 'sp', 'list', '--display-name', $IdentityName, '-o', 'json') -What "Looking up $IdentityName" |
            Where-Object { [string](Get-LabProperty -Object $_ -Name 'displayName') -ceq $IdentityName })
    if ($found.Count -ne 1) {
        return [pscustomobject]@{ Action = 'NotFound'; PrincipalId = $null; Count = $found.Count }
    }
    $principalId = ([string](Get-LabProperty -Object $found[0] -Name 'id')).ToLowerInvariant()
    if (Test-LabArcRoleAssignment -Scope $Scope -PrincipalId $principalId -RoleName $RoleName) {
        return [pscustomobject]@{ Action = 'Unchanged'; PrincipalId = $principalId; Count = 1 }
    }
    if (-not $PSCmdlet.ShouldProcess($IdentityName, "Grant $RoleName on $Scope")) {
        return [pscustomobject]@{ Action = 'WouldGrant'; PrincipalId = $principalId; Count = 1 }
    }
    $null = Invoke-LabAzJson -Arguments @('role', 'assignment', 'create', '--assignee-object-id', $principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', $RoleName, '--scope', $Scope, '-o', 'none') -What "Granting $IdentityName $RoleName" -AcceptPattern '(?i)RoleAssignmentExists'
    return [pscustomobject]@{ Action = 'Granted'; PrincipalId = $principalId; Count = 1 }
}

function Get-LabArcPolicyAssignment {
    <#
    .SYNOPSIS
        The audit policy assignment on the group, or $null.
    #>
    param(
        [Parameter(Mandatory)] [string] $Scope,
        [Parameter(Mandatory)] [string] $Name
    )

    $assignments = @(Invoke-LabAzJson -Arguments @('policy', 'assignment', 'list', '--scope', $Scope, '-o', 'json') -What "Reading the policy assignments on $Scope")
    foreach ($assignment in $assignments) {
        if ([string](Get-LabProperty -Object $assignment -Name 'name') -eq $Name) {
            return $assignment
        }
    }
    return $null
}

function Get-LabArcArmResource {
    <#
    .SYNOPSIS
        GETs an ARM resource with az rest; $null when it does not exist.
    #>
    param(
        [Parameter(Mandatory)] [string] $Url,
        [Parameter(Mandatory)] [string] $What
    )

    return Invoke-LabAzJson -Arguments @('rest', '--method', 'get', '--url', $Url, '-o', 'json') -What $What -AcceptPattern '(?i)Not ?Found'
}

function Invoke-LabArcArmPut {
    <#
    .SYNOPSIS
        PUTs Body to Url with az rest, the body in a temporary file that is
        deleted afterwards. The bodies hold ids and settings, no secret.
    #>
    param(
        [Parameter(Mandatory)] [string] $Url,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Body,
        [Parameter(Mandatory)] [string] $What,
        [string] $BodyDirectory = [System.IO.Path]::GetTempPath()
    )

    $file = Join-Path $BodyDirectory ('hcw-lab-arc-' + [guid]::NewGuid().ToString('n') + '.json')
    [System.IO.File]::WriteAllText($file, ($Body | ConvertTo-Json -Depth 8 -Compress), [System.Text.UTF8Encoding]::new($false))
    try {
        return Invoke-LabAzJson -Arguments @('rest', '--method', 'put', '--url', $Url, '--headers', 'Content-Type=application/json', '--body', ('@' + $file), '-o', 'json') -What $What
    }
    finally {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

function Get-LabArcProvisioningState {
    <#
    .SYNOPSIS
        properties.provisioningState of an ARM resource, or $null.
    #>
    [OutputType([string])]
    param([AllowNull()] $Resource)

    return [string](Get-LabProperty -Object (Get-LabProperty -Object $Resource -Name 'properties') -Name 'provisioningState')
}

function Confirm-LabArcMonitorAgent {
    <#
    .SYNOPSIS
        Installs the Azure Monitor Agent extension on the machine unless it is
        there, and waits for it to finish provisioning. Returns an Action
        (Unchanged, Installed, Waited, WouldInstall) and the final State.

    .DESCRIPTION
        The same extension az connectedmachine extension create makes
        (publisher Microsoft.Azure.Monitor, type AzureMonitorLinuxAgent,
        automatic upgrade on, no pinned handler version), made with az rest
        so that no CLI extension is needed. An extension that has failed is
        reported, not retried: the portal says why, and a retry is a delete
        and a new run.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [pscustomobject] $Paths,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [ValidateRange(1, 200)] [int] $Attempts = 45,
        [int] $DelaySeconds = 20,
        [string] $BodyDirectory = [System.IO.Path]::GetTempPath()
    )

    $existing = Get-LabArcArmResource -Url $Paths.ExtensionUrl -What 'Reading the Azure Monitor Agent extension'
    $state = Get-LabArcProvisioningState -Resource $existing
    if ($existing -and $state -eq 'Succeeded') {
        return [pscustomobject]@{ Action = 'Unchanged'; State = $state }
    }
    if ($existing -and $state -eq 'Failed') {
        return [pscustomobject]@{ Action = 'Unchanged'; State = $state }
    }
    $action = 'Waited'
    if (-not $existing) {
        if (-not $PSCmdlet.ShouldProcess($Target.MachineName, "Install the $($Target.ExtensionName) extension")) {
            return [pscustomobject]@{ Action = 'WouldInstall'; State = $null }
        }
        $body = [ordered]@{
            location   = $Target.Location
            properties = [ordered]@{
                publisher              = 'Microsoft.Azure.Monitor'
                type                   = $Target.ExtensionName
                enableAutomaticUpgrade = $true
            }
        }
        $null = Invoke-LabArcArmPut -Url $Paths.ExtensionUrl -Body $body -What "Installing the $($Target.ExtensionName) extension" -BodyDirectory $BodyDirectory
        $action = 'Installed'
    }
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $current = Get-LabArcArmResource -Url $Paths.ExtensionUrl -What 'Reading the Azure Monitor Agent extension'
        $state = Get-LabArcProvisioningState -Resource $current
        if ($state -in 'Succeeded', 'Failed') {
            break
        }
        if ($attempt -lt $Attempts) {
            Write-Host "  Azure: the $($Target.ExtensionName) extension is $(if ($state) { $state } else { 'not there yet' }); reading again in $DelaySeconds seconds ($attempt of $Attempts)."
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return [pscustomobject]@{ Action = $action; State = $state }
}

function Confirm-LabArcRuleAssociation {
    <#
    .SYNOPSIS
        Associates the data collection rule with the machine unless the
        association is there. Returns Unchanged, Associated, WouldAssociate,
        or Different when an association of that name names another rule
        (reported, never replaced).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [pscustomobject] $Paths,
        [Parameter(Mandatory)] [pscustomobject] $Target,
        [string] $BodyDirectory = [System.IO.Path]::GetTempPath()
    )

    $existing = Get-LabArcArmResource -Url $Paths.AssociationUrl -What 'Reading the data collection rule association'
    if ($existing) {
        $rule = [string](Get-LabProperty -Object (Get-LabProperty -Object $existing -Name 'properties') -Name 'dataCollectionRuleId')
        if ($rule -eq $Paths.RuleId) {
            return 'Unchanged'
        }
        return 'Different'
    }
    if (-not $PSCmdlet.ShouldProcess($Target.MachineName, "Associate $($Target.RuleName)")) {
        return 'WouldAssociate'
    }
    $body = [ordered]@{
        properties = [ordered]@{
            dataCollectionRuleId = $Paths.RuleId
            description          = 'Lab host (Arc): heartbeat and auth/authpriv syslog (ADR 0032 decision 3, #663). Made by scripts/lab/Register-LabArc.ps1.'
        }
    }
    $null = Invoke-LabArcArmPut -Url $Paths.AssociationUrl -Body $body -What "Associating $($Target.RuleName)" -BodyDirectory $BodyDirectory
    return 'Associated'
}

function Stop-LabRun {
    <#
    .SYNOPSIS
        Says why the run stops and, when there is one, the one line to run
        next, introduced by Intro. Exits 1.
    #>
    param(
        [Parameter(Mandatory)] [string] $Message,
        [string] $Command,
        [string] $Intro = 'Run this in PowerShell, then run this script again:'
    )

    Write-Host ''
    Write-Host $Message
    if ($Command) {
        Write-Host $Intro
        Write-Host ''
        Write-Host "  $Command"
    }
    exit 1
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

$target = Get-LabArcTarget
$loginLine = "az login --tenant $TenantDomain"
$firstLine = 'pwsh -NoProfile -File scripts/lab/Register-LabArc.ps1'
$connectLine = "$firstLine -Connect"
$changes = [System.Collections.Generic.List[string]]::new()
$now = [datetime]::UtcNow
$lifetimeHours = $SecretLifetimeHours

foreach ($tool in 'az', 'ssh') {
    if (-not (Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue)) {
        $hint = if ($tool -eq 'az') {
            ' Install the Azure CLI: winget install --exact --id Microsoft.AzureCLI'
        }
        else {
            ' Install the OpenSSH client from PowerShell opened with Run as administrator: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0'
        }
        throw "$tool is not on PATH.$hint"
    }
}

# 1. az, signed in to the tenant.
$account = Invoke-LabAz -Arguments @('account', 'show', '-o', 'json')
if ($account.ExitCode -ne 0) {
    Stop-LabRun -Message 'az is not signed in.' -Command $loginLine
}
$accountInfo = $account.Stdout | ConvertFrom-Json
$tenantId = ([string](Get-LabProperty -Object $accountInfo -Name 'tenantId')).ToLowerInvariant()
$defaultDomain = [string](Get-LabProperty -Object $accountInfo -Name 'tenantDefaultDomain')
if ($defaultDomain -ne $TenantDomain) {
    # The default domain can be a custom one; the tenant's own discovery
    # document names its id whatever the default is.
    $discovery = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$TenantDomain/v2.0/.well-known/openid-configuration"
    $expectedTenant = Get-LabTenantIdFromIssuer -Issuer ([string](Get-LabProperty -Object $discovery -Name 'issuer'))
    if (-not $expectedTenant -or $expectedTenant -ne $tenantId) {
        Stop-LabRun -Message "az is signed in to tenant $tenantId, not $TenantDomain." -Command $loginLine
    }
}
if (-not (Test-LabGuid -Value $tenantId)) {
    Stop-LabRun -Message 'az account show returned no tenant id.' -Command $loginLine
}
$signedInAs = [string](Get-LabProperty -Object (Get-LabProperty -Object $accountInfo -Name 'user') -Name 'name')
Write-Host "az: signed in as $signedInAs to $TenantDomain ($tenantId)."

# 2. The subscription and the resource group hcw-azure creates.
$subscriptionId = Resolve-LabArcSubscription -Name $SubscriptionName -TenantId $tenantId
$group = Get-LabArcResourceGroup -SubscriptionId $subscriptionId -Name $target.ResourceGroup
if ($null -eq $group) {
    Stop-LabRun -Message "$($target.ResourceGroup) does not exist in $SubscriptionName. The hcw-azure apply creates it (docs/runbooks/labs-host.md, ""Arc onboarding"", step 1): confirm that run at $($target.WorkspaceUrl)/runs, then run this again."
}
$groupId = [string](Get-LabProperty -Object $group -Name 'id')
$paths = Get-LabArcResourcePaths -SubscriptionId $subscriptionId -Target $target
Write-Host "Azure: $($target.ResourceGroup) exists in $SubscriptionName ($subscriptionId)."

# 3. The host.
$hostState = Read-LabArcHostState -HostAlias $HostAlias -Target $target
Write-Host (Get-LabArcHostSummary -State $hostState -HostAlias $HostAlias)
$connected = $hostState.AgentStatus -eq 'Connected'
if ($connected -and ($hostState.ResourceName -ne $target.MachineName -or $hostState.ResourceGroup -ne $target.ResourceGroup)) {
    Write-Host "  The host is Connected, but as $($hostState.ResourceName) in $($hostState.ResourceGroup), not $($target.MachineName) in $($target.ResourceGroup). This script works on the names in lab-host/ansible/group_vars/all.yml."
}

# 4. The onboarding identity.
$app = Confirm-LabArcApplication -DisplayName $DisplayName -NoCreate:$Connect
if ($null -eq $app.AppId) {
    if ($Connect) {
        Stop-LabRun -Message "Entra: there is no $DisplayName yet. The run without -Connect creates it and says what to set in hcw-azure." -Command $firstLine
    }
    Write-Host "Entra: would create the app registration and service principal $DisplayName (single tenant, no role, no credential)."
}
else {
    if ($app.AppCreated) {
        $changes.Add("created the app registration $DisplayName")
    }
    $state = if ($app.AppCreated) { 'created' } else { 'found' }
    Write-Host "Entra: $state the app registration $DisplayName, application id $($app.AppId)."
    if ($app.ServicePrincipalId) {
        if ($app.ServicePrincipalCreated) {
            $changes.Add('created its service principal')
        }
        $state = if ($app.ServicePrincipalCreated) { 'created' } else { 'found' }
        Write-Host "Entra: $state its service principal, object id $($app.ServicePrincipalId). The object id is the value hcw-azure needs; the application id is the one azcmagent signs in with."
    }
    elseif ($Connect) {
        Stop-LabRun -Message "Entra: $DisplayName has no service principal. The run without -Connect creates it." -Command $firstLine
    }
    else {
        Write-Host 'Entra: would create its service principal.'
    }
}

# The secret, shared by both runs (Confirm-LabArcSecret); this only records
# what it did.
$secretStep = {
    if (-not $app.AppId) {
        Write-Host "Secret: would mint one valid for $lifetimeHours hours once the registration exists, and write it to the vault on $HostAlias with vault_arc_tenant_id, vault_arc_subscription_id and vault_arc_service_principal_id."
        return
    }
    $secret = Confirm-LabArcSecret -HostAlias $HostAlias -Target $target -AppId $app.AppId -TenantId $tenantId -SubscriptionId $subscriptionId -HostState $hostState -NowUtc $now -LifetimeHours $lifetimeHours
    if ($secret.Action -eq 'Minted') {
        $changes.Add('minted an onboarding secret and wrote it to the vault')
    }
    if ($secret.Removed -gt 0) {
        $changes.Add("deleted $($secret.Removed) other client secret(s) from $DisplayName")
    }
}

if (-not $Connect) {
    # 5. The run identity's right to write the audit policy assignment.
    $policy = Get-LabArcPolicyAssignment -Scope $groupId -Name $target.PolicyAssignmentName
    $needPolicy = $false
    if ($policy) {
        Write-Host "Azure: the audit policy assignment $($target.PolicyAssignmentName) is applied; lab_hybrid_policy_enabled is already on."
    }
    else {
        $writer = Confirm-LabArcPolicyWriter -Scope $groupId -IdentityName $target.TerraformIdentity -RoleName $target.PolicyWriterRole
        switch ($writer.Action) {
            'Unchanged' {
                Write-Host "Azure: $($target.TerraformIdentity) already holds $($target.PolicyWriterRole) on $($target.ResourceGroup), so hcw-azure can write the audit policy assignment."
                $needPolicy = $true
            }
            'Granted' {
                Write-Host "Azure: granted $($target.TerraformIdentity) $($target.PolicyWriterRole) on $($target.ResourceGroup) only, so hcw-azure can write the audit policy assignment (ADR 0032 decision 3: machine configuration, audit only)."
                $changes.Add("granted $($target.TerraformIdentity) $($target.PolicyWriterRole) on $($target.ResourceGroup)")
                $needPolicy = $true
            }
            'WouldGrant' {
                Write-Host "Azure: would grant $($target.TerraformIdentity) $($target.PolicyWriterRole) on $($target.ResourceGroup) only."
                $needPolicy = $true
            }
            default {
                Write-Host "Azure: $($writer.Count) service principals are named $($target.TerraformIdentity), so the run identity's $($target.PolicyWriterRole) grant was not made and lab_hybrid_policy_enabled stays off for now. Onboarding does not need it; docs/runbooks/labs-host.md, ""Arc onboarding"", says how to add it later."
            }
        }
    }

    # 6. The secret, unless the host is already Connected.
    if ($connected) {
        Write-Host "Secret: none is needed, because the host is already Connected. $connectLine removes any that is left."
    }
    else {
        & $secretStep
        $machine = Get-LabArcArmResource -Url $paths.MachineUrl -What "Reading the machine resource $($target.MachineName)"
        if ($machine) {
            Write-Host "Azure: a machine resource $($target.MachineName) already exists in $($target.ResourceGroup), left from an earlier host; -Connect stops until it is deleted. Delete it now, PowerShell:"
            Write-Host ''
            Write-Host "  az resource delete --ids $($paths.MachineId)"
        }
    }

    # 7. What hcw-azure has applied, and what to set there when it has not.
    $grant = $false
    if ($app.ServicePrincipalId) {
        $grant = Test-LabArcRoleAssignment -Scope $groupId -PrincipalId $app.ServicePrincipalId -RoleName $target.OnboardingRole -RoleId $target.OnboardingRoleId
    }
    Write-Host ''
    if ($grant -and -not $needPolicy) {
        Write-Host "Azure: $DisplayName holds $($target.OnboardingRole) on $($target.ResourceGroup), applied by hcw-azure. Nothing to set there. Next, PowerShell:"
        Write-Host ''
        Write-Host "  $connectLine"
    }
    elseif ($app.ServicePrincipalId) {
        if ($grant) {
            Write-Host "Azure: $DisplayName holds $($target.OnboardingRole) on $($target.ResourceGroup). Onboarding can go ahead now; the audit policy is one more variable."
        }
        foreach ($line in (Get-LabArcTerraformLines -ObjectId $app.ServicePrincipalId -NeedGrant:(-not $grant) -NeedPolicy:$needPolicy -Target $target -NextCommand $connectLine)) {
            Write-Host $line
        }
    }
    else {
        Write-Host "Terraform: the value of arc_onboarding_principal_id is the new service principal's object id, known once it exists; a run without -WhatIf prints it with the variables to set at $($target.VariablesUrl) and the plan to expect ($(Get-LabArcExpectedPlan -NeedGrant -NeedPolicy:$needPolicy))."
    }

    Write-Host ''
    if ($WhatIfPreference) {
        Write-Host 'WhatIf: nothing was changed.'
        exit 0
    }
    if ($changes.Count -eq 0) {
        Write-Host 'No changes: the identity, the grant for the audit policy and the secret were already in place.'
    }
    else {
        Write-Host ('Changed: ' + ($changes -join '; ') + '.')
    }
    exit 0
}

# -Connect. 1. The grant hcw-azure applies, read only.
$grant = Test-LabArcRoleAssignment -Scope $groupId -PrincipalId $app.ServicePrincipalId -RoleName $target.OnboardingRole -RoleId $target.OnboardingRoleId
$policy = Get-LabArcPolicyAssignment -Scope $groupId -Name $target.PolicyAssignmentName
if (-not $grant) {
    Write-Host ''
    Write-Host "Azure: $DisplayName does not hold $($target.OnboardingRole) on $($target.ResourceGroup) yet, so the host cannot connect."
    foreach ($line in (Get-LabArcTerraformLines -ObjectId $app.ServicePrincipalId -NeedGrant -NeedPolicy:(-not $policy) -Target $target -NextCommand $connectLine)) {
        Write-Host $line
    }
    exit 1
}
Write-Host "Azure: $DisplayName holds $($target.OnboardingRole) on $($target.ResourceGroup), applied by hcw-azure."
if ($policy) {
    Write-Host "Azure: the audit policy assignment $($target.PolicyAssignmentName) is applied."
}
else {
    Write-Host "Azure: the audit policy assignment $($target.PolicyAssignmentName) is not applied yet. Onboarding does not wait for it; the run without -Connect says what to set."
}

# 2. Connect, unless the host already is.
$factWritten = $false
if (-not $connected) {
    $machine = Get-LabArcArmResource -Url $paths.MachineUrl -What "Reading the machine resource $($target.MachineName)"
    if ($machine) {
        Stop-LabRun -Message "Azure: a machine resource $($target.MachineName) already exists in $($target.ResourceGroup), left from an earlier host, and azcmagent connect cannot take it over. Deleting it also deletes its extensions and its rule association (docs/runbooks/labs-host.md, ""Disconnecting"")." -Command "az resource delete --ids $($paths.MachineId)"
    }
    if (-not $hostState.Bootstrap) {
        Stop-LabRun -Message "Host: $($target.Bootstrap) is not on $HostAlias. The first run is lab-host/README.md, ""First run""."
    }
    & $secretStep

    if ($hostState.Fact -eq 'enabled') {
        Write-Host "Host: the arc fact is already set, so arc_enabled is true on $HostAlias."
    }
    else {
        $fact = Set-LabArcFact -HostAlias $HostAlias -Target $target -State enabled
        if ($fact -eq 'written') {
            $factWritten = $true
            $changes.Add("set the arc fact on $HostAlias")
            Write-Host "Host: wrote $($target.Fact), so arc_enabled is true on $HostAlias from the next bootstrap.sh run."
        }
        elseif ($fact -eq 'unchanged') {
            Write-Host "Host: the arc fact is already set."
        }
        else {
            Write-Host "Host: would write $($target.Fact) ({""enabled"": true}), which makes arc_enabled true on $HostAlias."
        }
    }

    if ($WhatIfPreference) {
        Write-Host "Host: would run sudo -n $($target.Bootstrap) on $HostAlias and wait for azcmagent to report Connected; then delete the registration's client secrets and the four vault_arc_* keys, install the $($target.ExtensionName) extension and associate $($target.RuleName)."
        Write-Host ''
        Write-Host 'WhatIf: nothing was changed.'
        exit 0
    }

    Write-Host "Host: running sudo -n $($target.Bootstrap) on $HostAlias. Its output follows."
    Write-Host ''
    $bootstrap = Invoke-LabSsh -HostAlias $HostAlias -Command "sudo -n $($target.Bootstrap)" -Stream
    Write-Host ''
    $changes.Add('ran bootstrap.sh')
    $hostState = Wait-LabArcConnected -HostAlias $HostAlias -Target $target
    if ($hostState.AgentStatus -ne 'Connected') {
        Write-Host (Get-LabArcHostSummary -State $hostState -HostAlias $HostAlias)
        $why = switch ($hostState.AgentStatus) {
            'NotInstalled' { "The arc role did not run: azcmagent is not installed. Either the play stopped before it (the PLAY RECAP above names the task), or the commit bootstrap.sh ran predates arc_enabled reading the host's fact." }
            default { "azcmagent connect did not complete; the arc role's output above says why. AZCM0041 with invalid_client is a wrong secret or application id; AuthorizationFailed is a grant that has not reached Azure yet (wait two minutes)." }
        }
        if ($factWritten) {
            $reverted = Set-LabArcFact -HostAlias $HostAlias -Target $target -State absent -Confirm:$false
            if ($reverted -eq 'removed') {
                $why += " The arc fact this run wrote was removed again, so later bootstrap.sh runs are not stopped by the arc role."
            }
        }
        Stop-LabRun -Message "Host: $HostAlias is not Connected (azcmagent reports $($hostState.AgentStatus)). $why The onboarding secret stays in Entra and the vault until a -Connect run finishes, and expires on its own." -Command $connectLine -Intro 'Once the cause is fixed, run this again, PowerShell:'
    }
    Write-Host "Host: Connected as $($hostState.ResourceName) in $($hostState.ResourceGroup), agent $($hostState.AgentVersion)."
    if ($bootstrap.ExitCode -ne 0) {
        Write-Host "  bootstrap.sh exited $($bootstrap.ExitCode): a role after arc failed, and the PLAY RECAP above names it. Arc onboarding does not depend on it."
    }
}
else {
    Write-Host "Host: already Connected as $($hostState.ResourceName) in $($hostState.ResourceGroup)."
    if ($hostState.Fact -ne 'enabled') {
        $fact = Set-LabArcFact -HostAlias $HostAlias -Target $target -State enabled
        if ($fact -eq 'written') {
            $changes.Add("set the arc fact on $HostAlias")
            Write-Host "Host: wrote $($target.Fact), so the arc role keeps the agent at its pin."
        }
    }
}

# 3. The credential does not outlive onboarding.
$credentials = Get-LabArcPasswordCredentials -AppId $app.AppId
$removed = Remove-LabArcPasswordCredentials -AppId $app.AppId -Registered $credentials
if ($WhatIfPreference) {
    Write-Host "Entra: would delete $(@($credentials).Count) client secret(s) from $DisplayName."
}
else {
    if ($removed -gt 0) {
        $changes.Add("deleted $removed client secret(s) from $DisplayName")
    }
    $left = @(Get-LabArcPasswordCredentials -AppId $app.AppId)
    if ($left.Count -gt 0) {
        throw "$DisplayName still has $($left.Count) client secret(s) after the deletion. Run -Connect again; if it persists, delete them under Certificates & secrets in the portal."
    }
    Write-Host "Entra: $DisplayName has no client secret (deleted $removed). The principal and its grant stay; without a credential they cannot be used, and re-onboarding needs only a new secret."
}
$vault = Remove-LabArcVaultKeys -HostAlias $HostAlias -Target $target
switch ($vault.State) {
    'removed' {
        $changes.Add("removed $($vault.Removed -join ', ') from the vault")
        Write-Host "Vault: removed $($vault.Removed -join ', ') from $($target.VaultDirectory)/vault.yml on $HostAlias; every other key is as it was."
    }
    'would-remove' { Write-Host "Vault: would remove $($vault.Removed -join ', ') from $($target.VaultDirectory)/vault.yml on $HostAlias." }
    default { Write-Host "Vault: holds no vault_arc_* key; nothing to remove." }
}
if (-not $WhatIfPreference) {
    $after = Read-LabArcHostState -HostAlias $HostAlias -Target $target
    $still = @(Get-LabArcVaultKeys | Where-Object { $after.VaultKeys[$_].State -ne 'absent' })
    if ($after.Vault -notin 'present', 'missing' -or $still.Count -gt 0) {
        throw "The vault on $HostAlias does not read back without the Arc keys ($($after.Vault); still $($still -join ', ')). Run -Connect again."
    }
}

# 4. The Azure side: the machine, the Azure Monitor Agent, the rule.
$machine = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
    $machine = Get-LabArcArmResource -Url $paths.MachineUrl -What "Reading the machine resource $($target.MachineName)"
    $status = [string](Get-LabProperty -Object (Get-LabProperty -Object $machine -Name 'properties') -Name 'status')
    if ($status -eq 'Connected' -or $attempt -eq 6) {
        break
    }
    Write-Host "  Azure: $($target.MachineName) reads $(if ($status) { $status } else { 'absent' }) so far; reading again in 10 seconds ($attempt of 6)."
    Start-Sleep -Seconds 10
}
$status = [string](Get-LabProperty -Object (Get-LabProperty -Object $machine -Name 'properties') -Name 'status')
if (-not $machine) {
    throw "Azure has no machine resource $($target.MachineName) in $($target.ResourceGroup), though the host says Connected. The host's azcmagent show names the resource it connected to."
}
Write-Host "Azure: $($target.MachineName) is $status."

$agentResult = Confirm-LabArcMonitorAgent -Paths $paths -Target $target
switch ($agentResult.Action) {
    'Unchanged' { Write-Host "Azure: the $($target.ExtensionName) extension is already there ($($agentResult.State))." }
    'Installed' {
        $changes.Add("installed the $($target.ExtensionName) extension")
        Write-Host "Azure: installed the $($target.ExtensionName) extension ($($agentResult.State))."
    }
    'Waited' { Write-Host "Azure: the $($target.ExtensionName) extension is $($agentResult.State)." }
    'WouldInstall' { Write-Host "Azure: would install the $($target.ExtensionName) extension (publisher Microsoft.Azure.Monitor, automatic upgrade on)." }
}
if ($agentResult.State -and $agentResult.State -ne 'Succeeded') {
    Write-Host '  It did not reach Succeeded. Its status message is on the machine''s Extensions page; run -Connect again once it is fixed:'
    Write-Host ''
    Write-Host "  https://portal.azure.com/#@$TenantDomain/resource$($paths.MachineId)/extensions"
}

$rule = Get-LabArcArmResource -Url $paths.RuleUrl -What "Reading the data collection rule $($target.RuleName)"
$associated = $false
if (-not $rule) {
    Write-Host "Azure: the data collection rule $($target.RuleName) does not exist yet; hcw-azure creates it (infra/lab-hybrid.tf). Confirm that run, then run -Connect again to associate it."
}
else {
    $association = Confirm-LabArcRuleAssociation -Paths $paths -Target $target
    switch ($association) {
        'Unchanged' {
            $associated = $true
            Write-Host "Azure: $($target.RuleName) is already associated with $($target.MachineName)."
        }
        'Associated' {
            $associated = $true
            $changes.Add("associated $($target.RuleName)")
            Write-Host "Azure: associated $($target.RuleName) with $($target.MachineName) as $($target.AssociationName)."
        }
        'WouldAssociate' { Write-Host "Azure: would associate $($target.RuleName) with $($target.MachineName)." }
        'Different' { Write-Host "Azure: $($target.AssociationName) exists but names another rule. It was left alone; delete it in the portal and run -Connect again to replace it." }
    }
}

Write-Host ''
if ($WhatIfPreference) {
    Write-Host 'WhatIf: nothing was changed.'
    exit 0
}
foreach ($line in (Get-LabArcReadbackLines -Target $target -SubscriptionName $SubscriptionName)) {
    Write-Host $line
}
Write-Host ''
if ($changes.Count -eq 0) {
    Write-Host 'No changes: the host was Connected, the credential gone, and the agent and the rule association in place.'
}
else {
    Write-Host ('Changed: ' + ($changes -join '; ') + '.')
}
if ($status -eq 'Connected' -and $agentResult.State -eq 'Succeeded' -and $associated) {
    Write-Host "Arc: $($target.MachineName) is Connected in $($target.ResourceGroup), the onboarding secret is gone from Entra and the vault, and the Azure Monitor Agent sends to $($target.RuleName)."
    exit 0
}
Write-Host 'Arc: Connected and the secret removed, but a step above is not finished; it says what to do. -Connect again picks up from there.'
exit 2
