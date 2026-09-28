# lab-host

Configuration management for the Hostinger lab host: the on-premises half of
the hybrid estate in #656, Phase 2 (#662), on the decisions in ADR 0032.
Terraform in `infra-lab/` (#661) adopts the existing VPS and writes its DNS;
everything on the host after that is here, so nothing beyond the one
bootstrap command below is done by hand over SSH and a follower can read
every step.

## What runs on the host

| Role | Installs | Where |
| --- | --- | --- |
| `hardening` | `hcwadmin` key-only login with passwordless sudo, sshd drop-in (`PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`), ufw deny-in/allow-out with TCP 22, 80, 443, unattended-upgrades rebooting at 04:30, fail2ban sshd jail | `/etc/ssh/sshd_config.d/00-hcw-hardening.conf`, `/etc/sudoers.d/90-hcw-admin`, `/etc/apt/apt.conf.d/52hcw-unattended-upgrades`, `/etc/fail2ban/jail.d/hcw-sshd.local` |
| `vault_tools` | `hcw-vault-set`, which sets one key of the Ansible vault from stdin and prints no value ("The vault", below), and the vault's directory, root-only. The Ansible vault the playbook reads, not HashiCorp Vault, which is the `vault` role | `/usr/local/sbin/hcw-vault-set` (root:root, 0750), `/etc/hcw/ansible` (root:root, 0700) |
| `arc` | Azure Connected Machine agent 1.68.03532.1399 from Microsoft's apt repository, held, then `azcmagent connect` to `rg-lab-hybrid-prod-cus` as `arcs-lab-hybrid-prod-cus-01` with the onboarding service principal from the vault, skipped once Connected. Nothing until `arc_enabled` is true | `/opt/azcmagent/`, `/etc/apt/sources.list.d/microsoft-prod.sources`; the connect configuration is a temporary root-only file deleted in the same run |
| `docker` | Docker Engine 29.8.1, buildx 0.37.1 and compose 5.5.1 from Docker's apt repository, held; `json-file` logs 10 MB x 3, `live-restore` | `/etc/docker/daemon.json` |
| `node_exporter` | node_exporter 1.12.1, host-native, SHA256-verified, `127.0.0.1:9100` only | `/usr/local/bin/node_exporter`, `node_exporter.service` |
| `caddy` | Caddy 2.11.4 built with `caddy-dns/cloudflare` 0.2.4, host-native under systemd; TLS for `lab.hybridcloudworks.com`, `*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com` via DNS-01; placeholder response at the apex. Panes only (owner decision 2026-09-28): every name can be framed by the site alone, and a top-level browser visit is redirected to `https://hybridcloudworks.com/education/labs` (`roles/caddy/README.md`, "Panes only") | `/usr/local/bin/caddy`, `/opt/caddy/bin/` (versioned binary and its `.provenance`), `/etc/caddy/Caddyfile`, `/etc/caddy/conf.d/`, `/etc/caddy/env` (root:caddy, 0640), `caddy.service` running as `caddy` |
| `coder` | Coder Community edition v2.37.3 and PostgreSQL 18.6 under Docker Compose from `../coder/docker-compose.yml`, both by digest; the Caddy route for `coder.lab` and `*.coder.lab`; a nightly `pg_dump` keeping seven days. On since 2026-09-28, for members of the `HybridCloudWorks` GitHub organisation only | `/etc/hcw/coder/` (`docker-compose.yml`, `.env`, `coder.env` and `coder-postgres.env`, the last two root 0600), `/etc/caddy/conf.d/10-coder.caddy`, `/usr/local/sbin/coder-postgres-backup`, `coder-postgres-backup.timer`, `/var/backups/coder/` |
| `labs_agent` | `vps-agent` host-native as `hcw-labs-agent.service` under user `hcw-labs-agent` (in `docker`), Node.js 26.10.0 from NodeSource, repository checkout at the commit the playbook runs from, certificate generated on the host | `/opt/hcw-labs-agent`, `/etc/hcw/labs-agent.env` (root, 0600), `/etc/hcw/labs-agent.pem` (root:hcw-labs-agent, 0640), `/etc/hcw/labs-agent.crt` |
| `lab_images` | Every image a lab job runs, pulled by digest before any job needs it: each value of `IMAGES` in `vps-agent/lib/capabilities.js`, and the Coder workspace image from `../coder/templates/hcw-lab/main.tf` while `coder_enabled` is true. Read from the checkouts, never copied, so a pin bump needs no edit here; digests no pin names are removed from the lab's own repositories and nothing else is touched (`roles/lab_images/README.md`) | Docker's image store; the plan is `roles/lab_images/files/lab-images.mjs`, run from the playbook's checkout |
| `portainer` | Portainer Business Edition 2.45.1 (LTS) by digest, one container with the Docker socket, HTTPS on **127.0.0.1:9443 only**, plain HTTP off, no Caddy route; reached through an SSH tunnel. Nothing until `portainer_enabled` is true | Container `portainer`, volume `portainer-data` |
| `vault` | HashiCorp Vault 2.1.1 host-native as `vault.service` under user `vault`, the download checked against HashiCorp's signature on SHA256SUMS; raft storage; API on **127.0.0.1:8200** and cluster port on **127.0.0.1:8201**, TLS from a certificate generated on the host. For lab-host secrets only; never initialised or unsealed by the role. Nothing until `vault_enabled` is true | `/usr/local/bin/vault`, `/opt/vault/` (downloads, signing key), `/etc/vault.d/vault.hcl` (root:vault, 0640), `/etc/vault.d/tls/`, `/var/lib/vault` (vault, 0700), `/etc/profile.d/hcw-vault.sh` |

Each role's `README.md` explains its decisions; `meta/argument_specs.yml` is
its variable contract. Every version, digest and checksum is in
`ansible/group_vars/all.yml`, and the collections are pinned in
`ansible/requirements.yml`.

`site.yml` runs the roles in that order: `vault_tools` straight after
`hardening`, because `hcw-vault-set` is how a missing vault key is added and
a later role that stops on one should find it installed; `arc` next,
because the agent needs nothing the later roles install and the host should
appear in Azure even when a later role fails; `coder` after `caddy`, because
its route is a file in Caddy's `conf.d`, and before `labs_agent`;
`lab_images` straight after `labs_agent`, because its plan runs on the
Node.js that role installs and reads the agent's checkout; `portainer`
and `vault` last, because nothing above needs either, so a failure there
leaves the lab services configured. Docker Compose on this host is
for Coder and its PostgreSQL only (ADR 0032); Portainer is a single
container the role runs directly, Caddy, the agent and Vault are host
services, and Coder's Caddy route is `/etc/caddy/conf.d/10-coder.caddy`,
the pattern `00-apex.caddy` shows.

Only sshd (22) and Caddy (80 and 443) listen on a public address.
node_exporter, Coder, Portainer and Vault listen on `127.0.0.1`, and the
two that publish through Docker (Coder, Portainer) name `127.0.0.1` in the
publish itself, because Docker's iptables rules for a published port come
before ufw's.

## First run

The VPS already exists, and the `hostinger/hostinger` provider runs a
post-install script only at purchase or at reinstall, so there is none: the
owner clones this repository onto the host and runs `bootstrap.sh` as root
over SSH, with the one line in `infra-lab/README.md`, step 7. It needs a key
in `/root/.ssh/authorized_keys` first (step 6 there), because the
`hardening` role copies that key to `hcwadmin` before it turns root and
password login off. The script checks the host is Ubuntu 26.04 LTS (24.04
LTS is accepted and says it is the fallback; anything else stops), then
checks the host is empty (below), installs
`uv` 0.12.19 from its GitHub release after checking the archive's SHA256,
has uv install CPython 3.14.7 and `ansible-core` 2.21.4 on it, clones
this repository into `/opt/hcw-src` (or fetches, when the clone exists),
checks out the current `main` commit detached and prints its full sha
(`HCW_REPO_REF`, below), installs the collections and runs `site.yml`
against localhost. Without a
vault the play stops at the `coder` role, on purpose: Coder is on (since
2026-09-28) and the role will not start it without its three vault keys.
Every role before it has run by then, so the host is hardened,
`hcw-vault-set` is installed, Docker and node_exporter run, and Caddy
serves an HTTP-only apex answering 503 that says TLS is off (and imports no
routes, so nothing can leak over plaintext). The `PLAY RECAP` shows
`failed=1`, and the failed task is `coder : Refuse to enable Coder without
its three vault secrets`. Create the vault and add its keys ("The vault",
below), then re-run; that run configures the rest and ends with `failed=0`.

### The first-run host check

`bootstrap.sh` configures only a host that was prepared for it. On a host
it has never accepted it looks, before it changes anything, for signs of
another workload, and refuses when it finds one. It exits 3, lists what it
found, and names the two ways on. The checks, each something this
repository never creates on a host it has not accepted:

- any Docker container, running or stopped (the `docker` role restarts the
  daemon, and a restart starts every stopped container whose restart policy
  is `always`);
- an installed `actions.runner.*` systemd unit (a self-hosted runner);
- Kubernetes: a `k3s`, `k0s`, `rke2`, `kubelet` or `microk8s` unit,
  `/usr/local/bin/k3s`, `/etc/rancher`, `/var/lib/rancher`,
  `/etc/kubernetes` or `/var/lib/kubelet`;
- `/opt/hcw-src` or `/opt/hcw-labs-agent` holding anything but a checkout of
  this repository;
- anything else under `/opt`;
- a TCP listener other than sshd on 22 and systemd-resolved on
  `127.0.0.53:53` and `127.0.0.54:53`.

The first run that passes writes `/etc/hcw/bootstrap-host-accepted` before
its first change, and every run that finishes records its commit there.
While that file exists, runs skip the check, so a first run that fails
half-way can be re-run: what it left behind is this repository's own, and
the host was judged before any of it existed. The procedure the refusal
points at, reinstalling the server, is
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md), "Reinstalling
the host". The other way is to accept the host knowingly, only when every
listed item is meant to stay and may be disrupted: the run then moves Docker
to its pinned version and restarts it, enables ufw with only 22, 80 and 443
open, and replaces sshd's login settings, whatever those workloads need.
Bash, on the host, as root:

