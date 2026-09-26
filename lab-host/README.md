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
| `arc` | Azure Connected Machine agent 1.68.03532.1399 from Microsoft's apt repository, held, then `azcmagent connect` to `rg-lab-hybrid-prod-cus` as `arcs-lab-hybrid-prod-cus-01` with the onboarding service principal from the vault, skipped once Connected. Nothing until `arc_enabled` is true | `/opt/azcmagent/`, `/etc/apt/sources.list.d/microsoft-prod.sources`; the connect configuration is a temporary root-only file deleted in the same run |
| `docker` | Docker Engine 29.8.1, buildx 0.37.1 and compose 5.5.1 from Docker's apt repository, held; `json-file` logs 10 MB x 3, `live-restore` | `/etc/docker/daemon.json` |
| `node_exporter` | node_exporter 1.12.1, host-native, SHA256-verified, `127.0.0.1:9100` only | `/usr/local/bin/node_exporter`, `node_exporter.service` |
| `caddy` | Caddy 2.11.4 built with `caddy-dns/cloudflare` 0.2.4, host-native under systemd; TLS for `lab.hybridcloudworks.com`, `*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com` via DNS-01; placeholder response at the apex | `/usr/local/bin/caddy`, `/opt/caddy/bin/` (versioned binary and its `.provenance`), `/etc/caddy/Caddyfile`, `/etc/caddy/conf.d/`, `/etc/caddy/env` (root:caddy, 0640), `caddy.service` running as `caddy` |
| `coder` | Coder Community edition v2.37.3 and PostgreSQL 18.6 under Docker Compose from `../coder/docker-compose.yml`, both by digest; the Caddy route for `coder.lab` and `*.coder.lab`; a nightly `pg_dump` keeping seven days. Down until `coder_enabled` is true | `/etc/hcw/coder/` (`docker-compose.yml`, `.env`, `coder.env` and `coder-postgres.env`, the last two root 0600), `/etc/caddy/conf.d/10-coder.caddy`, `/usr/local/sbin/coder-postgres-backup`, `coder-postgres-backup.timer`, `/var/backups/coder/` |
| `labs_agent` | `vps-agent` host-native as `hcw-labs-agent.service` under user `hcw-labs-agent` (in `docker`), Node.js 26.10.0 from NodeSource, repository checkout at the commit the playbook runs from, certificate generated on the host | `/opt/hcw-labs-agent`, `/etc/hcw/labs-agent.env` (root, 0600), `/etc/hcw/labs-agent.pem` (root:hcw-labs-agent, 0640), `/etc/hcw/labs-agent.crt` |
| `portainer` | Portainer Business Edition 2.45.1 (LTS) by digest, one container with the Docker socket, HTTPS on **127.0.0.1:9443 only**, plain HTTP off, no Caddy route; reached through an SSH tunnel. Nothing until `portainer_enabled` is true | Container `portainer`, volume `portainer-data` |
| `vault` | HashiCorp Vault 2.1.1 host-native as `vault.service` under user `vault`, the download checked against HashiCorp's signature on SHA256SUMS; raft storage; API on **127.0.0.1:8200** and cluster port on **127.0.0.1:8201**, TLS from a certificate generated on the host. For lab-host secrets only; never initialised or unsealed by the role. Nothing until `vault_enabled` is true | `/usr/local/bin/vault`, `/opt/vault/` (downloads, signing key), `/etc/vault.d/vault.hcl` (root:vault, 0640), `/etc/vault.d/tls/`, `/var/lib/vault` (vault, 0700), `/etc/profile.d/hcw-vault.sh` |

Each role's `README.md` explains its decisions; `meta/argument_specs.yml` is
its variable contract. Every version, digest and checksum is in
`ansible/group_vars/all.yml`, and the collections are pinned in
`ansible/requirements.yml`.

