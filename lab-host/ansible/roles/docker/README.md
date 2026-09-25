# docker

Docker Engine is the only runtime on the lab host (ADR 0032, no Kubernetes).
This role installs it from Docker's own apt repository at the versions pinned
in `group_vars/all.yml`, replacing the `curl -fsSL https://get.docker.com |
sh` step the Setup tab used to list.

## What it does

1. Installs `python3-docker` and `python3-requests` from Ubuntu: the
   `community.docker` modules the caddy role uses run on the target's
   interpreter and need them. These two are not pinned like the rest because
   they come from the Ubuntu archive, which drops a superseded version the
   day a security update replaces it, so an exact pin there fails the play
   on the next patch day; unattended-upgrades owns them instead.
2. Fetches Docker's signing key to `/etc/apt/keyrings/docker.asc` and adds the
   `stable` repository for the running release (`noble`) as a deb822 source
   (`/etc/apt/sources.list.d/docker.sources`) with `Signed-By`. The install
   step refreshes the cache itself, because the play-level refresh ran
   before this source existed.
3. Installs `docker-ce`, `docker-ce-cli`, `containerd.io`,
   `docker-buildx-plugin` and `docker-compose-plugin` at exact versions with
   `install_recommends: false`, then holds all five with `dpkg
   --set-selections`. The install carries `allow_change_held_packages`, so a
   pin bump on a re-run moves a held package rather than failing with "held
   packages were changed". buildx and compose are pinned rather than left as
   recommends because Coder and its PostgreSQL (#679) are the Docker Compose
   services ADR 0032 names, and a compose plugin that floats is a pin that
   is not one.
4. Writes `/etc/docker/daemon.json` from `docker_daemon_config`: `json-file`
   logs capped at 10 MB x 3 per container and `live-restore` so a daemon
   restart does not kill running jobs.
5. Enables and starts `docker.service`. The daemon is restarted only when
   `daemon.json` changes.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `docker_version` | required | apt version string for `docker-ce` and `docker-ce-cli` |
| `docker_containerd_version` | required | apt version string for `containerd.io` |
| `docker_buildx_version` | required | apt version string for `docker-buildx-plugin` |
| `docker_compose_version` | required | apt version string for `docker-compose-plugin` |
| `docker_daemon_config` | log driver, limits, live-restore | Rendered as `daemon.json` |
| `docker_apt_key_url` | Docker's gpg URL | Signing key source |
| `docker_apt_key_path` | `/etc/apt/keyrings/docker.asc` | Signing key location |
| `docker_apt_repository_url` | `https://download.docker.com/linux/ubuntu` | Repository base |

To bump, read the available versions from the repository's package index and
change the pins in `group_vars/all.yml`. The bash line below prints the
newest version string of each pinned package for Ubuntu 24.04:

```bash
curl -s https://download.docker.com/linux/ubuntu/dists/noble/stable/binary-amd64/Packages | awk '/^Package: (docker-ce|docker-ce-cli|containerd.io|docker-buildx-plugin|docker-compose-plugin)$/{p=$2} /^Version:/{if(p){print p, $2; p=""}}' | sort -k1,1 -k2,2V | awk '{v[$1]=$2} END{for(k in v) print k, v[k]}'
```

## Handlers

`Restart docker`.

## Check mode

Safe. `deb822_repository` and the `apt` install report what they would do
without doing it.