```bash
HCW_ADOPT_NONEMPTY_HOST=1 /opt/hcw-src/lab-host/bootstrap.sh
```

The marker then says `accepted_as=adopted`, with one `adopted_with=` line
per item that was found. Delete the marker only to make the next run check
again.

### Which Python runs what

Owner rule 2026-09-26: Python is on the newest release line and no more than
two patch releases behind that line's newest. On 2026-09-26 that is 3.14.7,
so the floor is 3.14.5, and Ubuntu 26.04's own `/usr/bin/python3` is 3.14.4
(the `python3.14` package; the `python3` package is 3.14.3). So:

| Runs | Interpreter | Why |
| --- | --- | --- |
| `ansible-playbook`, `ansible-galaxy`, `ansible-vault` (the control side) | CPython 3.14.7 from uv, under `/opt/uv/python`, in the environment `/opt/uv/tools/ansible-core`, linked into `/usr/local/bin` | The rule. `PYTHON_VERSION` at the top of `bootstrap.sh` is the pin; uv checks the download against the SHA256 it carries for that build, and uv itself is checked against `UV_SHA256` |
| Every module the play runs on the host | `/usr/bin/python3`, the distribution's (3.14.4 on 26.04, 3.12.3 on 24.04) | **The one recorded exception.** `python3-apt`, `python3-debian` and `python3-docker`, which the `apt`, `deb822_repository` and `community.docker` modules import, are Ubuntu packages built for that interpreter and cannot be loaded by another. `ansible_python_interpreter` in `ansible/inventory/localhost.yml` says so |

A successful run prints, before the play starts, `ansible-playbook [core
2.21.4]` and a `python version = 3.14.7` line. Moving Python is a change to
`PYTHON_VERSION` (and `UV_VERSION`/`UV_SHA256` when the newer Python needs a
newer uv); the script rebuilds the environment when either the Python or the
ansible-core pin no longer matches what is installed.

## Re-running

Bash, on the host, as the `hcwadmin` user the first run created:

```bash
sudo /opt/hcw-src/lab-host/bootstrap.sh
```

A successful run ends with a `PLAY RECAP` line for `localhost` showing
`failed=0` and `unreachable=0`. On a host that is already configured,
`changed=0` is the normal result; anything else names the task that changed.

To see what a run would change without changing it, pass the playbook flags
through (bash, on the host):

```bash
sudo /opt/hcw-src/lab-host/bootstrap.sh --check --diff
```

### Which commit runs

Every run brings the host to the current `main`: to move the host to a
change, merge it and re-run the line above. There is no pin to bump.
`bootstrap.sh` fetches, resolves `HCW_REPO_REF` (default `origin/main`) to
a full sha, checks that sha out detached in `/opt/hcw-src` and runs the
playbook from it, and the agent runs the same commit, because
`labs_agent_repo_ref` in `ansible/group_vars/all.yml` reads the playbook's
own checkout. `main` is protected by the repository ruleset — every change
arrives by pull request, nobody can bypass it, and the required checks
include `ansible-lint (lab-host)` and `coder (lab-host)` — so a commit on
`main` has passed the same checks a pinned sha had to. A pin could not do
better: a pull request cannot name its own merge commit, so a pin always
lagged one merge behind and every lab-host change needed a second pull
request to take effect.

A run prints the commit before anything changes, as
`[bootstrap] checking out origin/main at <40-character sha>`, and again as
`[bootstrap] running site.yml from <sha> against localhost`. When the
commit carries a different `bootstrap.sh` from the one that started (a
Python or ansible-core bump), the run says
`carries a different bootstrap.sh; handing over to it` and continues as the
new script, on the same sha.

`HCW_REPO_REF` also takes any sha or ref the fetch can see, to hold a host
back or roll it back. Because a plain run also applies whatever has merged
since the last one, the first line below is the one to use when only the
vault changed and nothing else should. Bash, on the host. Re-apply the
commit the host runs now, without moving it:

```bash
sudo HCW_REPO_REF=HEAD /opt/hcw-src/lab-host/bootstrap.sh
```

Roll back to `main` as it was before the most recent merge:

```bash
sudo HCW_REPO_REF=origin/main~1 /opt/hcw-src/lab-host/bootstrap.sh
```