`site.yml` runs the roles in that order: `arc` straight after `hardening`,
because the agent needs nothing the later roles install and the host should
appear in Azure even when a later role fails; `coder` after `caddy`, because
its route is a file in Caddy's `conf.d`, and before `labs_agent`; `portainer`
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
vault it still completes: the host is hardened, Docker and node_exporter
run, Caddy serves an HTTP-only apex answering 503 that says TLS is off (and
imports no routes, so nothing can leak over plaintext), Coder's Compose
project is installed under `/etc/hcw/coder` but down (`coder_enabled` is
false until the owner flips it, below), the agent unit is installed but
not started, and Portainer and Vault are not installed.

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
passes both when they exist and runs without them when they do not. To
create or edit them, bash, on the host:

```bash
sudo install -d -m 0700 -o root -g root /etc/hcw/ansible
```

```bash
sudo sh -c 'umask 077 && openssl rand -base64 32 > /etc/hcw/ansible/vault-password'
```

```bash
sudo /usr/local/bin/ansible-vault create --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

`ansible-vault create` opens an editor. Write these YAML keys, one per line,
with their values:

| Key | Read by | What it is |
| --- | --- | --- |
| `vault_cloudflare_api_token` | `caddy` | The **runtime** Cloudflare API token Caddy uses for DNS-01, distinct from the one Terraform holds in #661. See the note below on its scope |
| `vault_caddy_acme_email` | `caddy` | Optional. ACME account contact for expiry mail |
| `vault_labs_agent_api_base` | `labs_agent` | `LABS_AGENT_API_BASE`: the Functions API base including `/api`. Today that is the `func-site-prod-cus-01` app's `azurewebsites.net` host |
| `vault_labs_agent_tenant_id` | `labs_agent` | `LABS_AGENT_TENANT_ID` |
| `vault_labs_agent_client_id` | `labs_agent` | `LABS_AGENT_CLIENT_ID`: this agent's confidential app registration |
| `vault_labs_agent_api_scope` | `labs_agent` | `LABS_AGENT_API_SCOPE`: `api://<API client id>/.default`, matching the app's `ENTRA_API_AUDIENCE` |
| `vault_coder_oauth2_github_client_id` | `coder` | `CODER_OAUTH2_GITHUB_CLIENT_ID`: the GitHub OAuth app the owner creates in #682 |
| `vault_coder_oauth2_github_client_secret` | `coder` | `CODER_OAUTH2_GITHUB_CLIENT_SECRET` |
| `vault_coder_postgres_password` | `coder` | The `coder` database user's password. Letters, digits and `. _ ~ -` only (it sits unescaped in a URL); `openssl rand -hex 32` makes one |
| `vault_arc_service_principal_id` | `arc` | Application (client) id of `sp-arc-onboarding-lab-hybrid-prod-cus`, the Arc onboarding service principal |
| `vault_arc_service_principal_secret` | `arc` | Its client secret. Used once by `azcmagent connect`; delete it from the vault and from Entra once the host is Connected |
| `vault_arc_tenant_id` | `arc` | The Entra tenant id |
| `vault_arc_subscription_id` | `arc` | The application subscription's id (`sub-app-site-prod-cus`) |

`vault_enabled`, `vault_version`, `vault_checksum` and
`vault_pgp_key_checksum` in `ansible/group_vars/all.yml` are not keys of
this file: they belong to the role that runs HashiCorp Vault (below), whose
name is `vault`, and none of them is a secret.

The four `vault_labs_agent_*` keys and the three `vault_coder_*` keys can be
added later: until all four exist the agent stays stopped and the play says
so, and the three are only read once `coder_enabled` is true. The four
`vault_arc_*` keys are read only while `arc_enabled` is true and the host is
not yet Connected; the procedure that creates and then removes them is
[docs/runbooks/labs-host.md](../docs/runbooks/labs-host.md). To edit later,
bash, on the host:

```bash
sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

Then re-run `bootstrap.sh`.

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
(default `false`), `coder_oauth2_github_allowed_orgs` (default `[]`),
`coder_oauth2_github_allow_signups` (default `true`) and
`coder_max_workspaces` (`5`).

**An empty allowlist is not a lock.** Coder treats an empty
`CODER_OAUTH2_GITHUB_ALLOWED_ORGS` as "no organisation restriction" and lets
any GitHub account sign in, so `site.yml` asserts in `pre_tasks`, and the
role asserts again, that the list is non-empty whenever `coder_enabled` is
true and fails the play otherwise; with `coder_enabled: false` the asserts
are skipped.

### Enabling

1. The owner creates the GitHub OAuth app (#682) at
   `https://github.com/organizations/HybridCloudWorks/settings/applications/new`
   with homepage `https://coder.lab.hybridcloudworks.com` and callback
   `https://coder.lab.hybridcloudworks.com/api/v2/users/oauth2/github/callback`.
2. Add the three `vault_coder_*` keys from the table above to the vault.
   Bash, on the host; the first line prints a password to paste as
   `vault_coder_postgres_password`, the second opens the editor:

   ```bash
   openssl rand -hex 32
   ```

   ```bash
   sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
   ```

3. In a pull request, set `coder_enabled: true` and
   `coder_oauth2_github_allowed_orgs: [HybridCloudWorks]` in
   `ansible/group_vars/all.yml`, merge it and re-run `bootstrap.sh`
   (above), which checks out the merged `main`. The play refuses to continue
   if any of the three vault keys is missing, if the password holds a
   character outside `A-Za-z0-9._~-`, or if five workspaces at 2 GiB plus
   2.5 GiB of headroom exceed the host's memory.

Success looks like `docker ps` showing `coder` and `coder-postgres`
(`sudo docker compose --project-directory /etc/hcw/coder ps` prints both
with `running` and the database `healthy`), and
`https://coder.lab.hybridcloudworks.com/login` showing a **Sign in with
GitHub** button and no password form.

### First admin sign-in

There is no password account. Password authentication is off in the
Compose file, and Coder makes the first GitHub sign-in on an empty
deployment the **owner** (its `oauthLogin` allows the first user regardless
of the sign-up setting and grants the owner role). So the owner signs in at
`https://coder.lab.hybridcloudworks.com/login` with GitHub before anyone
else does; success is the dashboard, and
`https://coder.lab.hybridcloudworks.com/deployment/users` listing that
account with the role **Owner**. Every later sign-in is a member.

### Publishing the template

The Coder CLI runs on the workstation, not on the host. PowerShell, once:

```powershell
winget install Coder.Coder
```

```powershell
coder login https://coder.lab.hybridcloudworks.com
```

`coder login` opens the browser for a session token and asks for it back.
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
list` shows `hcw-lab`, and
`https://coder.lab.hybridcloudworks.com/templates/hcw-lab/settings/schedule`
shows a default autostop of 1 hour. A workspace from it is then a browser
visit to
`https://coder.lab.hybridcloudworks.com/templates/hcw-lab/workspace?mode=auto&param.lab=terraform-validate-walkthrough`,
which is the shape of the site's Open in Coder links (#681).

### The status token for the site

#680's status proxy reads Coder with a token that can list templates and
workspaces and nothing else. PowerShell, signed in as the owner:

```powershell
coder tokens create --name hcw-status-proxy --lifetime 8760h --scope template:read --scope workspace:read
```

The command prints the token once. Copy it, then store it as
`CODER-STATUS-TOKEN` in Key Vault with the command in #682, and put its
expiry (one year) in the calendar: nothing renews it. If this Coder version
rejects `--scope`, create the token without it from a member account that
owns no workspaces rather than from the owner.

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

