# lab-host

Configuration management for the Hostinger lab host: the on-premises half of
the hybrid estate in #656, Phase 2 (#662). Terraform (#661) creates the VPS
and its DNS; everything on the host after that is here, so nothing is done by
hand over SSH and a follower can read every step.

## What runs on the host

| Role | Installs | Where |
| --- | --- | --- |
| `hardening` | `hcwadmin` key-only login with passwordless sudo, sshd drop-in (`PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`), ufw deny-in/allow-out with TCP 22, 80, 443, unattended-upgrades rebooting at 04:30, fail2ban sshd jail | `/etc/ssh/sshd_config.d/00-hcw-hardening.conf`, `/etc/sudoers.d/90-hcw-admin`, `/etc/apt/apt.conf.d/52hcw-unattended-upgrades`, `/etc/fail2ban/jail.d/hcw-sshd.local` |
| `docker` | Docker Engine 29.8.1 from Docker's apt repository, held; `json-file` logs 10 MB x 3, `live-restore` | `/etc/docker/daemon.json` |
| `node_exporter` | node_exporter 1.12.1, SHA256-verified, `127.0.0.1:9100` only | `/usr/local/bin/node_exporter`, `node_exporter.service` |
| `caddy` | Caddy 2.11.4 built with `caddy-dns/cloudflare` 0.2.4, wildcard TLS for `lab.hybridcloudworks.com` and `*.lab.hybridcloudworks.com` via DNS-01, placeholder response at the apex | `/usr/local/bin/caddy`, `/etc/caddy/Caddyfile`, `/etc/caddy/conf.d/`, `/etc/caddy/env` (root, 0600) |
| `labs_agent` | `vps-agent` as `hcw-labs-agent.service` under user `hcw-labs-agent` (in `docker`), Node.js 22 from NodeSource, repository checkout at a pinned sha, certificate generated on the host | `/opt/hcw-labs-agent`, `/etc/hcw/labs-agent.env` (root, 0600), `/etc/hcw/labs-agent.pem` (root, 0600), `/etc/hcw/labs-agent.crt` |

Each role's `README.md` explains its decisions; `meta/argument_specs.yml` is
its variable contract. Every version, digest and checksum is in
`ansible/group_vars/all.yml`, and the collections are pinned in
`ansible/requirements.yml`.

`site.yml` runs the roles in that order. Azure Arc (#663) and Coder (#679)
add a role each to the end of the list; Coder's Caddy route is a file in
`/etc/caddy/conf.d/`, the pattern `00-apex.caddy` shows.

## First run

The Hostinger post-install script from #661 downloads `bootstrap.sh` and
runs it as root. The script installs `ansible-core` 2.21.4 with pipx, clones
this repository at the sha pinned in `HCW_REPO_REF` into `/opt/hcw-src`,
installs the collections and runs `site.yml` against localhost. Without a
vault it still completes: the host is hardened, Docker and node_exporter
run, Caddy serves the placeholder over plain HTTP and says TLS is off, and
the agent unit is installed but not started.

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
| `vault_cloudflare_api_token` | `caddy` | Cloudflare API token with `Zone:DNS:Edit` on the `hybridcloudworks.com` zone, for the DNS-01 challenge |
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

## The agent identity

The first run generates the agent's private key **on the host** and never
moves it: `/etc/hcw/labs-agent.pem` (key and certificate, root-owned 0600) is
read by systemd and handed to the service through `LoadCredential`, so the
process sees a private copy and the original keeps its mode. The certificate
alone is `/etc/hcw/labs-agent.crt`. Provisioning the app registration that
the certificate is uploaded to, and the `lab_agents` registry document, are
the owner steps in `docs/standards/required-inputs.md` section 4.7; print
the certificate to upload with bash, on the host:

```bash
sudo cat /etc/hcw/labs-agent.crt
```

## Validating without a host

Neither `ansible-core` nor `ansible-lint` is installed on the Windows
workstation; the checks run in the same container CI uses the pip
equivalents of. PowerShell, from the repository root:

```powershell
docker run --rm -v "${PWD}\lab-host:/work" -w /work/ansible ghcr.io/ansible/community-ansible-dev-tools:latest sh -c "ansible-galaxy collection install -r requirements.yml >/dev/null && ansible-lint --profile production && ansible-playbook --syntax-check -i inventory/localhost.yml site.yml"
```

A passing result prints `Passed: 0 failure(s), 0 warning(s) on N files.
Last profile that met the criteria: production.` followed by
`playbook: site.yml`. CI runs the same two commands in the
`ansible-lint (lab-host)` job of `.github/workflows/ci.yml`, gated on
changes under `lab-host/`.

## Bumping a pin

| Pin | Lives in | How to read the current value |
| --- | --- | --- |
| Docker | `docker_version`, `docker_containerd_version` | `roles/docker/README.md` |
| Caddy, Cloudflare module, builder image digest | `caddy_*` | `roles/caddy/README.md`; the digest is the image index from `docker buildx imagetools inspect caddy:2.11.4-builder` |
| node_exporter | `node_exporter_version`, `node_exporter_checksum` | `roles/node_exporter/README.md` |
| Node.js | `labs_agent_node_version` | NodeSource `node_22.x` package index |
| Repository ref | `labs_agent_repo_ref` and `HCW_REPO_REF` | `git rev-parse origin/main` |
| Collections | `requirements.yml` | Galaxy |
| Ansible tooling | `ANSIBLE_CORE_VERSION` in `bootstrap.sh`; the pip pins in `ci.yml` | PyPI |

All in `ansible/group_vars/all.yml` unless the table says otherwise.
