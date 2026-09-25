# labs_agent

Runs `vps-agent/` as the `hcw-labs-agent` systemd service the admin Labs
page's Setup tab describes, from a checkout of this repository at a pinned
commit. It is the last role in `site.yml` because it needs Docker (the agent's
job is `docker run`) and reads the same vault Caddy does.

## systemd, not a container

The issue said "as a container"; this role runs the agent directly under
systemd, on purpose:

- The agent's entire purpose is to spawn `docker run`. A containerised agent
  needs the Docker socket mounted and a Docker CLI baked into an image the
  repository does not have (there is no `vps-agent/Dockerfile`), which is a
  second supply chain to pin for no isolation gain: socket access is host
  root either way.
- The env contract in `vps-agent/.env.example` and the Agents tab's own
  diagnostics (`systemctl restart hcw-labs-agent`, `journalctl -u
  hcw-labs-agent`) already assume a host service.
- The certificate rule — root-owned, 0600, outside the repository — is met
  exactly with systemd `LoadCredential`, below, and would need a bind mount
  and a relaxed mode in a container.

## What it does

1. `hcw-labs-agent` system user, primary group of the same name, member of
   `docker`.
2. Node.js 22 from NodeSource at `labs_agent_node_version`, held.
3. `git` checkout of `labs_agent_repo_url` at `labs_agent_repo_ref` into
   `/opt/hcw-labs-agent` (root-owned; the agent reads its own code and
   cannot change it), then `npm ci --omit=dev` in `vps-agent/`. A stamp in
   `/var/lib/hcw-labs-agent/deps-installed-<ref>` records that the install
   ran for this ref, so a re-run is a no-op and a bumped ref reinstalls.
4. If `/etc/hcw/labs-agent.pem` does not exist, generates an RSA-4096 key and
   a self-signed certificate **on this host** (`CN=<labs_agent_id>`, 730
   days), as `.env.example` asks, and keeps it `root:root` 0600. The
   certificate alone is written to `/etc/hcw/labs-agent.crt` (0644) for
   upload to the app registration.
5. Writes `/etc/hcw/labs-agent.env` (root, 0600, `no_log`) with exactly the
   names in `vps-agent/.env.example`. `LABS_AGENT_CERT_PATH` is
   `/run/credentials/hcw-labs-agent.service/labs-agent.pem`: the unit has
   `LoadCredential=labs-agent.pem:/etc/hcw/labs-agent.pem`, so systemd (as
   root) reads the file and exposes a copy only the service can read. No
   group, ACL or relaxed mode on the original.
6. Installs `hcw-labs-agent.service` (`Restart=on-failure`,
   `Requires=docker.service`, `NoNewPrivileges`, `ProtectSystem=full`) and
   starts it **only when all four identity values are set**. Otherwise it
   prints what is missing and leaves the unit installed and stopped. The
   identity is an owner step recorded in
   `docs/standards/required-inputs.md` section 4.7.

## Variables

Pins and identity (required, from `group_vars/all.yml`): `labs_agent_user`,
`labs_agent_home`, `labs_agent_repo_url`, `labs_agent_repo_ref`,
`labs_agent_node_version`, `labs_agent_id`.

From the vault (each defaults to its `vault_` twin, empty when absent):
`labs_agent_api_base`, `labs_agent_tenant_id`, `labs_agent_client_id`,
`labs_agent_api_scope`.

Job limits with the `.env.example` defaults: `labs_agent_max_concurrent`,
`labs_agent_poll_ms`, `labs_agent_job_memory`, `labs_agent_job_cpus`,
`labs_agent_job_pids`. Paths and the unit name are in `defaults/main.yml`;
`meta/argument_specs.yml` is the contract.

## Handlers

`Restart hcw-labs-agent`, which is itself conditional on the identity being
configured so an unconfigured host never starts a crash-looping unit.

## Check mode

Safe. `git`, `shell` with `creates`, `template` and `systemd_service` all
report without acting.
