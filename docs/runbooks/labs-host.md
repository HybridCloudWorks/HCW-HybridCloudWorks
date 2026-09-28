# Labs host — desktop access and Azure Arc onboarding

How to reach the Hostinger lab host from a desktop over SSH and VS Code (the
first section); how to reinstall it, and what the first `bootstrap.sh` run
checks before it changes anything; how the lab agent goes live, which is one
PowerShell line; how the owner reaches Portainer and
initialises and unseals HashiCorp Vault on it (owner decision 2026-09-26);
and how the host becomes an Azure Arc-enabled server in
`rg-lab-hybrid-prod-cus`, sends heartbeat and `auth`/`authpriv` syslog to the
Management workspace, and is audited against the Linux security baseline,
which is two runs of one PowerShell script with one `hcw-azure` run between
them (ADR 0032 decision 3, #663; the rest of the page). The shape of the host is
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
   other workloads found` near the top (above), and, because there is no
   vault yet and Coder is on (since 2026-09-28), a `PLAY RECAP` for
   `localhost` with `failed=1` at `coder : Refuse to enable Coder without
   its three vault secrets`. Every role before it has run, so root login is
   off and `hcw-vault-set` is installed; the re-run in step 7 finishes the
   rest. Run `Connect-Lab.ps1` again without `-User root`.
7. **Everything the disk held, again.** Create the Ansible vault's
   password and set its keys (`lab-host/README.md`, "The vault"), rotating
   the values marked "rotate on every host rebuild" in
   [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed)
   (the Caddy DNS token and the Coder GitHub OAuth secret). Then re-run
   `bootstrap.sh`, which now ends with `failed=0`. The agent's key
   pair is new, and the vault that held its four keys is gone, so run "The
   lab agent's go-live" (below) again: it appends the new certificate and
   writes the four keys back. Re-onboard Arc ("Re-onboarding a rebuilt host", below).
   Portainer gets a new administrator and its licence key (below). Vault is
   new and uninitialised: initialise it (below), and delete the old unseal
   keys and root token from the password manager, because they open nothing
   now.
8. **Retire the old agent record.** If the go-live registered the rebuilt
   host under a new agent id, the old id's card stays on
   https://hybridcloudworks.com/admin/labs?tab=agents, Offline, until it is
   removed: the 2026-09-26 reinstall left `srv939861` beside
   `vps-hostinger-01`. **Deactivate** it if it is still active, then
   **Remove** and confirm. Success is the old card gone and the new agent
   still Online. The API refuses an active agent, and one still holding a
   job claimed in the last 15 minutes; the removal is audited as
   `lab_agent_removed`. If the host came back under the same agent id, there
   is nothing to retire: the go-live re-bound that record.

## The lab agent's go-live

The agent (`vps-agent`, the `labs_agent` role) is installed by the first
`bootstrap.sh` run and stays stopped until it has an identity: an Entra app
registration holding its certificate and the `LabAgent` app role, a
`lab_agents` registry document binding it to that identity, and four values
in the host's Ansible vault. `scripts/lab/Register-LabAgent.ps1` does all of
it in one run, as the owner, on the workstation, with one paste in the
browser for the registry document (step 4). The owner-created Entra objects
are deliberate: this repository has no `azuread` Terraform provider
(`infra/oidc.tf`, `infra/lab-hybrid.tf`).

**Before you start.** The host has run `bootstrap.sh` at least once, so
`/etc/hcw/labs-agent.crt` exists; this desktop reaches it
(`ssh hcw-lab hostname` prints its name, "Connect from a desktop", above);
`/etc/hcw/ansible/vault-password` exists on the host (`lab-host/README.md`,
"The vault"; `vault.yml` itself may or may not exist yet); you can
create app registrations and assign app roles in the tenant (Application
Administrator, Cloud Application Administrator or Global Administrator);
and you can sign in to https://hybridcloudworks.com/admin as an editor or
above, for step 4. Sign in to `az`, PowerShell; a browser opens:

```powershell
az login --tenant saulpatinojrhotmail.onmicrosoft.com
```

Then, PowerShell, from the repository root on `main` once this change has
merged (`Test-Path scripts/lab/Register-LabAgent.ps1` prints `True` when the
working tree has the script):

```powershell
pwsh -NoProfile -File scripts/lab/Register-LabAgent.ps1
```

Adding `-WhatIf` to that line shows what it would change and changes
nothing: step 4 prints what it would ask for without waiting, the vault
merge runs in check mode on the host, and `bootstrap.sh` does not run.

**What it does**, printing one line per step:

1. Checks `az` is signed in to `saulpatinojrhotmail.onmicrosoft.com`, and
   stops with the `az login` line above when it is not.
2. Reads `/etc/hcw/labs-agent.crt` over `ssh hcw-lab` into a temporary file
   on the desktop, deleted after step 3. It is the public certificate; the
   host checks it against the private key in `labs-agent.pem` and reports
   only whether they match, so the key never leaves the host. The
   certificate's CN is the agent id, `vps-hostinger-01`.
3. Finds or creates the single-tenant app registration and service
   principal `sp-labs-agent-lab-hybrid-prod-cus-01`. Appends the
   certificate to it with `az ad app credential reset --cert --append`,
   ending one second before the certificate does, unless a credential with
   its thumbprint is already there; every other credential is left alone.
   Assigns the service principal the `LabAgent` app role on the HCWSite API
   (the script's `-ApiAppId`, whose default is the same client id
   `scripts/cutover/01-entra-api.ps1` names), which is gate 1 of the agent
   guard (`functions/src/lib/auth/require-agent.js`) and, for an
   application permission, the admin consent. Nothing else is granted: no
   Azure role, no Microsoft Graph permission, no client secret.
4. Has you register the agent on the site, which writes the
   `lab_agents/vps-hostinger-01` document gate 2 reads (below). It prints
   https://hybridcloudworks.com/admin/labs?tab=agents and the two values to
   paste into **Register agent** there, the agent id `vps-hostinger-01` and
   the service principal's object id from step 3, and waits for Enter. Leave
   every job type ticked and press **Register agent**; success is a toast
   reading `Agent registered` and a `vps-hostinger-01` card on that page.
   Then press Enter in PowerShell. When the agent is already heartbeating
   and step 3 did not create its service principal, the document is already
   there and binds it, so the step says so and does not wait.
5. Writes `vault_labs_agent_api_base`, `vault_labs_agent_tenant_id`,
   `vault_labs_agent_client_id` and `vault_labs_agent_api_scope` into
   `/etc/hcw/ansible/vault.yml`, as root on the host: decrypted into a
   root-only temporary directory, only those four keys replaced, every
   other key checked to be exactly as it was, re-encrypted with the
   existing password file, decrypted again and compared, then moved into
   place; the temporary files are shredded. When `vault.yml` does not exist
   it is created with only those four keys, so add the rest afterwards with
   `ansible-vault edit`, not `create`. When the four are already right the
   file is not rewritten at all. It prints key names, never a value read
   from the vault. Before the merge, the host sends one request without a
   token to `https://api-azure.hybridcloudworks.com/api/agent/heartbeat`
   (the probe, below).
6. Runs `sudo /opt/hcw-src/lab-host/bootstrap.sh` when the vault changed or
   the agent is not running (`-ForceBootstrap` runs it regardless), or
   restarts the agent when only Entra or the registration changed: a
   running agent keeps a token issued before the grant for up to an hour,
   and a heartbeat that starts working after a registration logs nothing,
   so without a restart the journal would still end on the refusal. Then
   it reads `systemctl is-active hcw-labs-agent` and the last journal
   lines, and says what they mean.

**What success looks like.** Near the end of the run:

```text
Agent: hcw-labs-agent is active and has logged no failure since it started: it is heartbeating.
```

The run exits 0, and https://hybridcloudworks.com/admin/labs?tab=agents
lists `vps-hostinger-01` as Online within 30 seconds. A heartbeat that works
logs nothing, which is why "no failure since it started" is the signal. A
second run ends with `No changes: the identity, the vault and the agent were
already set up.` A step that cannot finish stops there with its reason and
exits 1, having changed nothing after it. When everything ran but the agent
is not heartbeating at the end, the run exits 2 and says which of these it
is:

| The run says | What it means | What to do |
| --- | --- | --- |
| `Agent access required` | The token is accepted and the agent guard refuses it. Step 3 made the grant, so it is gate 2: the registry document is missing, deactivated, or bound to another object id | On https://hybridcloudworks.com/admin/labs?tab=agents: no `vps-hostinger-01` card, register it (step 4, the values the run prints); a card marked Deactivated, press Activate; a card showing another object id, register it again with the one the run prints, which rebinds it. Then run `ssh hcw-lab sudo systemctl restart hcw-labs-agent`. If step 3 assigned the role in this same run, wait two minutes before the restart |
| `Authentication required` | The API rejected the token itself: its audience or tenant is not what `ENTRA_API_AUDIENCE` and `ENTRA_TENANT_ID` expect | The scope must be `api://<API client id>/.default` and the API must issue v2 tokens; step 3 checks both and stops if either is not so |
| `HTTP 403 with no API error in the body` | Cloudflare answered, not the API. The probe line says the same thing before the merge | The probe, below |
| `Entra refused the agent's certificate sign-in (AADSTS…)` | Usually a registration or certificate this run created that Entra has not replicated yet | Wait two minutes, run `ssh hcw-lab sudo systemctl restart hcw-labs-agent`, and run the script again |
| `hcw-labs-agent is inactive` | `bootstrap.sh` starts it only when all four vault keys exist | The play's `Say why the agent is not running yet` task, in the output above, names what is missing |

**The API base, and the probe.** The agent calls
`https://api-azure.hybridcloudworks.com/api`, the Cloudflare hostname, and
not the Function App's `azurewebsites.net` host: the origin lock
(`functions_origin_lock_enabled`, on since 2026-08-20, `infra/functionapp.tf`)
denies every address outside Cloudflare's ranges, and the lab host is
outside them. The Cloudflare path has its own gate. Bot Fight Mode answers
many clients on hosting networks with a 403 challenge page (it is why the
availability probe is a Cloudflare Worker, [ADR 0024](../decisions/0024-edge-availability-probe.md)),
and the lab host is on one. So the script asks first: without a token the
API answers 401 with its own JSON, and the script says `the host reaches
agent/heartbeat through Cloudflare`. A `403` with an HTML page, or a
`cf-mitigated: challenge` header, means Cloudflare is refusing the host, and
the agent will log `HTTP 403` on every heartbeat. Admitting it is an owner
decision, not something this script changes: either admit the host's
address at the origin (an `ip_restriction` allow rule in
`infra/functionapp.tf`, and the Function App's own host name as
`LABS_AGENT_API_BASE`, passed to this script with `-ApiBase`), or relax
Bot Fight Mode for the zone. Each narrows a control, and a WAF skip rule
does not work: Bot Fight Mode does not run on the Ruleset Engine
([Alerting and support](alerting-and-support.md)).

**The registry document, and why it is a paste.** Gate 2 of the agent guard
reads `lab_agents/{agentId}` and requires its `oid` to be the agent's
service principal object id (the `oid` claim of an app-only token) and
`active` to be `true`; `capabilities` are the job types it may claim. The
only writer is the API (#740): **Register agent** on the Agents tab calls
`POST /api/cms/labs/agents` with `{ agentId, oid, jobTypes }`, and each
agent's card has **Deactivate** or **Activate**, which call
`PATCH /api/cms/labs/agents/{agentId}` with `{ active }`; a deactivated card
also has **Remove**, which calls `DELETE` on the same address and deletes the
record (step 8 of "Reinstalling the host", above). All three need an
editor or above and write an audit row, and the record holds only
identifiers: `id` and
`agentId` both `vps-hostinger-01`, `oid` lower-cased (the claim is lower
case and the guard compares exactly), `active`, and `capabilities`, by
default the five job types (`shell-echo`, `terraform-validate`,
`ansible-check`, `helm-template`, `kubeconform`) that
`scripts/lab-job-types.test.mjs` keeps in step with the server and agent
allowlists. Registering again with the same values changes nothing; with a
new object id it rebinds the agent. It never reactivates a deactivated
agent: that is the card's Activate, so undoing a revocation is always its
own act. A deactivation takes effect on the agent's next call, because the
guard does not cache the registry. The script cannot make the call itself,
because the route needs an admin's delegated token and no owner script
acquires one; and nothing can write the container directly, because the
Cosmos DB firewall admits only the Function App's subnet and no operator
holds a data-plane role. So step 4 prints the values and waits.

**Certificate rotation** uses the same script with `-NextCertificate`
(`lab-host/README.md`, "Rotating the agent certificate"): it appends
`/etc/hcw/labs-agent.next.crt`, leaves the old one, touches neither the
vault nor `bootstrap.sh`, and prints the swap as one PowerShell line. After
the swap, a plain run finds the agent heartbeating on the new certificate
and prints the `az ad app credential delete` line for the old one.

## Opening "Validate on the lab" to the public

The Landing Zone Builder's **Validate on the lab** sends the build's files to
this host as a `terraform-validate` job. Since the owner revised
[ADR 0032](../decisions/0032-learner-labs-platform.md) decision 6 on
2026-09-28 it is open to anyone, but only from the builder's pane on the
site: the API takes a job only with the site's `Origin` and a Cloudflare
Turnstile token, and within decision 6's bounds (64 KB, 2 an hour per
visitor, 50 a day, no more than 20 queued). It needs the agent above to be
heartbeating, and three owner values, which this section sets once.

The order is not a preference. `deploy-functions.yml` will not start while an
`hcw-azure` run is unfinished, and fails a deploy whose live settings lack a
reference Terraform declares, so the Terraform run goes first. The API-keys
page offers only the secrets the deployed code lists, so the secret goes after
the functions deploy. In between, `TURNSTILE_SECRET_KEY` is unresolved and
the path answers `TURNSTILE_NOT_CONFIGURED`. It was on the
`EXPECTED_UNRESOLVED` allowlist for that window the first time and came off
it once seeded on 2026-09-28, so on a rebuild `monitor-unresolved-secrets.yml`
reports it until step 4 is done.

**1. Confirm the Terraform run.** Open the run the merge queued at
https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs. Success is
`Plan: 3 to add, 1 to change, 3 to destroy`, the permanent diff, where the
one change, `azurerm_function_app_flex_consumption.hcw`, also adds
`LABS_PUBLIC_SUBMISSION_ENABLED = "true"` and `TURNSTILE_SECRET_KEY`, a
`@Microsoft.KeyVault(...)` reference. Anything else is a finding. The machine
check, PowerShell:

```powershell
gh workflow run tfc-plan-check.yml --repo HybridCloudWorks/HCW-HybridCloudWorks --ref main
```

Its summary reads expected, with two `DECLARED` lines for those two settings.
Then confirm and apply the run in the UI.

**2. Create the Turnstile widget and set the site-key variable.** Terraform
does not create it: `cloudflare_turnstile_widget` would hold its secret key in
state (`infra/frontend.tf`). At https://dash.cloudflare.com/?to=/:account/turnstile
choose **Add widget** and set:

| Field | Value |
| --- | --- |
| Widget name | `hcw-lab-validate` |
| Hostname management | `hybridcloudworks.com` (a hostname covers its subdomains, so www too) |
| Widget mode | Managed |
| Pre-clearance | No |

Create it, and copy the **Site Key** it shows (it starts with `0x4`). With the
site key on the clipboard, PowerShell:

```powershell
gh variable set VITE_TURNSTILE_SITE_KEY --repo HybridCloudWorks/HCW-HybridCloudWorks --body (Get-Clipboard)
```

```powershell
gh variable get VITE_TURNSTILE_SITE_KEY --repo HybridCloudWorks/HCW-HybridCloudWorks
```

Success is the second line printing the same `0x4…` value. Keep the widget's
page open: step 4 needs its **Secret Key**.

**3. Deploy the functions and the site.** Both are dispatch-only, from
`main`, PowerShell. The functions deploy refuses while step 1's run is
unfinished, so run it after the apply:

```powershell
gh workflow run deploy-functions.yml --repo HybridCloudWorks/HCW-HybridCloudWorks --ref main
```

```powershell
gh workflow run deploy-azure-frontend.yml --repo HybridCloudWorks/HCW-HybridCloudWorks --ref main
```

Success is both runs green at
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions. The site
build reads the variable from step 2, so a site deployed before it has no site
key and its button says so.

**4. Seed the Turnstile secret.** At
https://hybridcloudworks.com/admin/integrations?tab=keys, in the Hybrid Lab
section, paste the widget's **Secret Key** into **Cloudflare Turnstile — secret
key** and save. Success is the row's light turning green.

**What success looks like.** A minute after step 4 (the status read is cached
for one), the status read answers open, PowerShell:

```powershell
Invoke-RestMethod https://api-azure.hybridcloudworks.com/api/public/labs/submit | Select-Object open, code, reason, queued
```

Success is `open` `True` with `code` and `reason` empty. `False` names the
missing piece in `code`: `TURNSTILE_NOT_CONFIGURED` is step 4,
`LAB_AGENT_OFFLINE` is the agent ("The lab agent's go-live", above), and
`PUBLIC_SUBMISSION_CLOSED` is `labs_public_submission_enabled` set `false` in
the workspace. The lock refuses a caller that is not the site, PowerShell:

```powershell
try { Invoke-RestMethod -Method Post -Uri https://api-azure.hybridcloudworks.com/api/public/labs/submit -ContentType 'application/json' -Body '{}' } catch { $_.ErrorDetails.Message }
```

Success is a body with `"code":"ORIGIN_NOT_ALLOWED"`, since PowerShell sends
no `Origin`. Then the real thing: at
https://hybridcloudworks.com/tools/landing-zone, open the files and press
**Validate on the lab**. The line beside it goes from *Queued on the lab…* to
*Running on the lab…*, and the report under it reads *The configuration is
valid: Terraform found no errors.*, then **Modules used** (the default build
lists four, such as `avm-ptn-alz@0.21.0`) and **Providers** (six, such as
`hashicorp/azurerm v4.81.0`). The visitor never sees the job log: no image
pull, no `/opt/avm` path, no `(unauthenticated)`. The log itself is on the
job at https://hybridcloudworks.com/admin/labs?tab=jobs, claimed by
`vps-hostinger-01`. The first run on 2026-09-28 got that far, and
`TURNSTILE_SECRET_KEY` came off `EXPECTED_UNRESOLVED` in
`scripts/check-unresolved-secrets.mjs` in the same change that replaced the
log with the report.

| The button says | What it means | What to do |
| --- | --- | --- |
| *public submission is switched off* | `labs_public_submission_enabled` is `false` in the workspace | Delete the workspace variable (the default is `true`) or set it `true`, and apply |
| *its browser check (Cloudflare Turnstile) is not configured* | `TURNSTILE-SECRET-KEY` is not seeded, or its reference did not resolve | Step 4 |
| *this build of the site … has no Cloudflare Turnstile site key* | The site was built without `VITE_TURNSTILE_SITE_KEY` | Step 2, then the site deploy in step 3 |
| *no lab agent is online* | `vps-hostinger-01` has not heartbeated in the last 90 seconds | "The lab agent's go-live", above |
| *Cloudflare's browser check could not run here* | The Turnstile script did not load in that browser (an extension or network blocking `challenges.cloudflare.com`) | Reload, or try another browser; nothing on the server is wrong |
| *Cloudflare's browser check did not pass…* after a press | Siteverify refused the token, or its hostname or action was not the site's | Press again: the widget fetches a new token. If it repeats, check the widget's hostname is `hybridcloudworks.com` |

**Closing it again** is one workspace edit: set the Terraform variable
`labs_public_submission_enabled` to `false` (HCL off) at
https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables and apply.
Every public lab route then answers `PUBLIC_SUBMISSION_CLOSED` before reading
anything, and the button says so.

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
host half is the `arc` role in `lab-host/ansible/`, which does nothing until
the host's arc fact is set (below). Onboarding is two runs of one script,
`scripts/lab/Register-LabArc.ps1`, on the workstation, with one `hcw-azure`
run between them: the first run (step 2) prepares the identity and the
secret and prints what to set in the workspace, the owner sets it and
confirms the run (step 3), and the second run, with `-Connect` (step 4),
connects the host, removes the credential and adds the monitoring. When the
read-back in step 4 first returns Connected, change the Arc rows in
[Labs host](../architecture/labs-host.md) and the Arc rows of
[Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed)
in the same pull request.

## What each side owns

| Piece | Where | Created by |
| --- | --- | --- |
| Resource group `rg-lab-hybrid-prod-cus` | `infra/lab-hybrid.tf` | `hcw-azure` apply |
| Data collection rule `dcr-lab-hybrid-prod-cus`: heartbeat, `auth`/`authpriv` syslog at Info and above, into `log-plat-prod-cus-01` | `infra/lab-hybrid.tf` | `hcw-azure` apply |
| Onboarding service principal `sp-arc-onboarding-lab-hybrid-prod-cus`: single tenant, no role of its own | Entra | The first run, step 2 (the run identity has no Entra role) |
| Its client secret | Entra, and the host's Ansible vault as `vault_arc_service_principal_secret` beside the three identifiers | Minted by the first run, valid 24 hours; deleted from both by `-Connect` once the host is Connected |
| Its only grant, Azure Connected Machine Onboarding on the group | `infra/lab-hybrid.tf`, once `arc_onboarding_principal_id` is set | `hcw-azure` apply, step 3 |
| The run identity's Resource Policy Contributor on the group, so Terraform can write the policy assignment | Azure RBAC | The first run, step 2 (Terraform does not grant itself rights) |
| Audit-only Linux baseline assignment `audit-linux-baseline-lab-hybrid` | `infra/lab-hybrid.tf`, once `lab_hybrid_policy_enabled` is true | `hcw-azure` apply, step 3 |
| The arc fact `/etc/ansible/facts.d/hcw_arc.fact` | The host | `-Connect`, step 4 |
| Arc machine `arcs-lab-hybrid-prod-cus-01` | Azure, created by `azcmagent connect` | The `arc` role, in the `bootstrap.sh` run `-Connect` starts |
| Azure Monitor Agent extension and the rule's association to the machine | Azure | `-Connect`, step 4 (neither can exist before the machine does) |

Defender for Servers stays off. Nothing here, in Terraform or on the host,
enables it.

## Why the switch is on the host

`arc_enabled` in `lab-host/ansible/group_vars/all.yml` is not a literal: it
is true exactly when `/etc/ansible/facts.d/hcw_arc.fact` on the host is JSON
whose `enabled` is `true`, which Ansible reads as the local fact
`ansible_local.hcw_arc` whenever it gathers facts. `-Connect` writes that
file, and nothing else does. The switch belongs to the host installation
because Arc membership does. A rebuilt host is not onboarded whatever the
repository says, and a repository-wide `arc_enabled: true` would stop every
rebuilt host's first `bootstrap.sh` run at the role's fail-closed check,
before any role after `arc` had run. Kept on the host, the flag can go on
from the one command that also connects, with no pull request, and a
rebuilt host comes up without it. The file stays, so every later run keeps
the Connected host's agent at the pin in `group_vars`. A file that is
missing, is not JSON, or says anything but `"enabled": true` reads as off,
which was checked on Ubuntu 26.04 with the pinned ansible-core 2.21.4: with
no file every `arc` task is skipped, and with it the role installs the agent
and stops at its vault check when the vault is empty.

## Before you start

- This change is merged to `main`, and the host has been provisioned and has
  run `bootstrap.sh` at least once (`lab-host/README.md`, "First run"), so
  the vault password `/etc/hcw/ansible/vault-password` exists.
- The host has the vault helper `/usr/local/sbin/hcw-vault-set`, which
  `bootstrap.sh` installs (the `vault_tools` role): it takes a value on
  standard input and sets one key in the Ansible vault, printing no value.
  The script writes the four `vault_arc_*` keys only through it, and stops
  before minting anything when it is missing.
- This desktop reaches the host: `ssh hcw-lab hostname` prints its name
  ("Connect from a desktop", above).
- You can create app registrations in the tenant (Application
  Administrator, Cloud Application Administrator or Global Administrator)
  and grant roles on `rg-lab-hybrid-prod-cus` (Owner, User Access
  Administrator or Role Based Access Control Administrator there).
- The host runs Ubuntu 26.04 LTS on x86-64 (owner decision 2026-09-26).
  Microsoft Learn lists Ubuntu 26.04 on x86-64 (not Arm64) as supported for
  [Arc-enabled servers](https://learn.microsoft.com/azure/azure-arc/servers/prerequisites#supported-operating-systems)
  and Ubuntu 26.04 LTS as supported by the
  [Azure Monitor Agent](https://learn.microsoft.com/azure/azure-monitor/agents/azure-monitor-agent-supported-operating-systems),
  both read 2026-09-26, so there is no support gap. The `arc` role installs
  `azcmagent` from `packages.microsoft.com/ubuntu/26.04/prod`, which
  Microsoft signs with `microsoft-2025.asc` rather than the older
  `microsoft.asc`; the role picks the key, and its pinned checksum, by
  release.
- `az` is signed in to the tenant. The script checks, and prints this line
  when it is not; a browser opens:

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

The script checks the same and stops, pointing here, when the group is
missing.

## 2. The first run

PowerShell, from the repository root on `main` once this change has merged
(`Test-Path scripts/lab/Register-LabArc.ps1` prints `True` when the working
tree has the script):

```powershell
pwsh -NoProfile -File scripts/lab/Register-LabArc.ps1
```

Adding `-WhatIf` to that line shows what it would do and changes nothing:
Entra, Azure and the host are only read.

**What it does**, printing one line per step:

1. Checks `az` is signed in to the tenant, resolves `sub-app-site-prod-cus`
   to its id by name, and checks `rg-lab-hybrid-prod-cus` exists there.
2. Reads the host over `ssh hcw-lab`: whether `azcmagent` is installed and
   Connected, whether the arc fact is set, whether the vault helper is
   there, and which `vault_arc_*` keys the vault holds. Names only: the
   three identifiers are GUIDs and are compared, and the secret is only
   checked against the first characters Entra shows for it, on the host.
3. Finds or creates the app registration and service principal
   `sp-arc-onboarding-lab-hybrid-prod-cus`: single tenant, no credential, no
   role. It prints the service principal's **object id**, the value
   Terraform needs; the application id is a different GUID, the one
   `azcmagent` signs in with.
4. Grants the Terraform run identity `id-plat-terraform-prod-cus-01`
   **Resource Policy Contributor** on `rg-lab-hybrid-prod-cus` only, unless
   it holds it or the audit policy assignment already exists. Contributor
   excludes `Microsoft.Authorization/*/Write`, so without this the apply in
   step 3 fails on `policyAssignments/write`. Never on the subscription,
   where the IaC repository standard forbids a workload repository
   assigning policy.
5. Unless the host is already Connected, mints a client secret valid for 24
   hours (`az ad app credential reset --append --end-date`, so no other
   credential is touched) and writes it into the vault through
   `hcw-vault-set` as `vault_arc_service_principal_secret`, with
   `vault_arc_service_principal_id`, `vault_arc_tenant_id` and
   `vault_arc_subscription_id`. The secret goes from `az`'s output into a
   variable and from there to `ssh`'s standard input, and the variable is
   cleared: it is never shown, never written to a file on the desktop and
   never on a command line. It then reads the vault back, and deletes the
   secret from Entra again if the vault does not hold it. A second run
   keeps a secret it finds in the vault while it has an hour left, and
   deletes any other secret on the registration before it mints.
6. Checks whether `hcw-azure` has applied the onboarding grant and the
   audit policy assignment, and for each that is missing prints the
   workspace variable to set, the address to set it at, and the plan to
   expect (step 3).

**Should `lab_hybrid_policy_enabled` be on? Yes.** ADR 0032 decision 3 makes
machine configuration audit only, not absent; #663 is done only when "the
policy assignment shows a compliance state"; and the labs page reads the
machine's compliance. The script prints the variable whenever the
assignment is missing and the run identity can write it.

**What success looks like.** The run ends with the two variables, the plan
to expect and the `-Connect` line, then `Changed:` naming what it did, and
exits 0. A second run changes nothing and says `No changes:`. If
`id-plat-terraform-prod-cus-01` cannot be found by its exact name, the run
says so, leaves the policy variable out, and onboarding goes ahead without
it; grant the role on the group by hand later and run the script again, and
it prints the variable then.

## 3. Set the workspace variables and apply

The first run prints the values; they go at
`https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables`, each with
**+ Add variable**, category **Terraform variable** (not Environment
variable), **Sensitive** unticked. If one already exists, edit it to the
printed value.

| Key | Value | HCL |
| --- | --- | --- |
| `arc_onboarding_principal_id` | the **object id** the first run prints, lower case | off |
| `lab_hybrid_policy_enabled` | `true` | on |

Then start a run from `https://app.terraform.io/app/hcw/workspaces/hcw-azure`
with **New run**, type **Plan and apply**.

- Expected: **`Plan: 5 to add, 1 to change, 3 to destroy`**, or 4 to add if
  the run printed only one variable. The real lines are
  `azurerm_role_assignment.arc_onboarding[0] will be created` and
  `azurerm_resource_group_policy_assignment.lab_hybrid_linux_baseline[0]
  will be created`; the rest is the permanent diff.

Anything else is not this change: discard the run and read the plan.
Otherwise confirm and apply. An apply that fails with `AuthorizationFailed`
on `policyAssignments/write` means the grant from step 2 has not reached
Azure yet: wait a minute and start another run.

Read back: run the first run's line again. Success is
`Azure: sp-arc-onboarding-lab-hybrid-prod-cus holds Azure Connected Machine
Onboarding on rg-lab-hybrid-prod-cus, applied by hcw-azure. Nothing to set
there.` and `No changes:`.

## 4. The second run: connect, remove the credential, add the monitoring

PowerShell, from the repository root:

```powershell
pwsh -NoProfile -File scripts/lab/Register-LabArc.ps1 -Connect
```

`-WhatIf` works here too: the vault removal runs in check mode on the host
and `bootstrap.sh` does not run.

**What it does:**

1. The first run's checks, then, read only, that the service principal
   holds Azure Connected Machine Onboarding on the group. Without it, it
   prints step 3's variables and stops.
2. When the host is not Connected: stops if a machine resource
   `arcs-lab-hybrid-prod-cus-01` is left from an earlier host (it prints the
   `az resource delete` line that removes it); makes sure a live secret is
   in the vault, minting a new one if the first run's has expired or has
   less than an hour left; writes the arc fact; runs
   `sudo /opt/hcw-src/lab-host/bootstrap.sh`, whose output it shows; and
   waits for `azcmagent` to report Connected. If the host does not connect,
   it removes the fact it wrote, so later `bootstrap.sh` runs are not
   stopped at the `arc` role, and stops with the reason.
3. Once Connected, deletes every client secret on the registration and the
   four `vault_arc_*` keys from the vault (decrypted into a root-only
   temporary directory, those keys dropped, every other key checked to be
   exactly as it was, re-encrypted, decrypted again and compared, moved into
   place), and reads both back empty. ADR 0032: the credential is never on
   the host after onboarding. The principal and its grant stay; without a
   credential they cannot be used, and re-onboarding needs only a new
   secret. The `arc` role needs none of the four keys on a Connected host.
4. Installs the Azure Monitor Agent extension (`AzureMonitorLinuxAgent`,
   publisher `Microsoft.Azure.Monitor`, automatic upgrade on) and waits for
   it to succeed, then associates `dcr-lab-hybrid-prod-cus` with the
   machine as `dcra-lab-hybrid-prod-cus`. Both are Azure-side and need the
   machine, which is why neither is in Terraform; both are needed, because
   an association made outside the portal's rule wizard does not install
   the agent, and an agent with no rule collects nothing. Each is left alone
   when it is already there. Both use `az rest`, so no `az` extension is
   installed.

**What success looks like.** The run ends with

```text
Arc: arcs-lab-hybrid-prod-cus-01 is Connected in rg-lab-hybrid-prod-cus, the onboarding secret is gone from Entra and the vault, and the Azure Monitor Agent sends to dcr-lab-hybrid-prod-cus.
```

and exits 0. A second run changes nothing and says `No changes:`. Exit 2
means the host is Connected and the credential is gone, but the extension or
the association is not finished; the run says which, and `-Connect` again
picks up from there. Exit 1 is a stop with its reason, before anything after
it changed. Read back from Azure, PowerShell:

```powershell
az connectedmachine list -g rg-lab-hybrid-prod-cus --subscription sub-app-site-prod-cus -o json | ConvertFrom-Json | Select-Object name, status, agentVersion, osName
```

Success is **one row**: `arcs-lab-hybrid-prod-cus-01`, `status`
**Connected**, `agentVersion` `1.68.03532.1399` (the pin in
`group_vars/all.yml`), `osName` `linux`. The first `az connectedmachine`
command offers to install the `connectedmachine` CLI extension; accept it.
On the host, bash:

```bash
sudo /opt/azcmagent/bin/azcmagent show
```

prints `Agent Status : Connected`, `Resource Name : arcs-lab-hybrid-prod-cus-01`
and `Resource Group Name : rg-lab-hybrid-prod-cus`.

| The run says | What it means | What to do |
| --- | --- | --- |
| `does not hold Azure Connected Machine Onboarding` | Step 3 has not been applied | Step 3, then `-Connect` again |
| `a machine resource arcs-lab-hybrid-prod-cus-01 already exists` | It is left from an earlier host, and `azcmagent connect` cannot take it over | Run the `az resource delete` line it prints, then `-Connect` again |
| `hcw-vault-set is not on hcw-lab` | The helper is missing, so nothing was minted | Run `bootstrap.sh`: its `vault_tools` role installs the helper (`lab-host/README.md`, "The vault"). Then run again |
| `The arc role did not run: azcmagent is not installed` | The play stopped before `arc`, or the commit `bootstrap.sh` ran predates `arc_enabled` reading the fact | The `PLAY RECAP` above names the task; `bootstrap.sh` runs current `main` |
| `AZCM0041` with `invalid_client` in the role's output | A wrong secret or application id in the vault | Run the first run (it replaces the secret), then `-Connect` |
| `AuthorizationFailed` in the role's output | The grant has not reached Azure yet | Wait two minutes, then `-Connect` again |
| `did not reach Succeeded` for the extension | The Azure Monitor Agent failed to install | The portal address it prints shows the extension's status message; fix, then `-Connect` again |

## 5. Confirm the heartbeat, the syslog and the compliance state

The Management workspace is read by its customer id, computed here:

```powershell
$wsId = (az monitor log-analytics workspace show -g rg-mgmt-plat-prod-cus -n log-plat-prod-cus-01 --subscription sub-plat-mgmt-prod-cus -o json | ConvertFrom-Json).customerId
```

```powershell
az monitor log-analytics query --workspace $wsId --analytics-query "Heartbeat | where TimeGenerated > ago(15m) | where _ResourceId contains 'arcs-lab-hybrid-prod-cus-01' | summarize beats = count(), latest = max(TimeGenerated) by Computer, Category" -o table
```

Success is one row, `Category` `Azure Monitor Agent`, with `beats` near 15:
the agent writes one a minute to every workspace an associated rule names.
Allow ten minutes after step 4 for the first. The syslog, allowing an hour
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

**Done when** step 4's read-back shows one Connected row, the Heartbeat
query returns the host, and the compliance query shows a state for it (the
#663 acceptance).

## Disconnecting

Disconnecting deletes the machine resource, and with it the rule
association and the guest assignment the policy created. Do it in this
order, or the next playbook run fails closed looking for a credential that
step 4 deleted.

1. Turn the switch off on the host by removing the arc fact. Bash, on the
   host; with the file gone, the `arc` role touches nothing on the next run:

   ```bash
   sudo rm -f /etc/ansible/facts.d/hcw_arc.fact
   ```

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

Success: step 4's read-back returns no rows, and
`sudo /opt/azcmagent/bin/azcmagent show` on the host prints
`Agent Status : Disconnected`. The package stays installed and held; remove
it with `sudo apt-mark unhold azcmagent && sudo apt-get purge -y azcmagent`
(bash, on the host) only if the host is leaving Arc for good.

## Re-onboarding a rebuilt host

A rebuilt host has no arc fact and no Arc identity, so its first
`bootstrap.sh` run leaves Arc alone and completes. The machine resource of
the old host blocks the new one: delete it first (step 2 of
"Disconnecting"), or let `-Connect` stop and print the one line that does.
Then run step 2 and step 4 again. The principal and its grant are still
there, so the first run only mints a new secret and says `Nothing to set
there`, and `-Connect` onboards the new host.

## Troubleshooting

- **`Expired`** in step 4's read-back: the agent has not reached Azure for
  45 days and its identity certificate is gone. Disconnect
  ("Disconnecting", all three steps) and re-onboard.
- **`Disconnected`** in step 4's read-back with the agent running: outbound
  443 to Azure is blocked somewhere. Bash, on the host:
  `sudo /opt/azcmagent/bin/azcmagent check --location centralus` names the
  endpoint that fails.
- **No Heartbeat rows** with the extension `Succeeded`: the association is
  missing (run `-Connect` again; it adds one that is not there), or the rule
  and the workspace are in different regions. Both are `centralus` by
  construction: the rule takes the workspace's location in
  `infra/lab-hybrid.tf`.
- **A later `bootstrap.sh` run stops at `arc : Refuse to onboard without the
  four Arc vault values`**: the arc fact is set but the host is not
  Connected, which a failed `-Connect` does not leave behind (it removes the
  fact it wrote). Run `-Connect` again, or turn the switch off (step 1 of
  "Disconnecting").