Move the playbook to current `main` but keep the agent on the commit it
runs now (an explicit `-e` wins over `group_vars`, and the stamp that
decides whether to reinstall its dependencies follows the commit the agent
is checked out at):

```bash
sudo /opt/hcw-src/lab-host/bootstrap.sh -e labs_agent_repo_ref="$(sudo git -C /opt/hcw-labs-agent rev-parse HEAD)"
```

A hold lasts one run. The next plain run returns the playbook and the agent
to current `main`.

## The vault

Secrets never enter the repository. They live on the host in
`/etc/hcw/ansible/vault.yml`, encrypted with Ansible Vault, and the vault
password is `/etc/hcw/ansible/vault-password`, root-only. `bootstrap.sh`
passes both when they exist and runs without them when they do not.

The password comes first, once per host. Bash, on the host (the
`vault_tools` role creates the directory too, root-only, so the first line
matters only before the first `bootstrap.sh` run has finished):

```bash
sudo install -d -m 0700 -o root -g root /etc/hcw/ansible
```

```bash
sudo sh -c 'umask 077 && openssl rand -base64 32 > /etc/hcw/ansible/vault-password'
```

### Setting a key

`/usr/local/sbin/hcw-vault-set`, installed by the `vault_tools` role, sets
one key from the value on its standard input. The value never appears on a
command line, in a shell history or in any output. It creates `vault.yml` when
there is none, keeps every other key, and replaces the file by rename, so
the file is always the old vault or the new one. It is one line from the
workstation, and the line is the same for every key except its last word,
the key's name. PowerShell, for the Cloudflare token:

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_cloudflare_api_token"
```

The line reads the clipboard when you press Enter, and copying the line
itself fills the clipboard. So the order is:

1. Paste the line at the prompt, and do not press Enter.
2. Copy the value.
3. Press Enter.

Success is one line naming the key and every key now in the vault, with no
value:

```text
hcw-vault-set: set vault_cloudflare_api_token (value not shown). Keys in the vault: vault_caddy_acme_email, vault_cloudflare_api_token, ...
```

`the value on stdin was empty; nothing changed` means the clipboard was
empty, and `refusing key name` means the last word is not `vault_` followed
by lower-case letters, digits and underscores. In both cases the vault is
exactly as it was. `no vault password at /etc/hcw/ansible/vault-password`
means the two lines above have not run. `-n` makes `sudo` fail at once
rather than wait at a password prompt nobody can see; `hcwadmin`'s sudo
asks for none.

The keys:

| Key | Read by | What it is |
| --- | --- | --- |
| `vault_cloudflare_api_token` | `caddy` | The **runtime** Cloudflare API token Caddy uses for DNS-01, distinct from the one Terraform holds in #661. See the note below on its scope |
| `vault_caddy_acme_email` | `caddy` | Optional. ACME account contact for expiry mail |
| `vault_labs_agent_api_base` | `labs_agent` | `LABS_AGENT_API_BASE`: the Functions API base including `/api`, as the host reaches it: `https://api-azure.hybridcloudworks.com/api`, through Cloudflare. Not the `func-site-prod-cus-01` app's `azurewebsites.net` host: the Function App's origin lock (`functions_origin_lock_enabled`, on since 2026-08-20) denies every address outside Cloudflare's ranges, and this host is outside them, so that host answers it 403. Written by `scripts/lab/Register-LabAgent.ps1` (below) |
| `vault_labs_agent_tenant_id` | `labs_agent` | `LABS_AGENT_TENANT_ID`. Written by the same script |
| `vault_labs_agent_client_id` | `labs_agent` | `LABS_AGENT_CLIENT_ID`: this agent's confidential app registration, `sp-labs-agent-lab-hybrid-prod-cus-01`. Written by the same script |
| `vault_labs_agent_api_scope` | `labs_agent` | `LABS_AGENT_API_SCOPE`: `api://<API client id>/.default`, matching the app's `ENTRA_API_AUDIENCE`. Written by the same script |
| `vault_coder_oauth2_github_client_id` | `coder` | `CODER_OAUTH2_GITHUB_CLIENT_ID`: the GitHub OAuth app the owner creates in #682 |
| `vault_coder_oauth2_github_client_secret` | `coder` | `CODER_OAUTH2_GITHUB_CLIENT_SECRET` |
| `vault_coder_postgres_password` | `coder` | The `coder` database user's password. Letters, digits and `. _ ~ -` only (it sits unescaped in a URL); `openssl rand -hex 32` makes one |
| `vault_arc_service_principal_id` | `arc` | Application (client) id of `sp-arc-onboarding-lab-hybrid-prod-cus`, the Arc onboarding service principal |
| `vault_arc_service_principal_secret` | `arc` | Its client secret. Used once by `azcmagent connect`; delete it from the vault and from Entra once the host is Connected |
| `vault_arc_tenant_id` | `arc` | The Entra tenant id |
| `vault_arc_subscription_id` | `arc` | The application subscription's id (`sub-app-site-prod-cus`) |

PowerShell, one line per key set by hand, each with the order above:

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_cloudflare_api_token"
```

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_caddy_acme_email"
```

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_coder_oauth2_github_client_id"
```

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_coder_oauth2_github_client_secret"
```

The PostgreSQL password is made on the host and goes straight into the
vault, so it is never on a screen or a clipboard. Only for a database that
does not exist yet, which is a new or rebuilt host; a running one is
changed with "Rotating the PostgreSQL password", below. PowerShell:

```powershell
ssh hcw-lab "openssl rand -hex 32 | sudo -n /usr/local/sbin/hcw-vault-set vault_coder_postgres_password"
```

The four `vault_arc_*` lines are in
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md), "Seed the
vault", and the four `vault_labs_agent_*` keys are written by
`scripts/lab/Register-LabAgent.ps1` (below). Once the keys are in, re-run
`bootstrap.sh` ("Re-running", above); `HCW_REPO_REF=HEAD` applies the vault
without moving the host to a newer commit.

`vault_enabled`, `vault_version`, `vault_checksum` and
`vault_pgp_key_checksum` in `ansible/group_vars/all.yml` are not keys of
this file: they belong to the role that runs HashiCorp Vault (below), whose
name is `vault`, and none of them is a secret. `hcw-vault-set` accepts any
`vault_` name, so it cannot tell them apart; never set one there, because
`bootstrap.sh` passes `vault.yml` with `-e`, and a key in it overrides
`group_vars`.

The four `vault_labs_agent_*` keys and the three `vault_coder_*` keys can be
added later: until all four exist the agent stays stopped and the play says
so, and until the three exist the play stops at the `coder` role (Coder is
on). The four agent keys are not typed in by hand:
`scripts/lab/Register-LabAgent.ps1` writes them ("The agent identity",
below), merging them into `vault.yml` and leaving every other key as it
was, or creating the file with only those four when it does not exist yet.
Either order works with `hcw-vault-set`. The four `vault_arc_*` keys are
read only while `arc_enabled` is true and the host is not yet Connected;
the procedure that creates and then removes them is
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md).

`hcw-vault-set` only adds and replaces. To remove a key, or to read the
vault, open it in an editor. Bash, on the host:

