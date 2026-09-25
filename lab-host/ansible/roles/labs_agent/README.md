# labs_agent

Runs `vps-agent/` as the `hcw-labs-agent` systemd service the admin Labs
page's Setup tab describes, host-native (ADR 0032), from a checkout of this
repository at a pinned commit. It is the last role in `site.yml` because it
needs Docker (the agent's job is `docker run`) and reads the same vault Caddy
does.

## systemd, not a container

ADR 0032 settled this: vps-agent is host-native. The reasons are the ones
that made it the right call before the ADR said so:

- The agent's entire purpose is to spawn `docker run`. A containerised agent
  needs the Docker socket mounted and a Docker CLI baked into an image the
  repository does not have (there is no `vps-agent/Dockerfile`), which is a
  second supply chain to pin for no isolation gain: socket access is host
  root either way.
- The env contract in `vps-agent/.env.example` and the Agents tab's own
  diagnostics (`systemctl restart hcw-labs-agent`, `journalctl -u
  hcw-labs-agent`) already assume a host service.

## What it does

1. `hcw-labs-agent` system user, primary group of the same name, member of
   `docker`.
2. Node.js 22 from NodeSource at `labs_agent_node_version`, held; the
   install carries `allow_change_held_packages` so a pin bump on a re-run
   moves the held package instead of failing.
3. `git` checkout of `labs_agent_repo_url` at `labs_agent_repo_ref` into
   `/opt/hcw-labs-agent` (root-owned; the agent reads its own code and
   cannot change it), then `npm ci --omit=dev` in `vps-agent/`. A stamp in
   `/var/lib/hcw-labs-agent/deps-installed-<ref>` records that the install
   ran for this ref, so a re-run is a no-op and a bumped ref reinstalls.
4. If `/etc/hcw/labs-agent.pem` does not exist, generates an RSA-4096 key and
   a self-signed certificate **on this host** (`CN=<labs_agent_id>`, 730
   days), as `.env.example` asks. The PEM is `root:hcw-labs-agent` mode
   `0640`: root owns it, the service's group can read it, nobody else can,
   and there are no ACLs. The certificate alone is written to
   `/etc/hcw/labs-agent.crt` (0644) for upload to the app registration;
   the private key never leaves the host.
5. Writes `/etc/hcw/labs-agent.env` (root, 0600, `no_log`) with exactly the
   names in `vps-agent/.env.example`; `LABS_AGENT_CERT_PATH` is
   `/etc/hcw/labs-agent.pem`.
6. Installs `hcw-labs-agent.service` (`Restart=on-failure`,
   `Requires=docker.service`, `NoNewPrivileges`, `ProtectSystem=full`,
   `PrivateTmp`) and starts it **only when all four identity values are
   set**. Otherwise it explicitly stops and disables the unit and deletes
   `/etc/hcw/labs-agent.env` — so removing a value from the vault and
   re-running is a revocation: the agent goes offline and a manual
   `systemctl start` cannot bring it back on the old credentials — and
   prints what is missing. The identity is an owner step recorded in
   `docs/standards/required-inputs.md` section 4.7.

`lib/docker-runner.js` stages each job's payload under `os.tmpdir()` and
bind-mounts that path into the job container. With `PrivateTmp` the unit's
`/tmp` is invisible to the Docker daemon, so the unit sets
`TMPDIR=/var/lib/hcw-labs-agent/tmp`, a real host directory owned by the
agent, and the role creates it.

The role sets no Docker labels and passes nothing to the jobs the agent
starts; the `hcw.lab-job` label ADR 0032 requires on every job container is
the agent's own code change (#675), not this role's.

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
report without acting; the stop-and-disable task is guarded on the unit
file existing, so a never-bootstrapped host does not fail on a unit systemd
has never seen.
