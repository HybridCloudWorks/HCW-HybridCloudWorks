# docker

Docker Engine is the only runtime on the lab host (ADR 0032, no Kubernetes).
This role installs it from Docker's own apt repository at the version pinned in
`group_vars/all.yml`, replacing the `curl -fsSL https://get.docker.com | sh`
step the Setup tab used to list.

## What it does

1. Fetches Docker's signing key to `/etc/apt/keyrings/docker.asc` and adds the
   `stable` repository for the running release (`noble`) as a deb822 source
   (`/etc/apt/sources.list.d/docker.sources`) with `Signed-By`. The install
   step refreshes the cache itself, because the play-level refresh ran
   before this source existed.
2. Installs `docker-ce`, `docker-ce-cli` and `containerd.io` at exact versions
   with `install_recommends: false`, so the unpinned buildx and compose
   plugins are not pulled in, then holds all three with `dpkg --set-selections`.
3. Writes `/etc/docker/daemon.json` from `docker_daemon_config`: `json-file`
   logs capped at 10 MB x 3 per container and `live-restore` so a daemon
   restart does not kill running jobs.
4. Enables and starts `docker.service`. The daemon is restarted only when
   `daemon.json` changes.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `docker_version` | required | apt version string for `docker-ce` and `docker-ce-cli` |
| `docker_containerd_version` | required | apt version string for `containerd.io` |
| `docker_daemon_config` | log driver, limits, live-restore | Rendered as `daemon.json` |
| `docker_apt_key_url` | Docker's gpg URL | Signing key source |
| `docker_apt_key_path` | `/etc/apt/keyrings/docker.asc` | Signing key location |
| `docker_apt_repository_url` | `https://download.docker.com/linux/ubuntu` | Repository base |

To bump Docker, read the available versions from the repository's package
index and change the two pins in `group_vars/all.yml`. The bash line below
prints the newest `docker-ce` version string for Ubuntu 24.04:

```bash
curl -s https://download.docker.com/linux/ubuntu/dists/noble/stable/binary-amd64/Packages | grep -A3 '^Package: docker-ce$' | grep '^Version' | sort -V | tail -1
```

## Handlers

`Restart docker`.

## Check mode

Safe. `apt_repository` with `update_cache` and the `apt` install report what
they would do without doing it.