```bash
sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

`hcw-vault-set` writes the file back from its parsed keys, sorted, so a
comment added in the editor does not survive its next run. Re-run
`bootstrap.sh` after either.

### The Cloudflare runtime token and its scope

Caddy answers the DNS-01 challenge for all three names through CNAME
delegation: `_acme-challenge.lab.hybridcloudworks.com` and
`_acme-challenge.coder.lab.hybridcloudworks.com` point into a dedicated lab
zone, and Caddy follows the CNAME to write the TXT record there. That zone
does not exist yet (owner decision 2026-09-25), so `infra-lab/dns.tf`
writes no delegation records; they are added there when it does. Once that zone exists, the runtime token needs `Zone:DNS:Edit` on the
lab zone only. **Until it exists, the token has `Zone:DNS:Edit` on the
production `hybridcloudworks.com` zone.** That is the interim risk ADR 0032
accepts, and it is written here so the follow-up — re-issue the token scoped
to the lab zone and rotate it in the vault — is a recorded step, not a
forgotten one. The token is in `/etc/caddy/env` and nowhere else on the
host. That file is owner `root`, group `caddy`, mode `0640` (ADR 0032): the
`caddy` unit runs as the non-root `caddy` user and reads it through
`EnvironmentFile=`, so the group read is what lets certificate renewals
keep working, and nobody outside that group can read it. The play writes
it with `no_log`.

## Coder

The `coder` role (#679) runs Coder Community edition and its PostgreSQL from
`../coder/docker-compose.yml` under `/etc/hcw/coder`, behind Caddy at
`https://coder.lab.hybridcloudworks.com`. The files, the workspace template
and the hardening test are described in
[`../coder/README.md`](../coder/README.md); this section is the operating
procedure. `ansible/group_vars/all.yml` holds the switches: `coder_enabled`
(`true` since 2026-09-28), `coder_oauth2_github_allowed_orgs`
(`[HybridCloudWorks]` since the same day), `coder_oauth2_github_allow_signups`
(`true`) and `coder_max_workspaces` (`5`).

**Coder is reached through panes on the site, never directly** (owner
decision 2026-09-28). Opened in a browser tab, any Coder page, dashboard or
workspace app, is redirected to https://hybridcloudworks.com/education/labs.
Inside a pane on the site it works as usual. So the steps below check Coder
from the command line or in a pane, and the one browser step at the top
level is the GitHub sign-in, because GitHub's pages cannot be framed. The
CLI, the workspace agents and the site's status proxy send no browser
navigation headers, so they are unaffected.

**An empty allowlist is not a lock.** Coder treats an empty
`CODER_OAUTH2_GITHUB_ALLOWED_ORGS` as "no organisation restriction" and lets
any GitHub account sign in, so `site.yml` asserts in `pre_tasks`, and the
role asserts again, that the list is non-empty whenever `coder_enabled` is
true and fails the play otherwise; with `coder_enabled: false` the asserts
are skipped.

### Turning it on

Owner decision 2026-09-28: Coder runs, and only members of the
`HybridCloudWorks` GitHub organisation may sign in. The change that
recorded it set `coder_enabled: true` and
`coder_oauth2_github_allowed_orgs: [HybridCloudWorks]`; the other two
things Coder needs were in place that day. The same three are what a
rebuilt host needs:

