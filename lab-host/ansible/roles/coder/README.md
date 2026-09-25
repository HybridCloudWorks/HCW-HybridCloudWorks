# coder

Coder Community edition and its PostgreSQL under Docker Compose, behind the
Caddy the `caddy` role runs (ADR 0032, decisions 2 and 4; #679, Phase 1 of
#659). The Compose file is `lab-host/coder/docker-compose.yml` in this
repository; this role puts it on the host, writes the three files it reads,
starts or stops it, adds the Caddy route and keeps a week of nightly dumps.

## What it does

1. **Fails closed** when `coder_enabled` is true and any of these holds: the
   GitHub organisation allowlist is empty (an empty
   `CODER_OAUTH2_GITHUB_ALLOWED_ORGS` lets any GitHub account in); one of
   `vault_coder_oauth2_github_client_id`,
   `vault_coder_oauth2_github_client_secret` and
   `vault_coder_postgres_password` is unset; the password holds a character
   that would need escaping in `CODER_PG_CONNECTION_URL`; or
   `coder_max_workspaces` workspaces at 2 GiB each plus 2.5 GiB for Coder,
   PostgreSQL and the OS exceed the host's memory. The last one is what makes
   `coder_max_workspaces` a number the host is actually sized for rather than
   a comment: Coder Community does not enforce a workspace count.
2. Reads the `docker` group's id with `getent` and writes it, with the two
   `image@digest` references from `group_vars/all.yml`, to
   `/etc/hcw/coder/.env`, which Compose interpolates into the file. The
   digests live once, in `group_vars`, and the Compose file names no
   version of its own.
3. Copies `lab-host/coder/docker-compose.yml` from the repository checkout
   to `/etc/hcw/coder/docker-compose.yml`. One source, no copy under
   `files/`.
4. Writes `/etc/hcw/coder/coder.env` (GitHub OAuth client id and secret, the
   allowlist, `CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS`, the PostgreSQL connection
   URL) and `/etc/hcw/coder/coder-postgres.env` (`POSTGRES_PASSWORD`), both
   `root:root` `0600`, with `no_log`. Two files so the database container
   never receives the OAuth secret. While disabled both are written empty:
   the Compose file marks them `required`, so `docker compose down` could
   not parse the project without them, and an empty file leaves nothing for
   a manual `up` to reuse.
5. `docker compose up -d --wait` (`community.docker.docker_compose_v2`,
   `pull: missing`, `remove_orphans`) when enabled; `docker compose down`
   with the volume kept when not. A changed `coder.env` recreates the
   `coder` container on the next run, which is how a rotated secret takes
   effect.
6. Renders `/etc/caddy/conf.d/10-coder.caddy` (`root:caddy` `0640`): a host
   matcher for `coder.lab.hybridcloudworks.com` and
   `*.coder.lab.hybridcloudworks.com`, `reverse_proxy 127.0.0.1:7080`, and a
   `handle_errors` that answers **503** with a sentence when the `coder`
   service is stopped, which is the everyone-at-once kill switch in ADR
   0032. Removed while disabled, so Caddy's catch-all 404 answers instead.
   Caddy is reloaded either way through this role's own handler.
7. Installs `/usr/local/sbin/coder-postgres-backup` and the
   `coder-postgres-backup.service` and `.timer` units: nightly at 03:30 UTC
   (ten minutes of jitter, `Persistent=true`), `pg_dump` through `docker
   compose exec` into `/var/backups/coder/coder-<UTC timestamp>.sql.gz`
   (`root` `0700`), dumps older than seven days deleted, a `.partial` name
   until the dump completes so a failed run never looks like a backup. The
   timer runs only while enabled. This is the convenience
   `docs/architecture/labs-host.md` describes, not a backup promise.

The privilege boundary is the Compose file's and the template's, not this
role's: the socket goes to the `coder` service only, and
`lab-host/coder/templates/hcw-lab/template.test.mjs` asserts what a
workspace may and may not have.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `coder_enabled` | required (`false` in `group_vars`) | Run or stop Coder |
| `coder_oauth2_github_allowed_orgs` | required (`[]` in `group_vars`) | `CODER_OAUTH2_GITHUB_ALLOWED_ORGS`; non-empty while enabled |
| `coder_oauth2_github_allow_signups` | required (`true` in `group_vars`) | `CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS`; `false` is the no-new-learners switch |
| `coder_domain` | required | `coder.lab.hybridcloudworks.com` |
| `coder_max_workspaces` | required | Capacity the host is sized for; asserted against memory |
| `coder_image`, `coder_image_tag`, `coder_image_digest` | required | Coder pin; run as `image@digest` |
| `coder_postgres_image`, `coder_postgres_image_tag`, `coder_postgres_image_digest` | required | PostgreSQL pin; run as `image@digest` |
| `coder_oauth2_github_client_id` | `vault_coder_oauth2_github_client_id` or empty | OAuth app |
| `coder_oauth2_github_client_secret` | `vault_coder_oauth2_github_client_secret` or empty | OAuth app |
| `coder_postgres_password` | `vault_coder_postgres_password` or empty | Database user `coder`; RFC 3986 unreserved characters only |
| `coder_workspace_memory_mib` | `2048` | Per-workspace limit the template sets, for the capacity assertion |
| `coder_server_memory_reserve_mib` | `2560` | Coder, PostgreSQL and OS headroom in the same assertion |
| `coder_backup_keep_days`, `coder_backup_on_calendar` | `7`, `*-*-* 03:30:00` | The dump schedule |

Paths, the port and the unit names are in `defaults/main.yml`;
`meta/argument_specs.yml` is the contract.

## Bumping a pin

Both digests are image **indexes**, read with `docker buildx imagetools
inspect`; the tag beside each is for humans. Bash, anywhere with Docker:

```bash
docker buildx imagetools inspect ghcr.io/coder/coder:v2.37.3 | head -3
```

```bash
docker buildx imagetools inspect postgres:16 | head -3
```

The `Digest:` line is the value. Coder's releases are at
<https://github.com/coder/coder/releases>; `ghcr.io/coder/coder:latest`
resolved to the same digest as `v2.37.3` on 2026-09-25. Stay on the
PostgreSQL 16 line unless Coder's `pg_dump` and a restore have been
rehearsed on the new major.

## Handlers

`Reload caddy for the coder route` (route file added or removed), `Reload
systemd for the coder backup units` (unit files).

## Check mode

Safe. `getent` reads, the templates diff, `docker_compose_v2` reports what
`up` or `down` would do without doing it.
