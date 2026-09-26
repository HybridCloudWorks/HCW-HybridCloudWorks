# Labs host — desktop access and Azure Arc onboarding

How to reach the Hostinger lab host from a desktop over SSH and VS Code (the
first section); how to reinstall it, and what the first `bootstrap.sh` run
checks before it changes anything; how the owner reaches Portainer and
initialises and unseals HashiCorp Vault on it (owner decision 2026-09-26);
and how the host becomes an Azure Arc-enabled server in
`rg-lab-hybrid-prod-cus`, sends heartbeat and `auth`/`authpriv` syslog to the
Management workspace, and is audited against the Linux security baseline
(ADR 0032 decision 3, #663; the rest of the page). The shape of the host is
[Labs host](../architecture/labs-host.md); the decisions are
[ADR 0032](../decisions/0032-learner-labs-platform.md).

## Connect from a desktop

`scripts/lab/Connect-Lab.ps1` sets up any desktop to reach the host by the
name `hcw-lab`. It creates a per-machine key, `$HOME\.ssh\hcw-lab_ed25519`,
if there is none; writes one `Host hcw-lab` block into `$HOME\.ssh\config`
after a timestamped backup, leaving every other line alone; loads the key
into `ssh-agent`; and prints the public key with the step that authorizes it.
It never reads or sends the private key, and a second run changes nothing
and says so. It needs PowerShell 7 (`pwsh`, installed by the `winget` line
below) and the OpenSSH client, which Windows 10 and 11 include; on macOS and
Linux it runs under `pwsh` with the same paths under `$HOME`.

VS Code needs the **Remote - SSH** extension, `ms-vscode-remote.remote-ssh`.
PowerShell:

```powershell
code --install-extension ms-vscode-remote.remote-ssh
```

Success prints that the extension was successfully installed, or that it is
already installed. If `pwsh` is not on the machine, PowerShell:

```powershell
winget install --id Microsoft.PowerShell --source winget
```

### Optional: one host name for every desktop

The script points `hcw-lab` at the repository variable `LAB_SSH_HOST` when
`gh` is installed and signed in, and at `lab.hybridcloudworks.com`
otherwise. That record does not exist until the `hcw-lab` apply
(`infra-lab/README.md`, step 5), so until then the variable holds the
server's IPv4 address. This site carries no addresses
([Labs host](../architecture/labs-host.md)), so the command reads it from the
clipboard: copy it from the server's page in hPanel
(https://hpanel.hostinger.com/vps, then **Manage**), then, PowerShell:

```powershell
gh variable set LAB_SSH_HOST -R HybridCloudWorks/HCW-HybridCloudWorks -b (Get-Clipboard -Raw).Trim()
```

Once the record exists, switch the variable to the name, PowerShell:

```powershell
gh variable set LAB_SSH_HOST -R HybridCloudWorks/HCW-HybridCloudWorks -b lab.hybridcloudworks.com
```

Success for either is this printing the value; run the script again on each
desktop afterwards so its block picks the value up:

```powershell
gh variable get LAB_SSH_HOST -R HybridCloudWorks/HCW-HybridCloudWorks
```

### Run it on a machine with the repository

PowerShell, from the repository root on `main` once this change has merged
(`Test-Path scripts/lab/Connect-Lab.ps1` prints `True` when the working tree
has the script):

```powershell
pwsh -NoProfile -File scripts/lab/Connect-Lab.ps1
```

Until the first `bootstrap.sh` run, the host accepts `root` only. For that
window add `-User root`, and run the line above again once bootstrap has
finished and turned root login off:

```powershell
pwsh -NoProfile -File scripts/lab/Connect-Lab.ps1 -User root
```

### Run it on a machine without the repository

PowerShell. This saves a copy of the script from `main` to Downloads, then
runs that copy:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/HybridCloudWorks/HCW-HybridCloudWorks/main/scripts/lab/Connect-Lab.ps1 -OutFile $HOME\Downloads\Connect-Lab.ps1; pwsh -NoProfile -File $HOME\Downloads\Connect-Lab.ps1
```

It is saved rather than piped to `iex` so that what runs is a file you can
open and read first, run as a script with its parameters, where `iex` would
run whatever the URL returned at that moment, unread, inside your current
session. For the root window, run the saved copy again with `-User root`:

```powershell
pwsh -NoProfile -File $HOME\Downloads\Connect-Lab.ps1 -User root
```

### What success looks like

The run that sets a machine up ends with the public key, the ways to
authorize it, and `Changed:` naming what it did. Every later run ends with
`No changes: this machine was already set up for hcw-lab.` To authorize the
key:

- **The first key for the server:** paste the printed line in hPanel at
  https://hpanel.hostinger.com/vps, **Manage** on the server, **Settings**,
  **SSH keys**, **Add SSH key**. hPanel installs it as a key for root, and
  the first `bootstrap.sh` run copies root's keys to `hcwadmin`
  (`infra-lab/README.md`, steps 6 and 7).
- **Another desktop, once one already connects:** run the one line the
  script printed on the machine that already connects. It adds the key for
  the login user, which works at once, and for root, which is what lasts:
  the hardening role rebuilds `hcwadmin`'s `authorized_keys` from root's on
  every `bootstrap.sh` run, so a key only in `hcwadmin`'s file is gone after
  the next one.

Then this prints the server's host name, PowerShell:

```powershell
ssh hcw-lab hostname
```

The first connection asks you to accept the host key. Its fingerprint can be
read from the host itself in the Web Console (below), bash, on the host; the
`SHA256:` value must match the one `ssh` shows:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

To open the repository checkout on the host in VS Code (it exists after the
first `bootstrap.sh` run), PowerShell; the script's `-Code` switch does the
same after setup, and `-Connect` opens a shell:

```powershell
code --remote ssh-remote+hcw-lab /opt/hcw-src
```

Windows ships the `ssh-agent` service disabled, and the script says so
rather than changing it. Without the agent everything still works, and each
connection asks for the key's passphrase. To turn it on, run this once in
PowerShell opened with **Run as administrator**, then run the script again:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic; Start-Service -Name ssh-agent
```

An OS reinstall gives the host a new host key, and `ssh` then refuses with
`REMOTE HOST IDENTIFICATION HAS CHANGED`. This removes the old entry for
whatever `hcw-lab` points at, PowerShell:

```powershell
ssh-keygen -R (ssh -G hcw-lab | Select-String -Pattern '^hostname (.+)$').Matches[0].Groups[1].Value
```

The site itself never tunnels into the host: under ADR 0032 the host
accepts inbound 22, 80 and 443 only, and the site's one view of it is the read-only
status proxy in the Function App ([Labs host, Exposure](../architecture/labs-host.md#exposure)).
SSH from a desktop is the only shell. When SSH is not working, hPanel's
**Web Console** is the browser fallback: https://hpanel.hostinger.com/vps,
**Manage** on the server, then **Web Console** on its overview. It usually
signs in by itself; when it asks, Hostinger's instructions are `root` and
the root password.

## The first-run host check

`lab-host/bootstrap.sh` configures only a host that was prepared for it. On
2026-09-26 its first run met a VPS that had never been reinstalled: two
self-hosted GitHub Actions runners, Portainer, an nginx site on port 80,
k3s, Vault and an old install of the agent. Before failing, that run
upgraded and restarted Docker, which killed a running Dependabot job,
enabled ufw and rewrote sshd's settings. So on a host it has never
accepted, the script now looks for other workloads before it changes
anything, and stops if it finds one:

- any Docker container, running or stopped;
- an installed `actions.runner.*` systemd unit (a self-hosted runner);
- Kubernetes: a `k3s`, `k0s`, `rke2`, `kubelet` or `microk8s` unit, or
  `/usr/local/bin/k3s`, `/etc/rancher`, `/var/lib/rancher`,
  `/etc/kubernetes`, `/var/lib/kubelet`;
- `/opt/hcw-src` or `/opt/hcw-labs-agent` holding anything but a checkout of
  this repository;
- anything else under `/opt`;
- a TCP listener other than sshd on 22 and systemd-resolved on
  `127.0.0.53:53` and `127.0.0.54:53`.

A refusal ends with exit code 3 and changes nothing. On a copy of the
2026-09-26 host (Docker from Docker's repository, and stand-ins for each
workload, in an Ubuntu 26.04 test container) the step-7 line printed:

```text
[bootstrap] host check: this host has not run bootstrap.sh before; looking for other workloads first
[bootstrap] refusing to configure this host: it shows signs of other workloads, and bootstrap.sh has never run here (no /etc/hcw/bootstrap-host-accepted).
[bootstrap] found:
[bootstrap]   - Docker container old-nginx (busybox:1.37, Up 15 seconds)
[bootstrap]   - Docker container old-portainer (busybox:1.37, Up 16 seconds)
[bootstrap]   - systemd unit actions.runner.example-org-example-repo.runner-1.service (enabled): a GitHub Actions self-hosted runner
[bootstrap]   - systemd unit actions.runner.example-org-example-repo.runner-2.service (enabled): a GitHub Actions self-hosted runner
[bootstrap]   - systemd unit k3s.service (enabled): Kubernetes
[bootstrap]   - /etc/rancher exists: Kubernetes
[bootstrap]   - /opt/hcw-labs-agent exists and is not a checkout of https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git
[bootstrap]   - /opt/actions-runner: not created by this repository
[bootstrap]   - /opt/containerd: not created by this repository
[bootstrap]   - TCP listener on 127.0.0.1:8200 (python3)
[bootstrap]   - TCP listener on 0.0.0.0:80 (docker-proxy)
[bootstrap]   - TCP listener on [::]:80 (docker-proxy)
[bootstrap] nothing has been changed. A run would move Docker to its pinned version and restart it, enable ufw with only TCP 22, 80 and 443 open, and replace sshd's login settings, whatever the workloads above need.
[bootstrap] either reinstall the server with Ubuntu 26.04 LTS and run this again (docs/runbooks/labs-host.md, "Reinstalling the host"),
[bootstrap] or, only if every item above is meant to stay and may be disrupted, accept the host knowingly:
[bootstrap]   HCW_ADOPT_NONEMPTY_HOST=1 /opt/hcw-src/lab-host/bootstrap.sh
```

The way on is the reinstall below. The other, for a host whose workloads
are meant to stay, is the last line of the refusal, bash, on the host, as
root:

```bash
HCW_ADOPT_NONEMPTY_HOST=1 /opt/hcw-src/lab-host/bootstrap.sh
```

The first run that passes writes `/etc/hcw/bootstrap-host-accepted` before
its first change, and every run that finishes adds its commit and time.
While the file exists, later runs print `host check: skipped` and do not
look again, so a first run that fails half-way can simply be re-run.
Success on a clean host is these three lines at the top of the first run:

```text
[bootstrap] host check: this host has not run bootstrap.sh before; looking for other workloads first
[bootstrap] host check: no other workloads found
[bootstrap] host check: recorded in /etc/hcw/bootstrap-host-accepted
```

## Reinstalling the host

Owner decision 2026-09-26: the VPS is reinstalled clean, and nothing on it
is exported, because nothing on it was production. The same procedure
applies whenever the host check refuses or the host is compromised or broken:
ADR 0032 rebuilds the host rather than repairing it.

1. **Before wiping.** If the host is Connected to Azure Arc, delete its
   machine resource first ("Re-onboarding a rebuilt host", below). If the
   old host ran self-hosted GitHub Actions runners, remove their
   registrations where they were registered, or GitHub keeps them as
   offline runners. This repository's list is
   `https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/actions/runners`
   and the organisation's is
   `https://github.com/organizations/HybridCloudWorks/settings/actions/runners`;
   both were empty on 2026-09-26.
2. **Reinstall.** At https://hpanel.hostinger.com/vps, **Manage** on the
   server, then **OS & Panel**, **Operating System**: choose plain **Ubuntu
   26.04**, not a template that adds Docker, a control panel or an
   application, because the host check refuses anything those leave in
   `/opt` or running.
   Give root your SSH key there (the key `scripts/lab/Connect-Lab.ps1`
   printed; `infra-lab/README.md`, step 6). Reinstalling wipes the disk: the
   Ansible vault on the host, Portainer's data and Vault's data go with it.
3. **The workspace variable.** If the `hcw-lab` workspace exists, its
   `hostinger_template_id` must match the new install, or its next plan stops
   at the postcondition. Read the new value with the line in
   `infra-lab/README.md`, step 1, and set it at
   `https://app.terraform.io/app/hcw/workspaces/hcw-lab/variables`.
4. **Forget the old host key**, on every desktop that connected before. A
   reinstall gives the host new SSH host keys, and `ssh` refuses the new ones
   with `REMOTE HOST IDENTIFICATION HAS CHANGED` until the old entries are
   gone. PowerShell, by name:

   ```powershell
   ssh-keygen -R lab.hybridcloudworks.com
   ```

   And whatever `hcw-lab` points at, which is the server's address while
   `LAB_SSH_HOST` holds it (this page carries no addresses), PowerShell:

   ```powershell
   ssh-keygen -R (ssh -G hcw-lab | Select-String -Pattern '^hostname (.+)$').Matches[0].Groups[1].Value
   ```

   Success for each is `found` and `updated` for a name that was known, or
   `not found` for one that was not; both are fine.
5. **Connect as root**, PowerShell, from the repository root:

   ```powershell
   pwsh -NoProfile -File scripts/lab/Connect-Lab.ps1 -User root
   ```

   ```powershell
   ssh hcw-lab hostname
   ```

   Accept the new host key after comparing its fingerprint with the one the
   Web Console shows ("Connect from a desktop", above). Success is the
   server's host name.
6. **First run**: `infra-lab/README.md`, step 7. Success is `host check: no
   other workloads found` near the top (above) and a `PLAY RECAP` for
   `localhost` with `failed=0`. Then run `Connect-Lab.ps1` again without
   `-User root`, because root login is now off.
7. **Everything the disk held, again.** Create the Ansible vault and its
   password (`lab-host/README.md`, "The vault"), rotating the values marked
   "rotate on every host rebuild" in
   [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed)
   (the Caddy DNS token and the Coder GitHub OAuth secret). The agent's key
   pair is new, so upload the new certificate (`lab-host/README.md`, "The
   agent identity"). Re-onboard Arc ("Re-onboarding a rebuilt host", below).
   Portainer gets a new administrator and its licence key (below). Vault is
   new and uninitialised: initialise it (below), and delete the old unseal
   keys and root token from the password manager, because they open nothing
   now.

## Portainer through an SSH tunnel

Portainer Business Edition runs for the owner only (owner decision
2026-09-26). It holds the Docker socket, which is root on the host, so it is
published on the host's `127.0.0.1:9443` and nowhere else, with no Caddy
route, and the way to it is an SSH tunnel. Whoever can open the tunnel
already has an SSH login, which carries `sudo`.

It is off until a pull request sets `portainer_enabled: true` in
`lab-host/ansible/group_vars/all.yml` and `bootstrap.sh` runs after the
merge. Success for that run is a `PLAY RECAP` with `failed=0` and the task
`portainer : Say how to reach Portainer` printing `Portainer 2.45.1 answers
on https://127.0.0.1:9443 on this host and nowhere else`.

**The first sign-in.** Two guards stand in front of a fresh Portainer, and
both were measured on the pinned 2.45.1 on 2026-09-26. Until an
administrator exists it stops serving five minutes after it starts: the
container stays up and every request answers `Administrator initialization
timeout`. And creating the administrator needs a one-time **setup token**
that Portainer prints in its log at every start; without it the setup
screen is refused. So open the tunnel first, then restart Portainer and read
the token from inside it. PowerShell, on the desktop; this opens a shell on
the host and the tunnel together, and the tunnel lasts as long as that
shell:

```powershell
ssh -L 9443:127.0.0.1:9443 hcw-lab
```

Bash, in that shell on the host; this opens a new five minutes:

```bash
sudo docker restart portainer
```

Bash, in the same shell; this prints the token of the start that line just
made, as one `setup_token=` line:

```bash
sudo docker logs portainer 2>&1 | grep setup_token | tail -n 1
```

Then open https://localhost:9443 on the desktop. The browser warns about the
certificate, which Portainer generated for itself; for this address that
warning is expected. Paste the value after `setup_token=` where the setup
screen asks for it. The token is good for this one start and is not kept
anywhere. Create the administrator with a password from the password manager,
at least 12 characters (an 11-character one was refused), and keep it there
only. Business Edition then asks for its licence key: the 3 Nodes Free key
Portainer issued. Until a key is entered it reports the licence as not
valid. The key from the pre-reinstall server may be reused, because that
server no longer runs it, and https://www.portainer.io/take-3 issues a new
one. The key goes into this page only, never into the repository or the
Ansible vault. Portainer then offers its environment wizard, where **Get
Started** adds this host's Docker, through the socket, as the environment
`local`; no environment exists before that.

Success is Portainer's **Home** page listing `local`, **Docker Standalone**,
**Up**, whose containers include `portainer`. If the page says the instance
timed out, the five minutes passed first: run the restart line and the token
line again, in the same shell, and use the new token. Once the administrator
exists there is no timeout and no token, and later visits need only the
tunnel line.

## HashiCorp Vault: initialising and unsealing

HashiCorp Vault runs host-native on `127.0.0.1:8200` (owner decision
2026-09-26). **It holds lab-host secrets only.** This host runs learner
workloads, and an escape from a workspace or a job container is root on the
host, which can read an unsealed Vault's memory. So no production
HybridCloudWorks secret is ever put in it: those stay in Azure Key Vault
`kv-site-prod-cus-01`. Nor anything that exists nowhere else, because the
host holds no data of record; every value in it must be one its issuer can
issue again.

It is off until a pull request sets `vault_enabled: true` in
`lab-host/ansible/group_vars/all.yml` and `bootstrap.sh` runs after the
merge. Success for that run is `failed=0` and the task `vault : Say what
state Vault is in` printing `It is not initialised`. The role never
initialises or unseals Vault. Both are the steps below, and the keys they
produce go to the owner's password manager, never to the repository, a
log, an issue, a chat or the Ansible vault.

**Initialise, once.** PowerShell, on the desktop; an interactive login,
because the login shell is what sets `VAULT_ADDR` and `VAULT_CACERT`:

```powershell
ssh hcw-lab
```

Bash, on the host:

```bash
vault status
```

Success is `Initialized false` and `Sealed true`, with exit code 2, which is
what a sealed Vault returns. Then:

```bash
vault operator init -key-shares=5 -key-threshold=3
```

It prints `Unseal Key 1:` to `Unseal Key 5:` and `Initial Root Token:`
once, and Vault keeps no copy: without three of the five keys it stays
sealed for good. Copy each of the six values into the password manager as
it is printed. Success is the line `Vault initialized with 5 key shares and
a key threshold of 3.` Then clear the screen and the terminal's scrollback,
bash, on the host:

```bash
clear && printf '\033[3J'
```

**Unseal, after initialising and after every restart or reboot.** A restart
seals Vault, and so does every reboot, including the unattended-upgrades
reboot at 04:30; until three keys are entered it serves nothing. Bash, on the
host, three times, pasting a different key at each `Unseal Key (will be
hidden):` prompt:

```bash
vault operator unseal
```

It takes no argument on purpose, so no key reaches the shell's history.
Success is `Unseal Progress 1/3`, then `2/3`, then `Sealed false`; `vault
status` then shows `Initialized true`, `Sealed false` and `HA Mode active`.
Rehearsed on 2026-09-26 in a test container with Vault 2.1.1: exactly that
sequence, raft's cluster port opening on `127.0.0.1:8201` only after the
unseal, and `Sealed true` again after `systemctl restart vault`. Auto-unseal
through Azure Key Vault and the Arc machine's identity would remove this
step; it is
[#726](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/726),
not built.

**The root token.** `vault login` prompts for it, hidden, and writes it to
`~/.vault-token`. Use it for what the host needs, then remove that file with
`rm ~/.vault-token`. Once another way in exists, revoke the root token with
`vault token revoke -self`; a new one takes three unseal keys and `vault
operator generate-root`.

## Arc onboarding

**State: not yet run.** The Terraform half is in `infra/lab-hybrid.tf` and the
host half is the `arc` role in `lab-host/ansible/`, off by default. Every step
below is an owner step. When the read-back in step 7 first returns Connected,
change the Arc rows in [Labs host](../architecture/labs-host.md) and the Arc
rows of [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed)
in the same pull request.

## What each side owns

| Piece | Where | Created by |
| --- | --- | --- |
| Resource group `rg-lab-hybrid-prod-cus` | `infra/lab-hybrid.tf` | `hcw-azure` apply |
| Data collection rule `dcr-lab-hybrid-prod-cus`: heartbeat, `auth`/`authpriv` syslog at Info and above, into `log-plat-prod-cus-01` | `infra/lab-hybrid.tf` | `hcw-azure` apply |
| Onboarding service principal `sp-arc-onboarding-lab-hybrid-prod-cus` | Entra | The owner, step 2 (the run identity has no Entra role) |
| Its only grant, Azure Connected Machine Onboarding on the group | `infra/lab-hybrid.tf`, once `arc_onboarding_principal_id` is set | `hcw-azure` apply, step 4 |
| Audit-only Linux baseline assignment `audit-linux-baseline-lab-hybrid` | `infra/lab-hybrid.tf`, once `lab_hybrid_policy_enabled` is true | `hcw-azure` apply, step 4 |
| Arc machine `arcs-lab-hybrid-prod-cus-01` | Azure, created by `azcmagent connect` | The `arc` role, step 6 |
| Azure Monitor Agent extension and the rule's association to the machine | Azure | The owner, step 8 (neither can exist before the machine does) |

Defender for Servers stays off. Nothing here, in Terraform or on the host,
enables it.

## Before you start

- This change is merged to `main`, and the host has been provisioned and has
  run `bootstrap.sh` at least once (`lab-host/README.md`, "First run").
- The host runs Ubuntu 26.04 LTS on x86-64 (owner decision 2026-09-26).
  Microsoft Learn lists Ubuntu 26.04 on x86-64 (not Arm64) as supported for
  [Arc-enabled servers](https://learn.microsoft.com/azure/azure-arc/servers/prerequisites#supported-operating-systems)
  and Ubuntu 26.04 LTS as supported by the
  [Azure Monitor Agent](https://learn.microsoft.com/azure/azure-monitor/agents/azure-monitor-agent-supported-operating-systems),
  both read 2026-09-26, so there is no support gap for steps 6 to 10. The
  `arc` role installs `azcmagent` from `packages.microsoft.com/ubuntu/26.04/prod`,
  which Microsoft signs with `microsoft-2025.asc` rather than the older
  `microsoft.asc`; the role picks the key, and its pinned checksum, by
  release. On 2026-09-26 the role installed and held `azcmagent
  1.68.03532.1399` on a systemd Ubuntu 26.04 container and failed closed on
  the missing vault values, which is what step 6 does if step 5 was skipped.
- Run the PowerShell steps in **one** PowerShell window: later steps reuse
  `$sp`, `$rgId` and the other values the earlier ones compute. If the window
  is closed, the step that needs a value says how to recompute it.
- Every `az` step starts by signing in to the tenant. Run it once per window;
  a browser opens:

```powershell
az login --tenant saulpatinojrhotmail.onmicrosoft.com
```

## 1. Confirm the merge run in hcw-azure

The merge creates a run that stops at **planned** at
`https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs`. Every plan in
this workspace carries the permanent apply-cycle diff (the
`RUNTIME_CONFIG_WRITER` change and three `azapi_*` replacements,
`infra/functionapp.tf`), so the counts below include it.

- Expected: **`Plan: 4 to add, 1 to change, 3 to destroy`**. The one real
  line is `azurerm_monitor_data_collection_rule.lab_hybrid will be created`.
- If `rg-lab-hybrid-prod-cus` has never been applied (the #664 change),
  expect **`Plan: 6 to add, 1 to change, 3 to destroy`**: the rule plus
  `azurerm_resource_group.lab_hybrid` and
  `azurerm_role_assignment.func_lab_hybrid_reader`.

Anything else is not this change; stop and read the plan. Confirm and apply.
Then check the group exists; success prints `true`:

```powershell
az group exists -n rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus
```

## 2. Create the onboarding service principal

With no role: the grant is Terraform's, in step 4, so it is reviewed and
scoped to the one group. The secret lasts a year and is deleted in step 9 in
any case.

```powershell
$sp = az ad sp create-for-rbac --name sp-arc-onboarding-lab-hybrid-prod-cus --years 1 -o json | ConvertFrom-Json
```

```powershell
$spObjectId = (az ad sp show --id $sp.appId -o json | ConvertFrom-Json).id
```

```powershell
$spObjectId
```

Success is one GUID. That is the **object id**, the value Terraform needs;
`$sp.appId` is a different GUID and is the one `azcmagent` needs in step 5.
Swapping them fails only at apply, as `PrincipalNotFound`. `create-for-rbac`
prints a warning about protecting the credential; it has created no role
assignment, which this line confirms by printing nothing:

```powershell
az role assignment list --assignee $sp.appId --all -o json | ConvertFrom-Json | Select-Object roleDefinitionName, scope
```

## 3. Let the run identity write the policy assignment

The Terraform run identity, `id-plat-terraform-prod-cus-01`, is Contributor
plus Role Based Access Control Administrator. Neither can write a policy
assignment (Contributor excludes `Microsoft.Authorization/*/Write`), and
Terraform does not grant itself one. Grant **Resource Policy Contributor** on
this group only; never on the subscription, where the IaC repository standard
forbids a workload repository assigning policy.

```powershell
$rgId = (az group show -n rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus -o json | ConvertFrom-Json).id
```

```powershell
$tfObjectId = (az ad sp list --display-name id-plat-terraform-prod-cus-01 -o json | ConvertFrom-Json).id
```

```powershell
az role assignment create --assignee-object-id $tfObjectId --assignee-principal-type ServicePrincipal --role "Resource Policy Contributor" --scope $rgId -o none
```

Read back; success is exactly one row, `Resource Policy Contributor`, with a
scope ending `/resourceGroups/rg-lab-hybrid-prod-cus`:

```powershell
az role assignment list --assignee $tfObjectId --scope $rgId -o json | ConvertFrom-Json | Select-Object roleDefinitionName, scope
```

## 4. Set the two workspace variables and apply

At `https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables`, add two
**Terraform** variables (not environment variables), neither sensitive:

| Key | Value | HCL |
| --- | --- | --- |
| `arc_onboarding_principal_id` | the GUID step 2 printed (`$spObjectId`) | off |
| `lab_hybrid_policy_enabled` | `true` | on |

Then start a run from `https://app.terraform.io/app/hcw/workspaces/hcw-azure`
with **New run**, type **Plan and apply**.

- Expected: **`Plan: 5 to add, 1 to change, 3 to destroy`**. The two real
  lines are `azurerm_role_assignment.arc_onboarding[0] will be created` and
  `azurerm_resource_group_policy_assignment.lab_hybrid_linux_baseline[0] will
  be created`.

Confirm and apply. An apply that fails with `AuthorizationFailed` on
`policyAssignments/write` means step 3 has not replicated yet or was scoped
elsewhere; re-run the step 3 read-back, wait a minute, and start another run.

Read back the grant; success is one row, `Azure Connected Machine
Onboarding`, scoped to the group:

```powershell
az role assignment list --assignee $sp.appId --scope $rgId -o json | ConvertFrom-Json | Select-Object roleDefinitionName, scope
```

And the assignment; success is one row, `audit-linux-baseline-lab-hybrid`,
`Default`:

```powershell
az policy assignment list -g rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus -o json | ConvertFrom-Json | Select-Object name, enforcementMode
```

`Default` enforcement on an `AuditIfNotExists` definition still changes
nothing on the host: the effect only reports.

## 5. Seed the vault

The four values, printed in the PowerShell window. They are shown on screen
once; copy each into the vault in the next command and do not paste them
anywhere else.

```powershell
$sp.appId
```

```powershell
$sp.password
```

```powershell
$sp.tenant
```

```powershell
(az account show --subscription sub-app-site-prod-cus -o json | ConvertFrom-Json).id
```

The vault is `/etc/hcw/ansible/vault.yml` on the host, encrypted with the
password in `/etc/hcw/ansible/vault-password`, which is root-only on the host
and nowhere else (`lab-host/README.md`, "The vault"). Bash, on the host, as
`hcwadmin`:

```bash
sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

Add four keys, one per line, in the order printed above:

| Key | Value |
| --- | --- |
| `vault_arc_service_principal_id` | `$sp.appId` |
| `vault_arc_service_principal_secret` | `$sp.password` |
| `vault_arc_tenant_id` | `$sp.tenant` |
| `vault_arc_subscription_id` | the subscription id |

If the vault does not exist yet, `lab-host/README.md`, "The vault", creates
it; use `create` in place of `edit`.

## 6. Enable the role and run the playbook

In a pull request, set `arc_enabled: true` in
`lab-host/ansible/group_vars/all.yml`, merge it, and re-run the playbook.
The run checks out the merged `main` and prints its sha, the same as for
any other lab-host change (`lab-host/README.md`, "Re-running"); there is no
pin to move. Bash, on the host:

```bash
sudo /opt/hcw-src/lab-host/bootstrap.sh
```

Success is a `PLAY RECAP` for `localhost` with `failed=0`, and the task
`arc : Assert the agent reports Connected` printing
`Connected to Azure Arc as arcs-lab-hybrid-prod-cus-01 in rg-lab-hybrid-prod-cus.`
On the host, bash:

```bash
sudo /opt/azcmagent/bin/azcmagent show
```

prints `Agent Status : Connected`, `Resource Name : arcs-lab-hybrid-prod-cus-01`
and `Resource Group Name : rg-lab-hybrid-prod-cus`.

The play refuses to continue, before connecting, if any of the four vault
keys is missing or if the application, tenant or subscription id is not a
GUID. A connect that fails prints `azcmagent`'s own reason; `AZCM0041` with
`invalid_client` is a wrong secret or appId, `AuthorizationFailed` is a grant
that step 4 has not applied.

## 7. Read back Connected

PowerShell:

```powershell
az account set --subscription sub-app-site-prod-cus
```

```powershell
az connectedmachine list -g rg-lab-hybrid-prod-cus -o json | ConvertFrom-Json | Select-Object name, status, agentVersion, osName
```

Success is **one row**: `arcs-lab-hybrid-prod-cus-01`, `status` **Connected**,
`agentVersion` `1.68.03532.1399` (the pin in `group_vars/all.yml`), `osName`
`linux`. The first `az connectedmachine` command offers to install the
`connectedmachine` CLI extension; accept it. No rows means connect did not
run or targeted another group; `Disconnected` or `Expired` means the agent
has stopped reaching Azure (see "Troubleshooting" below).

## 8. Install the Azure Monitor Agent and associate the rule

Both are Azure-side operations on the machine, which is why neither is in
Terraform: the machine did not exist when the rule was applied. Both are
needed. Associating a rule from the CLI does not install the agent (only the
portal's rule wizard does both), and an agent with no associated rule
collects nothing.

```powershell
az connectedmachine extension create --name AzureMonitorLinuxAgent --publisher Microsoft.Azure.Monitor --type AzureMonitorLinuxAgent --machine-name arcs-lab-hybrid-prod-cus-01 --resource-group rg-lab-hybrid-prod-cus --location centralus --enable-auto-upgrade true
```

```powershell
$dcrId = (az monitor data-collection rule show -g rg-lab-hybrid-prod-cus -n dcr-lab-hybrid-prod-cus -o json | ConvertFrom-Json).id
```

```powershell
$machineId = (az connectedmachine show -g rg-lab-hybrid-prod-cus -n arcs-lab-hybrid-prod-cus-01 -o json | ConvertFrom-Json).id
```

```powershell
az monitor data-collection rule association create --name dcra-lab-hybrid-prod-cus --rule-id $dcrId --resource $machineId -o none
```

The first `az monitor data-collection` command offers to install the
`monitor-control-service` extension; accept it. Read back the extension;
success is one row, `AzureMonitorLinuxAgent`, `Succeeded`:

```powershell
az connectedmachine extension list -g rg-lab-hybrid-prod-cus --machine-name arcs-lab-hybrid-prod-cus-01 -o json | ConvertFrom-Json | Select-Object name, provisioningState
```

And the association; success is one row, `dcra-lab-hybrid-prod-cus`:

```powershell
az monitor data-collection rule association list --resource $machineId -o json | ConvertFrom-Json | Select-Object name
```

## 9. Remove the onboarding secret

The credential is used once (ADR 0032: never on the host after onboarding).
The `arc` role does not need it on a Connected host, so remove it from both
places. Bash, on the host; delete the four `vault_arc_*` lines and save:

```bash
sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

Then the secret itself, PowerShell. If the window from step 2 is gone, the
first line recomputes the appId from the principal's name:

```powershell
$appId = (az ad sp list --display-name sp-arc-onboarding-lab-hybrid-prod-cus -o json | ConvertFrom-Json).appId
```

```powershell
$keyId = (az ad app credential list --id $appId -o json | ConvertFrom-Json).keyId
```

```powershell
az ad app credential delete --id $appId --key-id $keyId
```

Success is this printing nothing:

```powershell
az ad app credential list --id $appId -o json | ConvertFrom-Json | Select-Object keyId, endDateTime
```

The principal and its grant stay: without a credential they cannot be used,
and re-onboarding (below) needs only a new secret. A re-run of
`bootstrap.sh` afterwards still reports `failed=0`, because the role checks
Connected before it looks for the vault values.

## 10. Confirm the heartbeat, the syslog and the compliance state

The Management workspace is read by its customer id, computed here:

```powershell
$wsId = (az monitor log-analytics workspace show -g rg-mgmt-plat-prod-cus -n log-plat-prod-cus-01 --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json).customerId
```

```powershell
az monitor log-analytics query --workspace $wsId --analytics-query "Heartbeat | where TimeGenerated > ago(15m) | where _ResourceId contains 'arcs-lab-hybrid-prod-cus-01' | summarize beats = count(), latest = max(TimeGenerated) by Computer, Category" -o table
```

Success is one row, `Category` `Azure Monitor Agent`, with `beats` near 15:
the agent writes one a minute to every workspace an associated rule names.
Allow ten minutes after step 8 for the first. The syslog, allowing an hour
for an SSH login to have happened:

```powershell
az monitor log-analytics query --workspace $wsId --analytics-query "Syslog | where TimeGenerated > ago(1h) | where _ResourceId contains 'arcs-lab-hybrid-prod-cus-01' | summarize count() by Facility" -o table
```

Success is rows for `auth` and/or `authpriv` and **no other facility**; a
third facility means the rule has been changed outside Terraform.

The compliance state. The first evaluation of a machine-configuration
assignment can take several hours; this asks for one now:

```powershell
az policy state trigger-scan -g rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus --no-wait
```

```powershell
az policy state list -g rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus -o json | ConvertFrom-Json | Select-Object policyAssignmentName, complianceState, timestamp
```

Success is a row for `audit-linux-baseline-lab-hybrid` whose
`complianceState` is `Compliant` or `NonCompliant`. Either is a result: the
assignment audits and never remediates, and a `NonCompliant` host lists its
failing baseline rules at
`https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Compliance`
under that assignment. No row yet means the evaluation has not run.

**Done when** step 7 shows one Connected row, the Heartbeat query returns the
host, and the compliance query shows a state for it (the #663 acceptance).

## Disconnecting

Disconnecting deletes the machine resource, and with it the rule
association and the guest assignment the policy created. Do it in this
order, or the next playbook run fails closed looking for a credential that
step 9 deleted.

1. In a pull request, set `arc_enabled: false` in
   `lab-host/ansible/group_vars/all.yml`, merge it and re-run the playbook
   (step 6). With the switch off, the role touches nothing.
2. Remove the agent extension, then the machine resource. PowerShell; each
   asks for confirmation:

   ```powershell
   az connectedmachine extension delete --name AzureMonitorLinuxAgent --machine-name arcs-lab-hybrid-prod-cus-01 -g rg-lab-hybrid-prod-cus
   ```

   ```powershell
   az connectedmachine delete -g rg-lab-hybrid-prod-cus -n arcs-lab-hybrid-prod-cus-01
   ```

3. Reset the agent on the host. `--force-local-only` because the Azure
   resource is already gone and the onboarding principal cannot delete one
   (its role has no delete). Bash, on the host:

   ```bash
   sudo /opt/azcmagent/bin/azcmagent disconnect --force-local-only
   ```

Success: the step 7 read-back returns no rows, and
`sudo /opt/azcmagent/bin/azcmagent show` on the host prints
`Agent Status : Disconnected`. The package stays installed and held; remove
it with `sudo apt-mark unhold azcmagent && sudo apt-get purge -y azcmagent`
(bash, on the host) only if the host is leaving Arc for good.

## Re-onboarding a rebuilt host

A rebuilt host has a new agent identity, and a machine resource of the same
name blocks it. Delete the old resource first (step 2 of "Disconnecting"),
then mint a new secret for the existing principal, PowerShell:

```powershell
$appId = (az ad sp list --display-name sp-arc-onboarding-lab-hybrid-prod-cus -o json | ConvertFrom-Json).appId
```

```powershell
$sp = az ad app credential reset --id $appId --years 1 -o json | ConvertFrom-Json
```

`$sp.appId`, `$sp.password` and `$sp.tenant` now hold the values for step 5;
continue from step 5 and finish with step 9.

## Troubleshooting

- **`Expired`** in step 7: the agent has not reached Azure for 45 days and its
  identity certificate is gone. Disconnect ("Disconnecting", all three
  steps) and re-onboard.
- **`Disconnected`** in step 7 with the agent running: outbound 443 to Azure
  is blocked somewhere. Bash, on the host:
  `sudo /opt/azcmagent/bin/azcmagent check --location centralus` names the
  endpoint that fails.
- **No Heartbeat rows** with the extension `Succeeded`: the association is
  missing (re-run the step 8 association read-back), or the rule and the
  workspace are in different regions. Both are `centralus` by construction:
  the rule takes the workspace's location in `infra/lab-hybrid.tf`.