Caddy then answers **503** `Coder is stopped on this host.` for
`coder.lab` and every `*.coder.lab` name; running workspaces lose their
agent connection and stop themselves at their deadline. Durable: a pull
request setting `coder_enabled: false`, which also removes the Caddy route
(the names answer Caddy's 404) and stops the backup timer; the PostgreSQL
volume stays, so re-enabling brings the same users and templates back. To
resume after an immediate stop:

```bash
sudo docker compose --project-directory /etc/hcw/coder up -d
```

### Rotating the GitHub OAuth secret

Regenerate the secret on the OAuth app's page under
`https://github.com/organizations/HybridCloudWorks/settings/applications`,
put it in the vault as `vault_coder_oauth2_github_client_secret` (the
`ansible-vault edit` line above), re-run `bootstrap.sh`. The play rewrites
`coder.env` and Compose recreates the `coder` container because its
environment changed; the `PLAY RECAP` shows `changed` for those two tasks
and the login page still offers GitHub. Learners already signed in keep
their sessions.

### Rotating the PostgreSQL password

The database stores the password at first initialisation, so a vault edit
alone would lock Coder out. Change it in the database first, then in the
vault. Bash, on the host; the line generates the new value, sets it, and
prints it once for the vault edit:

```bash
NEW="$(openssl rand -hex 32)" && sudo docker compose --project-directory /etc/hcw/coder exec -T coder-postgres psql -U coder -d coder -v ON_ERROR_STOP=1 -c "ALTER USER coder PASSWORD '$NEW'" && echo "$NEW"
```

Success prints `ALTER ROLE` and then the value. Put the value in the vault
as `vault_coder_postgres_password` and re-run `bootstrap.sh` promptly:
Coder's open connections keep working, new ones fail until the run
recreates the container with the new URL.

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
`psql`, and the login page back within a minute.

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
`/etc/hcw/labs-agent.crt`. Provisioning the app registration that the
certificate is uploaded to, and the `lab_agents` registry document, are the
owner steps in `docs/standards/required-inputs.md` section 4.7; print the
certificate to upload with bash, on the host:

```bash
sudo cat /etc/hcw/labs-agent.crt
```

## Rotating the agent certificate

The generated certificate is valid for 730 days and nothing renews it by
itself; every run of the play prints a warning once it is within 60 days of
expiry (`labs_agent_certificate_warn_days`). Rotation is a two-step swap so
the agent never holds a key whose certificate the app registration has not
seen. Bash, on the host:

```bash
sudo sh -c 'umask 077 && openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 730 -subj "/CN=vps-hostinger-01" -keyout /etc/hcw/labs-agent.next.pem -out /etc/hcw/labs-agent.next.crt && cat /etc/hcw/labs-agent.next.crt >> /etc/hcw/labs-agent.next.pem'
```

```bash
sudo cat /etc/hcw/labs-agent.next.crt
```

Upload that certificate to the agent's app registration (the same owner
step as the first one, `docs/standards/required-inputs.md` section 4.7) and
leave the old certificate in place there until the swap below has run. Then,
bash, on the host:

```bash
sudo sh -c 'mv /etc/hcw/labs-agent.next.pem /etc/hcw/labs-agent.pem && mv /etc/hcw/labs-agent.next.crt /etc/hcw/labs-agent.crt && chown root:hcw-labs-agent /etc/hcw/labs-agent.pem && chmod 0640 /etc/hcw/labs-agent.pem && chmod 0644 /etc/hcw/labs-agent.crt && systemctl restart hcw-labs-agent'
```

Success looks like the agent back to Online on `/admin/labs` within a
minute and `sudo journalctl -u hcw-labs-agent -n 20 --no-pager` showing a
heartbeat rather than an authentication error. Only then remove the old
certificate from the app registration. A re-run of the play afterwards
reports the certificate task unchanged, because the file exists, and the
expiry warning is gone.

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
| Workspace image, Terraform providers, `code-server` module | `templates/hcw-lab/main.tf` under `../coder` | `../coder/README.md`, "Updating"; republished with `coder templates push` |
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
