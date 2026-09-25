# lab-host

Configuration management for the Hostinger lab host: the on-premises half of
the hybrid estate in #656, Phase 2 (#662), on the decisions in ADR 0032.
Terraform (#661) creates the VPS and its DNS; everything on the host after
that is here, so nothing is done by hand over SSH and a follower can read
every step.

## What runs on the host

| Role | Installs | Where |
| --- | --- | --- |
| `hardening` | `hcwadmin` key-only login with passwordless sudo, sshd drop-in (`PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`), ufw deny-in/allow-out with TCP 22, 80, 443, unattended-upgrades rebooting at 04:30, fail2ban sshd jail | `/etc/ssh/sshd_config.d/00-hcw-hardening.conf`, `/etc/sudoers.d/90-hcw-admin`, `/etc/apt/apt.conf.d/52hcw-unattended-upgrades`, `/etc/fail2ban/jail.d/hcw-sshd.local` |
| `docker` | Docker Engine 29.8.1, buildx 0.37.1 and compose 5.5.1 from Docker's apt repository, held; `json-file` logs 10 MB x 3, `live-restore` | `/etc/docker/daemon.json` |
| `node_exporter` | node_exporter 1.12.1, host-native, SHA256-verified, `127.0.0.1:9100` only | `/usr/local/bin/node_exporter`, `node_exporter.service` |
| `caddy` | Caddy 2.11.4 built with `caddy-dns/cloudflare` 0.2.4, host-native under systemd; TLS for `lab.hybridcloudworks.com`, `*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com` via DNS-01; placeholder response at the apex | `/usr/local/bin/caddy`, `/opt/caddy/bin/` (versioned binary and its `.provenance`), `/etc/caddy/Caddyfile`, `/etc/caddy/conf.d/`, `/etc/caddy/env` (root:caddy, 0640), `caddy.service` running as `caddy` |
| `labs_agent` | `vps-agent` host-native as `hcw-labs-agent.service` under user `hcw-labs-agent` (in `docker`), Node.js 22 from NodeSource, repository checkout at a pinned sha, certificate generated on the host | `/opt/hcw-labs-agent`, `/etc/hcw/labs-agent.env` (root, 0600), `/etc/hcw/labs-agent.pem` (root:hcw-labs-agent, 0640), `/etc/hcw/labs-agent.crt` |

Each role's `README.md` explains its decisions; `meta/argument_specs.yml` is
its variable contract. Every version, digest and checksum is in
`ansible/group_vars/all.yml`, and the collections are pinned in
`ansible/requirements.yml`.

`site.yml` runs the roles in that order. Azure Arc (#663) and Coder (#679)
add a role each to the end of the list. Docker Compose on this host is for
Coder and its PostgreSQL only (ADR 0032); Caddy and the agent are host
services, and Coder's Caddy route is a file in `/etc/caddy/conf.d/`, the
pattern `00-apex.caddy` shows.

## First run

The Hostinger post-install script from #661 downloads `bootstrap.sh` and
runs it as root. The script installs `ansible-core` 2.21.4 with pipx, clones
this repository at the sha pinned in `HCW_REPO_REF` into `/opt/hcw-src`,
installs the collections and runs `site.yml` against localhost. Without a
vault it still completes: the host is hardened, Docker and node_exporter
run, Caddy serves an HTTP-only apex answering 503 that says TLS is off (and
imports no routes, so nothing can leak over plaintext), and the agent unit
is installed but not started.

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

To move the host to a newer commit, change `HCW_REPO_REF` in `bootstrap.sh`
and `labs_agent_repo_ref` in `ansible/group_vars/all.yml` in the same pull
request, then re-run once it is on `main`. They are two pins because they
mean two things — which playbook runs, and which agent code runs — even
though they will usually match.

## The vault

Secrets never enter the repository. They live on the host in
`/etc/hcw/ansible/vault.yml`, encrypted with Ansible Vault, and the vault
password is `/etc/hcw/ansible/vault-password`, root-only. `bootstrap.sh`
passes both when they exist and runs without them when they do not. The
post-install script from #661 may write them before calling `bootstrap.sh`;
to create or edit them by hand, bash, on the host:

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

The four `vault_labs_agent_*` keys can be added later: until all four exist
the agent stays stopped and the play says so. To edit later, bash, on the
host:

```bash
sudo /usr/local/bin/ansible-vault edit --vault-password-file /etc/hcw/ansible/vault-password /etc/hcw/ansible/vault.yml
```

Then re-run `bootstrap.sh`.

### The Cloudflare runtime token and its scope

Caddy answers the DNS-01 challenge for all three names through CNAME
delegation: `_acme-challenge.lab.hybridcloudworks.com` and
`_acme-challenge.coder.lab.hybridcloudworks.com` point into a dedicated lab
zone that #661 creates, and Caddy follows the CNAME to write the TXT record
there. Once that zone exists, the runtime token needs `Zone:DNS:Edit` on the
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

## Coder, before its role exists (#679)

`ansible/group_vars/all.yml` already declares the two values the Coder role
will read, so the contract is in place before the code: `coder_enabled`
(default `false`) and `coder_oauth2_github_allowed_orgs` (default `[]`),
which the role renders as `CODER_OAUTH2_GITHUB_ALLOWED_ORGS`. **An empty
allowlist is not a lock.** Coder treats it as "no organisation restriction"
and lets any GitHub account sign in, so `site.yml` asserts in `pre_tasks`
that the list is non-empty whenever `coder_enabled` is true and fails the
play otherwise; with `coder_enabled: false`, as today, the assert is
skipped. Set the organisation(s) whose members may sign in before flipping
the flag.

To stop learners getting in, the kill switches are
`CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS=false` (no new learners; existing ones
keep working) or stopping the `coder` Compose service (everyone, at once).
Emptying the allowlist is neither: it opens the door.

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

## Bumping a pin

| Pin | Lives in | How to read the current value |
| --- | --- | --- |
| Docker, buildx, compose | `docker_version`, `docker_containerd_version`, `docker_buildx_version`, `docker_compose_version` | `roles/docker/README.md` |
| Caddy, Cloudflare module, builder image digest | `caddy_*` | `roles/caddy/README.md`; the digest is the image index from `docker buildx imagetools inspect caddy:2.11.4-builder` |
| node_exporter | `node_exporter_version`, `node_exporter_checksum` | `roles/node_exporter/README.md` |
| Node.js | `labs_agent_node_version` | NodeSource `node_22.x` package index |
| Repository ref | `labs_agent_repo_ref` and `HCW_REPO_REF` | `git rev-parse origin/main` |
| Collections | `requirements.yml` | Galaxy |
| Ansible tooling | `ANSIBLE_CORE_VERSION` in `bootstrap.sh`; the pip pins in `ci.yml`; the image digest above | PyPI; the image's `RepoDigests` |

All in `ansible/group_vars/all.yml` unless the table says otherwise.