1. The GitHub OAuth app (#682), owned by the organisation, with homepage
   `https://coder.lab.hybridcloudworks.com` and callback
   `https://coder.lab.hybridcloudworks.com/api/v2/users/oauth2/github/callback`.
   It is listed at
   https://github.com/organizations/HybridCloudWorks/settings/applications;
   a new one is made at
   https://github.com/organizations/HybridCloudWorks/settings/applications/new.
2. The three `vault_coder_*` keys, with the lines under "Setting a key"
   above: the client id and secret from the app's page, and the PostgreSQL
   password made on the host.
3. The two switches in `ansible/group_vars/all.yml`, then a `bootstrap.sh`
   run (above), which checks out the merged `main`. Bash, on the host:

   ```bash
   sudo /opt/hcw-src/lab-host/bootstrap.sh
   ```

The play refuses to continue if the allowlist is empty, if any of the three
vault keys is missing, if the password holds a character outside
`A-Za-z0-9._~-`, or if five workspaces at 2 GiB plus 2.5 GiB of headroom
exceed the host's memory. Nothing creates a Coder user: the first person to
sign in becomes the owner ("First admin sign-in", below), so the owner signs
in before anyone else is told the lab is open.

On the run that turns it on, the `PLAY RECAP` shows `failed=0`, and the
changed tasks are Coder's: both environment files, `Start Coder and
PostgreSQL`, the Caddy route and its reload, the backup timer, and the pull
of the workspace image (`lab_images`, about 2.7 GB, so that task takes
minutes). Success then looks like `docker ps` showing `coder` and `coder-postgres`
(`sudo docker compose --project-directory /etc/hcw/coder ps` prints both
with `running` and the database `healthy`), and Coder answering through
Caddy. PowerShell, on the workstation:

```powershell
Invoke-RestMethod https://coder.lab.hybridcloudworks.com/api/v2/buildinfo | Select-Object version
```

That prints `v2.37.3` followed by a build suffix. In a pane on the site,
Coder's login page shows a **Sign in with GitHub** button and no password
form.

### First admin sign-in

There is no password account. Password authentication is off in the
Compose file, and Coder makes the first GitHub sign-in on an empty
deployment the **owner** (its `oauthLogin` allows the first user regardless
of the sign-up setting and grants the owner role). So the owner signs in
with GitHub before anyone else does. GitHub's pages cannot be framed, so
this is the one Coder step taken at the top level: open this address in
the browser, which starts Coder's GitHub sign-in:

https://coder.lab.hybridcloudworks.com/api/v2/users/oauth2/github/callback

GitHub asks the first time whether to authorize the app. The browser then
lands on https://hybridcloudworks.com/education/labs, where every top-level
visit to the lab ends, and the panes there are signed in. That landing is
the success; a Coder page in the tab would mean the panes-only rule is not
applied. To confirm the account is the owner, sign the CLI in (next section)
and run, PowerShell:

```powershell
coder users show me
```

Success is a `Roles` row reading `Owner`. Every later sign-in is a member.

The site's panes stay closed until the status token is seeded ("The status
token for the site", below), and that needs this sign-in's session. So
before opening the address above, open the browser's developer tools as in
step 1 there, and take the session from this sign-in rather than signing in
twice.

If the tab shows `You aren't a member of the authorized Github
organizations!` instead of the labs page, GitHub did not report the account
as a member of `HybridCloudWorks` to the app. Either the account is not a
member, or the organisation restricts OAuth app access and has not approved
this app; that policy is at
https://github.com/organizations/HybridCloudWorks/settings/oauth_application_policy.
No Coder account was created, so the next successful sign-in is still the
first.

### Publishing the template

The Coder CLI runs on the workstation, not on the host. PowerShell, once:

```powershell
winget install Coder.Coder
```

A plain `coder login` opens Coder's `/cli-auth` page in a browser tab. That
is a direct visit, so it lands on the labs page and never shows the token.
Sign the CLI in with a token instead. Create one in the Coder dashboard in a
pane on the site (the account menu, then **Account**, then **Tokens**; Coder's
path is `/settings/tokens`) and copy it. The panes open only once the
status token is seeded (below); before that, the sign-in session from its
step 1 works here too. Then, PowerShell, with the token on the clipboard:

```powershell
coder login https://coder.lab.hybridcloudworks.com --token (Get-Clipboard)
```

Success prints `Welcome to Coder, <your username>! You're authenticated.`
`coder login` saves a session of its own, so the token copied from the pane
can be deleted there afterwards.
Then, PowerShell, from the repository root on `main` after this change has
merged (the template directory must exist in the working tree):

```powershell
coder templates push hcw-lab --directory lab-host/coder/templates/hcw-lab --yes
```

```powershell
coder templates edit hcw-lab --default-ttl 1h --yes
```

`templates push` creates the template on the first run and publishes a new
version after that. The one-hour autostop is a template setting, not part
of `main.tf`, and `templates push` has no TTL flag in the current CLI
reference — `templates edit --default-ttl` is where it lives (a
`coder templates create --default-ttl 1h` exists too, but `push` is the
same command for first and later publishes). Success: `coder templates
list` shows `hcw-lab`, and the template's schedule page
(`/templates/hcw-lab/settings/schedule`, in a pane) shows a default
autostop of 1 hour. A workspace from it is
`https://coder.lab.hybridcloudworks.com/templates/hcw-lab/workspace?mode=auto&param.lab=terraform-validate-walkthrough`
loaded in a pane. That is the shape of the site's Open in Coder links
(#681). Those links open the address at the top level, which since
2026-09-28 lands on the labs page, so they have to open it in a pane.

### The status token for the site

The site's Coder card (#680) reads Coder with `CODER-STATUS-TOKEN`, from
the Function App, never the browser. `functions/src/lib/labs/coder-status.js`
makes three calls: `GET /api/v2/templates`, `GET
/api/v2/templateversions/{id}` for each template's active version, and `GET
/api/v2/workspaces?q=status:running`, whose `count` is the running figure
on the card. Its requests carry no `Sec-Fetch-Dest`, so the panes-only
rule passes them.

**What the token is, and why.** On Coder Community v2.37.3 the least
privilege that answers all three correctly is a token scoped to
`template:read` and `workspace:read`, belonging to a user of its own,
`hcw-status`, that holds the Template Admin role. Each part was measured on
2026-09-28 against the pinned image, with one workspace running that
belonged to another user:

- **A user of its own**, so the token is not the owner's, and its calls
  show in Coder's logs as `hcw-status`. Community cannot make a user that
  has no sign-in: `--login-type none` needs a service account, and the
  server answers `Service Accounts is a Premium feature`. A password user is
  refused while password sign-in is off (`Password based authentication is
  disabled!`). So `hcw-status` is a GitHub user whose address,
  `coder-status@hybridcloudworks.invalid`, is on a domain that cannot
  receive mail. GitHub cannot verify it for any account, so no GitHub
  sign-in can ever become this user; only the token can act as it.
- **Template Admin**, because it is the only role below Owner that can read
  every user's workspaces. As Member, Auditor or User Admin, the running
  count answered `0` while the workspace ran, and the card would have shown
  an idle lab.
- **The two scopes**, because they cap Template Admin at reading.

| `hcw-status`'s role, and the token's scope | The three calls | Change a template | Delete a template | Stop a workspace |
| --- | --- | --- | --- | --- |
| Template Admin, `template:read` and `workspace:read` | 200, 200, `count` 1 | Refused (`rbac: forbidden`; nothing changed) | 403 | 403 |
| Template Admin, no scope | 200, 200, `count` 1 | **200, changed** | **200, deleted** | 403 |
| Member, Auditor or User Admin | 200, 200, `count` **0** | Refused | not tried | Refused |

**Before you start.** Coder is on and you have signed in as its owner
("First admin sign-in", above). The steps run Coder's CLI inside the `coder`
container on the host, over `ssh hcw-lab`, so nothing is installed on the
workstation and nothing is a top-level visit. The CLI needs one token of
yours to act as the owner, which it reads from standard input, so it never
appears on a command line.

1. **A token of yours.** The site's panes open only once the Coder card's
   read answers reachable (`frontend/src/pages/shared/LabPanePage.jsx`),
   and that read needs the token these steps make. So the first time there
   is no pane to make a token in. Use the session your GitHub sign-in makes
   instead:

   1. Open a new browser tab, open the developer tools (F12), choose
      **Network**, and tick **Preserve log**.
   2. In that tab, open
      https://coder.lab.hybridcloudworks.com/api/v2/users/oauth2/github/callback
      and sign in with GitHub, as in "First admin sign-in". The tab ends on
      the labs page.
   3. In the Network list, choose the request whose name starts
      `callback?code=`, open its **Cookies** tab, and copy the **Value** of
      `coder_session_token` under **Response Cookies**.

   That is your owner session. It lasts 24 hours (Coder's default
   `--session-duration`), and it is only ever piped into the two lines
   below. Once the panes open (after step 4), a renewal can use a token
   made in a pane instead: the account menu, **Account**, then **Tokens**
   (Coder's path is `/settings/tokens`), then **Add token**, named
   `hcw-setup`, with the shortest expiry the form offers.

2. **The user and its role.** PowerShell, with that token on the clipboard:

   ```powershell
   (Get-Clipboard -Raw) | ssh hcw-lab "sudo -n docker exec -i -e CODER_URL=http://127.0.0.1:7080 coder sh -c 'tr -d \\r | { read -r CODER_SESSION_TOKEN; export CODER_SESSION_TOKEN; coder users show hcw-status >/dev/null 2>&1 || coder users create --username hcw-status --email coder-status@hybridcloudworks.invalid --login-type github; coder users edit-roles hcw-status --roles template-admin --yes && coder users show hcw-status; }'"
   ```

   Success is the user's table with `Username` `hcw-status`, `Status`
   `dormant` and `Roles` `Template Admin`. The first run prints `A new user
   has been created!` above it, with a note about GitHub sign-in that does
   not apply to this user. A second run changes nothing. `You are signed
   out or your session has expired` means the clipboard did not hold the
   step 1 token.

3. **The status token, straight to the clipboard.** PowerShell, with the
   step 1 token still on the clipboard. The output replaces it, so the new
   token is never on the screen:

   ```powershell
   (Get-Clipboard -Raw) | ssh hcw-lab "sudo -n docker exec -i -e CODER_URL=http://127.0.0.1:7080 coder sh -c 'tr -d \\r | { read -r CODER_SESSION_TOKEN; export CODER_SESSION_TOKEN; coder tokens create --user hcw-status --lifetime 1y --scope template:read --scope workspace:read; }'" | Set-Clipboard
   ```

   Success prints nothing. Check what the clipboard now holds, PowerShell:

   ```powershell
   Invoke-RestMethod 'https://coder.lab.hybridcloudworks.com/api/v2/workspaces?q=status:running' -Headers @{ 'Coder-Session-Token' = (Get-Clipboard -Raw).Trim() } | Select-Object count
   ```

   Success is a `count` row (`0` until someone starts a workspace). A `401`
   means the clipboard does not hold a new token, because step 3 printed an
   error instead of one. Make another token in step 1 and run step 3 again.

4. **Seed it.** At https://hybridcloudworks.com/admin/integrations?tab=keys,
   in the Hybrid Lab section, paste into **Coder status token** and save.
   Success is the row's light turning green. A minute later (the card's read
   is cached for one), PowerShell:

   ```powershell
   Invoke-RestMethod https://api-azure.hybridcloudworks.com/api/public/labs/coder-status | Select-Object configured, reachable, templates, capacity
   ```

   Success is `configured` `True` and `reachable` `True`, with `capacity`
   showing `running` and `max` 5, and `templates` listing `hcw-lab` once it
   is published ("Publishing the template", above; empty before that).
   `reachable` `False` means Coder refused the token or did not answer, and
   the check in step 3 tells which.

5. **Retire the step 1 token.** A sign-in session ends by itself after 24
   hours. A pane token is deleted in the pane: **Account**, **Tokens**,
   then delete `hcw-setup`.

Then, in a pull request, take `CODER_STATUS_TOKEN` off `EXPECTED_UNRESOLVED`
in `scripts/check-unresolved-secrets.mjs`, which `infra/functionapp.tf` asks
for once it is seeded, so from then on an unresolved reference fails the
monitor like any other.

The token expires a year after step 3, and nothing renews it: put the date
in the calendar. To renew, run steps 1, 3, 4 and 5 again. Step 3 makes a
new token each time (Coder names each one, which is why the line gives no
`--name`), and the old one stops working at its own expiry.
`coder tokens list --all` lists both, with `hcw-status` as their owner.

### Kill switches

Two, in ADR 0032's words, and emptying the allowlist is neither.

**No new learners; existing ones keep working.** Durable: a pull request
setting `coder_oauth2_github_allow_signups: false` in
`ansible/group_vars/all.yml`, merged and applied with `bootstrap.sh`.
Immediate, bash, on the host (the next `bootstrap.sh` run re-renders the
file from `group_vars`, so land the pull request too):

```bash
sudo sed -i 's/^CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS=.*/CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS=false/' /etc/hcw/coder/coder.env && sudo docker compose --project-directory /etc/hcw/coder up -d
```

**Everyone, at once.** Immediate, bash, on the host:

```bash
sudo docker compose --project-directory /etc/hcw/coder stop coder
```

Caddy then answers **503** `Lab workspaces aren't available right now.`,
the site's own sentence for the same state, for
`coder.lab` and every `*.coder.lab` name; running workspaces lose their
agent connection and stop themselves at their deadline. Durable: a pull
request setting `coder_enabled: false`, which also removes the Caddy route
(the names answer Caddy's 404) and stops the backup timer; the PostgreSQL
volume stays, so re-enabling brings the same users and templates back.
Those two answers, the 503 and the 404, are what a pane or a command-line
client sees. A top-level browser visit is still redirected to the labs page
first, as it is while Coder runs. To resume after an immediate stop:

```bash
sudo docker compose --project-directory /etc/hcw/coder up -d
```

### Rotating the GitHub OAuth secret

Regenerate the secret on the OAuth app's page under
https://github.com/organizations/HybridCloudWorks/settings/applications
and put it in the vault. PowerShell, pasted first, then copy the secret,
then Enter ("Setting a key", above):

```powershell
(Get-Clipboard -Raw) | ssh hcw-lab "sudo -n /usr/local/sbin/hcw-vault-set vault_coder_oauth2_github_client_secret"
```

Then re-run `bootstrap.sh`. The play rewrites
`coder.env` and Compose recreates the `coder` container because its
environment changed; the `PLAY RECAP` shows `changed` for those two tasks
and the login page, in a pane, still offers GitHub. Learners already
signed in keep their sessions.

### Rotating the PostgreSQL password

The database stores the password at first initialisation, so a vault edit
alone would lock Coder out. Change it in the database first, then in the
vault. Bash, on the host; the line generates the new value, sets it in the
database and then in the vault, and never prints it:

```bash
NEW="$(openssl rand -hex 32)" && sudo docker compose --project-directory /etc/hcw/coder exec -T coder-postgres psql -U coder -d coder -v ON_ERROR_STOP=1 -c "ALTER USER coder PASSWORD '$NEW'" && printf '%s\n' "$NEW" | sudo -n /usr/local/sbin/hcw-vault-set vault_coder_postgres_password; unset NEW
```

Success prints `ALTER ROLE` and then `hcw-vault-set: set
vault_coder_postgres_password (value not shown)` with the vault's key
names. Re-run `bootstrap.sh` promptly, with `HCW_REPO_REF=HEAD`
("Re-running", above): Coder's open connections keep working, new ones fail
until the run recreates the container with the new URL.

### Backups and restore

The timer writes `/var/backups/coder/coder-<UTC timestamp>.sql.gz` nightly
and keeps seven days; it is a convenience against operator error, not a
backup promise (`docs/architecture/labs-host.md`). Bash, on the host, to
see them and to take one now:

```bash
sudo ls -l /var/backups/coder
```

```bash
sudo systemctl start coder-postgres-backup.service && sudo systemctl status coder-postgres-backup.service --no-pager
```

Restore the newest dump into an empty database — three lines, bash, on the
host: stop Coder, recreate the database from the dump, start Coder.

```bash
sudo docker compose --project-directory /etc/hcw/coder stop coder
```

```bash
sudo sh -c 'docker compose --project-directory /etc/hcw/coder exec -T coder-postgres psql -U coder -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE coder" -c "CREATE DATABASE coder OWNER coder" && gunzip -c "$(ls -t /var/backups/coder/coder-*.sql.gz | head -1)" | docker compose --project-directory /etc/hcw/coder exec -T coder-postgres psql -U coder -d coder -v ON_ERROR_STOP=1 -q'
```

```bash
sudo docker compose --project-directory /etc/hcw/coder start coder
```

Success is `DROP DATABASE`, `CREATE DATABASE`, no error from the third
`psql`, and the `buildinfo` line under "Enabling" answering again within a
minute.

## Portainer

The `portainer` role runs Portainer Business Edition for the owner
(owner decision 2026-09-26; `ansible/roles/portainer/README.md` has the
edition, its licence and the pin). It holds the Docker socket, which is root
on this host, so it is published on `127.0.0.1:9443` and nowhere else, has
no Caddy route, and is reached through an SSH tunnel: whoever can open the
tunnel already has an SSH login, which is `sudo`.

### Turning it on

In a pull request, set `portainer_enabled: true` in
`ansible/group_vars/all.yml`, merge it and re-run `bootstrap.sh` (above).
Success is a `PLAY RECAP` with `failed=0` and the task `portainer : Say how
to reach Portainer` printing `Portainer 2.45.1 answers on
https://127.0.0.1:9443 on this host and nowhere else`.

### The first sign-in, and every visit after it

Every visit is one PowerShell line on the workstation, which opens a shell
on the host and the tunnel together, then <https://localhost:9443>:

```powershell
ssh -L 9443:127.0.0.1:9443 hcw-lab
```

The first sign-in has two more steps, because a fresh Portainer stops
serving five minutes after it starts and wants the one-time setup token it
prints in its log: restart it and read the token from inside that shell,
then create the administrator and enter the licence key. The steps, and
what success looks like, are in
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md), "Portainer
through an SSH tunnel". The administrator's password is in the owner's
password manager and the licence key is entered in Portainer's UI; neither
is in the repository or the Ansible vault.

### Turning it off

Durable: a pull request setting `portainer_enabled: false`, merged and
applied. The container is removed and the `portainer-data` volume stays, so
turning it back on brings back the same administrator, settings and
licence. Immediate, bash, on the host (the next run starts it again while
`portainer_enabled` is true):

```bash
sudo docker stop portainer
```

## HashiCorp Vault

The `vault` role runs HashiCorp Vault host-native, for **lab-host secrets
only** (owner decision 2026-09-26; `ansible/roles/vault/README.md` has the
verification chain, TLS and mlock). Not the Ansible vault above: that one
holds what the playbook needs and lives in `/etc/hcw/ansible`.

**The boundary.** This host runs learner workloads, and an escape from a
workspace or a job container is root on the host, which can read an
unsealed Vault's memory. So this Vault never holds a production
HybridCloudWorks secret: those stay in Azure Key Vault
`kv-site-prod-cus-01`. Nor does it hold anything that exists nowhere else,
because the host holds no data of record (ADR 0032); every value in it must
be one its issuer can issue again.

### Turning it on

In a pull request, set `vault_enabled: true` in
`ansible/group_vars/all.yml`, merge it and re-run `bootstrap.sh` (above).
Success is a `PLAY RECAP` with `failed=0` and the task `vault : Say what
state Vault is in` printing `It is not initialised`. The role never
initialises or unseals Vault; the next section is the owner's.

### Initialising, unsealing, and after every restart

Owner steps, over SSH, in
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md), "HashiCorp
Vault: initialising and unsealing": `vault operator init` once, whose five
unseal keys and root token go to the owner's password manager and nowhere
else, then `vault operator unseal` three times. **A restart seals Vault**,
and so does every reboot, including the unattended-upgrades reboot at 04:30,
so the three unseals are repeated after each. The login shell sets
`VAULT_ADDR=https://127.0.0.1:8200` and `VAULT_CACERT`
(`/etc/profile.d/hcw-vault.sh`), so `vault status` needs no flags; success
before initialising is `Initialized false` and `Sealed true`, exit code 2.

### Turning it off

Durable: a pull request setting `vault_enabled: false`, merged and applied.
The unit is stopped and disabled and `/var/lib/vault` stays, so turning it
back on brings back the same Vault, sealed. Immediate, bash, on the host
(the next run starts it again while `vault_enabled` is true):

```bash
sudo systemctl stop vault
```

## The agent identity

The first run generates the agent's private key **on the host** and never
moves it: `/etc/hcw/labs-agent.pem` holds the key and certificate as
`root:hcw-labs-agent` mode `0640`, so root owns it, the service reads it
through its group, and nobody else can (no ACLs). The certificate alone is
`/etc/hcw/labs-agent.crt`, and its CN is the agent id (`labs_agent_id`,
`vps-hostinger-01`).

Everything else the agent needs is one owner step, run once on the
workstation: `scripts/lab/Register-LabAgent.ps1`. It checks `az` is signed
in to the tenant; reads that certificate over `ssh hcw-lab` (the host checks
it against the private key and only reports whether they match); creates or
finds the app registration and service principal
`sp-labs-agent-lab-hybrid-prod-cus-01`; appends the certificate to it,
never replacing another credential; assigns it the one grant the Entra side
of the API checks, the `LabAgent` app role on the HCWSite API; has you
register the agent on the site, which writes the API's second gate, the
`lab_agents/vps-hostinger-01` registry document; writes the four
`vault_labs_agent_*` keys above into the vault; runs `bootstrap.sh`; and
reads the agent's state and journal to say whether it is heartbeating. The
registration is the one step done in the browser, because the route that
writes the document (`POST /api/cms/labs/agents`, #740) needs an admin's
sign-in: the script prints
https://hybridcloudworks.com/admin/labs?tab=agents with the agent id and the
service principal's object id to paste into **Register agent**, and waits
for Enter. It never prints a secret: the certificate is public, the four
values and the object id are identifiers, and the vault password never
leaves the host. A second run changes nothing and says so, without waiting,
and `-WhatIf` shows what a run would change.
PowerShell, from the repository root on `main` once this change has merged
(`Test-Path scripts/lab/Register-LabAgent.ps1` prints `True` when the working
tree has the script); when `az` is not signed in, the script stops and
prints the `az login` line to run first:

```powershell
pwsh -NoProfile -File scripts/lab/Register-LabAgent.ps1
```

Success is the line `Agent: hcw-labs-agent is active and has logged no
failure since it started: it is heartbeating.` near the end of the run,
which then exits 0, and `vps-hostinger-01` Online at
https://hybridcloudworks.com/admin/labs?tab=agents. The same tab is where the
agent is revoked: **Deactivate** on its card makes the API refuse it from its
next call, and **Activate** undoes that; registering it again never does.
Every result the script can end with, and what each means, is
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md), "The lab
agent's go-live".

## Rotating the agent certificate

The generated certificate is valid for 730 days and nothing renews it by
itself; every run of the play prints a warning once it is within 60 days of
expiry (`labs_agent_certificate_warn_days`). Rotation is a two-step swap so
the agent never holds a key whose certificate the app registration has not
seen. Bash, on the host:

```bash
sudo sh -c 'umask 077 && openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 730 -subj "/CN=vps-hostinger-01" -keyout /etc/hcw/labs-agent.next.pem -out /etc/hcw/labs-agent.next.crt && cat /etc/hcw/labs-agent.next.crt >> /etc/hcw/labs-agent.next.pem'
```

Register the new certificate before the agent uses it, with the same script
as the first time. PowerShell, on the workstation, from the repository root:

```powershell
pwsh -NoProfile -File scripts/lab/Register-LabAgent.ps1 -NextCertificate
```

It reads `/etc/hcw/labs-agent.next.crt`, checks it against
`labs-agent.next.pem` on the host, appends it to the app registration and
leaves the old certificate there; it touches neither the vault nor
`bootstrap.sh`. It ends by printing the swap below as one PowerShell line.
The same swap, bash, on the host:

```bash
sudo sh -c 'mv /etc/hcw/labs-agent.next.pem /etc/hcw/labs-agent.pem && mv /etc/hcw/labs-agent.next.crt /etc/hcw/labs-agent.crt && chown root:hcw-labs-agent /etc/hcw/labs-agent.pem && chmod 0640 /etc/hcw/labs-agent.pem && chmod 0644 /etc/hcw/labs-agent.crt && systemctl restart hcw-labs-agent'
```

Success looks like the agent back to Online on
https://hybridcloudworks.com/admin/labs?tab=agents within a minute, and
`sudo journalctl -u hcw-labs-agent -n 20 --no-pager` showing no `heartbeat
failed` line after its `starting against` line (a heartbeat that works logs
nothing). Only then remove the old certificate: run the script once more
without `-NextCertificate`, and once it finds the agent heartbeating it
prints the `az ad app credential delete` line for each other certificate on
the registration. A re-run of the play afterwards reports the certificate
task unchanged, because the file exists, and the expiry warning is gone.

## Validating without a host

Neither `ansible-core` nor `ansible-lint` is installed on the Windows
workstation; the checks run in the container CI's pip pins match, pinned by
digest so the result cannot change without a repository change. PowerShell,
from the repository root:

```powershell
docker run --rm -v "${PWD}\lab-host:/work" -w /work/ansible ghcr.io/ansible/community-ansible-dev-tools@sha256:775c81d53058009dd47b97872f4a86d3b0a9ce16ad9af3cc48514ce4197aa787 sh -c "ansible-galaxy collection install -r requirements.yml >/dev/null && ansible-lint --profile production && ansible-playbook --syntax-check -i inventory/localhost.yml site.yml"
```

The same in bash (Git Bash or Linux), from the repository root:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/lab-host:/work" -w /work/ansible ghcr.io/ansible/community-ansible-dev-tools@sha256:775c81d53058009dd47b97872f4a86d3b0a9ce16ad9af3cc48514ce4197aa787 sh -c "ansible-galaxy collection install -r requirements.yml >/dev/null && ansible-lint --profile production && ansible-playbook --syntax-check -i inventory/localhost.yml site.yml"
```

A passing result prints `Passed: 0 failure(s), 0 warning(s) in N files
processed of M encountered. Profile 'production' was required, and it
passed.` followed by `playbook: site.yml`. That digest is
`community-ansible-dev-tools:latest` as of 2026-09-23 (ansible-lint 26.9.0,
ansible-core 2.21.4, the same pins CI installs with pip); when the pins in
`ci.yml` move, move this digest with them. CI runs the same two commands in
the `ansible-lint (lab-host)` job of `.github/workflows/ci.yml`, gated on
changes under `lab-host/`.

The same job runs the test of `hcw-vault-set`
(`ansible/roles/vault_tools/README.md`, "Tests"). It runs as root, which
the image is, against a scratch vault. PowerShell, from the repository root:

```powershell
docker run --rm -v "${PWD}\lab-host:/work:ro" -w /work/ansible --entrypoint bash ghcr.io/ansible/community-ansible-dev-tools@sha256:775c81d53058009dd47b97872f4a86d3b0a9ce16ad9af3cc48514ce4197aa787 roles/vault_tools/tests/hcw-vault-set.test.sh
```

The same in bash (Git Bash or Linux), from the repository root:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/lab-host:/work:ro" -w /work/ansible --entrypoint bash ghcr.io/ansible/community-ansible-dev-tools@sha256:775c81d53058009dd47b97872f4a86d3b0a9ce16ad9af3cc48514ce4197aa787 roles/vault_tools/tests/hcw-vault-set.test.sh
```

A passing result has no `not ok` line and ends with
`hcw-vault-set.test.sh: all` and the number of checks, then `checks passed`.

The Coder files have their own checks — the hardening test, the Compose
parse and `terraform validate` — listed in
[`../coder/README.md`](../coder/README.md) and run by the
`coder (lab-host)` job of the same workflow on changes under
`lab-host/coder/`.

## Bumping a pin

| Pin | Lives in | How to read the current value |
| --- | --- | --- |
| Docker, buildx, compose | `docker_release_pins`, one entry per Ubuntu codename (the version strings name the release) | `roles/docker/README.md` |
| Azure Connected Machine agent | `arc_agent_version` | `roles/arc/README.md` |
| apt signing keys | `docker_apt_key_checksum`, `labs_agent_node_apt_key_checksum`, `arc_apt_key_checksums` (per codename: Microsoft signs the 26.04 and 24.04 repositories with different keys) | The bash lines below this table; a changed key is a decision, not a refresh |
| Caddy, Cloudflare module, builder image digest | `caddy_*` | `roles/caddy/README.md`; the digest is the index from `docker buildx imagetools inspect caddy:2.11.4-builder`, and the image is pulled by that digest, not by tag |
| Coder, PostgreSQL | `coder_image_*`, `coder_postgres_image_*` | `roles/coder/README.md`; index digests from `docker buildx imagetools inspect`, run as `image@digest` |
| Workspace image, Terraform providers, `code-server` module | `templates/hcw-lab/main.tf` under `../coder` | `../coder/README.md`, "Updating"; republished with `coder templates push`. While `coder_enabled` is true, the next run also pulls the new workspace digest (`lab_images`) |
| Job images | `IMAGES` in `vps-agent/lib/capabilities.js` | The comment above `IMAGES` there. Nothing to bump here: the next run pulls the new digest and removes the one it replaced (`roles/lab_images/README.md`) |
| node_exporter | `node_exporter_version`, `node_exporter_checksum` | `roles/node_exporter/README.md` |
| Portainer | `portainer_image_tag`, `portainer_image_digest` | `roles/portainer/README.md`, "Bumping the pin"; the newest LTS from Portainer's release list, the index digest from `docker buildx imagetools inspect`. No floor checks it: endoflife.date has no Portainer product |
| HashiCorp Vault and its signing key | `vault_version`, `vault_checksum`, `vault_pgp_key_checksum` | `roles/vault/README.md`, "Bumping the pin"; the checksum is the `linux_amd64.zip` line of the release's signed SHA256SUMS, and `scripts/version-floors.json` holds the version to the newest line. A changed key is a decision, not a refresh |
| Node.js | `labs_agent_node_version`; the line is `labs_agent_node_apt_repository_url` in `roles/labs_agent/defaults/main.yml` | NodeSource `node_26.x` package index |
| Repository commit | Not pinned. `HCW_REPO_REF` in `bootstrap.sh` defaults to `origin/main`, and `labs_agent_repo_ref` reads the playbook's own checkout | Nothing to bump: merge, then re-run. The run prints the sha; holding or rolling back a host is under "Re-running" |
| Collections, including the one transitive dependency | `requirements.yml` | Galaxy |
| Ansible tooling | `ANSIBLE_CORE_VERSION` in `bootstrap.sh`; the pip pins in `ci.yml`; the image digest above | PyPI; the image's `RepoDigests` |
| Python and uv | `PYTHON_VERSION`, `UV_VERSION` and `UV_SHA256` at the top of `bootstrap.sh` | https://www.python.org/downloads/ for the newest release; https://github.com/astral-sh/uv/releases for uv, whose `.sha256` asset beside `uv-x86_64-unknown-linux-gnu.tar.gz` is the value |

All in `ansible/group_vars/all.yml` unless the table says otherwise.

The apt signing key checksums are read with these three lines, bash, from
anywhere with network access; each prints the hex that goes after `sha256:`
in the matching variable. Docker's key first:

```bash
curl -sL https://download.docker.com/linux/ubuntu/gpg | sha256sum
```

NodeSource's key:

```bash
curl -sL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sha256sum
```

Microsoft's keys, for the Arc agent. The first is the `resolute` entry of
`arc_apt_key_checksums` (it signs the 26.04 repository), the second the
`noble` entry (it signs the 24.04 one):

```bash
curl -sL https://packages.microsoft.com/keys/microsoft-2025.asc | sha256sum
```

```bash
curl -sL https://packages.microsoft.com/keys/microsoft.asc | sha256sum
```
