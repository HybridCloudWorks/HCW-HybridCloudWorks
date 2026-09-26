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
docker buildx imagetools inspect postgres:18.6 | head -3
```

The `Digest:` line is the value. Cross-check it against the registry's own
`Docker-Content-Digest` for the same tag, which must print the same
`sha256:`. Bash, anywhere with `curl`:

```bash
curl -fsSI -H "Authorization: Bearer $(curl -fsS 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull' | sed -E 's/.*"token":"([^"]+)".*/\1/')" -H 'Accept: application/vnd.oci.image.index.v1+json' https://registry-1.docker.io/v2/library/postgres/manifests/18.6 | grep -i docker-content-digest
```

Coder's releases are at <https://github.com/coder/coder/releases>;
`ghcr.io/coder/coder:latest` resolved to the same digest as `v2.37.3` on
2026-09-25. Coder supports PostgreSQL 13 and later (its upstream
`compose.yaml` runs 17).

## PostgreSQL

### Where it runs

Owner decision 2026-09-26: Coder's database stays a PostgreSQL container on
the lab host, the `coder-postgres` service beside Coder in this role's
Docker Compose project. Coder stores its data in PostgreSQL and nothing
else ("Postgres 13 is the minimum supported version",
<https://coder.com/docs/admin/setup>), so the engine was never the choice;
where it runs was. Two alternatives were shown and not taken:

- **Coder's built-in PostgreSQL.** With `CODER_PG_CONNECTION_URL` unset,
  Coder downloads PostgreSQL binaries from Maven when it starts and keeps
  the data in its own config root. Those binaries would sit outside the
  digest pins everything else on the host runs from (ADR 0032), and the
  data would sit inside the Coder container, where this role's nightly
  `pg_dump` of `coder-postgres` does not reach.
- **Azure Database for PostgreSQL Flexible Server, Burstable B1ms.**
  $0.01921 an hour in Central US at the retail price, about $14 a month for
  compute alone (Azure retail prices API, read 2026-09-26), plus storage.
  Every query from the VPS would also cross the internet to Azure.

### The version: 18.6

PostgreSQL moved from 16.15 to **18.6**, the newest release of the newest
major, on 2026-09-26, while the host held no Coder data, so there was
nothing to migrate: the first `up` initialises an empty 18 cluster.
`postgres:18` and `postgres:18.6` resolved to the same index
(`sha256:5a5a84b1...2da9722`), and the registry header and the Docker Hub
API agreed. The 18 image keeps the cluster in a per-major directory,
`PGDATA=/var/lib/postgresql/18/docker`, under a `VOLUME` at
`/var/lib/postgresql`, so the Compose file mounts `coder-postgres-data`
there. At the old `/var/lib/postgresql/data` the image refuses to start.

The pin cannot fall behind unnoticed. Owner instruction 2026-09-26: the
newest general release of PostgreSQL. `scripts/version-floors.json` holds
`coder_postgres_image_tag` to the newest major, no more than two minor
releases behind its newest, and `version-floors.test.mjs` fails CI on a tag
below that, or on one that is not a general release written as MAJOR.MINOR
(`18`, `19beta4`). The weekly `update-version-floors` job reads
endoflife.date's `postgresql` product, which lists a major only from its
general release. It proposes a new major once that major's `.2` exists,
and never a beta or a release candidate. When a moved floor passes the
pin, that pull request goes red on it. A new minor release is a new digest
(the lines under "Bumping a pin" above), and a new major is "The next
major" below.

What was rehearsed that day, on Docker 29.8 with the committed Compose file
unchanged, the pinned Coder v2.37.3 and postgres:18.6 digests, and
stand-ins for the three role-written files:

1. `docker compose up -d --wait`: both containers up in 27 seconds, Coder's
   migrations at 585 (`000585_chat_search_english_config`, the newest
   v2.37.3 ships) with `dirty` false, `/healthz` answering 200, and the
   cluster at `/var/lib/postgresql/18/docker` on the named volume.
2. An owner account created with `coder server create-admin-user`, then
   this role's backup script, rendered from
   `templates/coder-postgres-backup.sh.j2` with Ansible, wrote
   `coder-<UTC timestamp>.sql.gz` (pg_dump 18.6 from server 18.6).
3. That dump restored into a fresh `postgres:18.6` on a fresh volume with
   the three-line procedure in `lab-host/README.md`, "Backups and
   restore": `DROP DATABASE`, `CREATE DATABASE`, and the load with no
   error. A second `pg_dump` of the restored database matched the first
   line for line (13,615 lines each). The only difference is the random
   `\restrict` key pg_dump writes on every run.
4. Coder v2.37.3 started on the restored database: `/healthz` 200,
   `/api/v2/buildinfo` 200 reporting `v2.37.3+3a24816` and the source's
   deployment id, `/api/v2/users/first` 200 (the restored owner), the
   schema still at 585, and no error lines in its log.

### The next major

Once the host holds Coder data, a new major is a dump and a restore, and it
cannot happen by accident. The 18 image refuses to initialise while another
major's cluster sits under `/var/lib/postgresql/<major>/docker` (the check
is in its entrypoint, docker-library/postgres#1259). On 2026-09-26 that
refusal was seen on this Compose file: exit 1 and a restart loop naming
the path. So a bumped pin alone fails the play's `up --wait` and changes
nothing. In order:

1. Rehearse it as above with the new digest, across majors: dump from the
   running major, restore into the new one, start Coder on the result.
2. On the host, stop Coder, take a dump, then stop PostgreSQL, so nothing
   writes after the dump. Bash:

   ```bash
   sudo docker compose --project-directory /etc/hcw/coder stop coder && sudo systemctl start coder-postgres-backup.service && sudo docker compose --project-directory /etc/hcw/coder stop coder-postgres
   ```

3. Set the 18 cluster aside inside the volume, under a name the check
   does not match. It stays there, untouched, as the way back. Bash, still
   on the 18 image:

   ```bash
   sudo docker compose --project-directory /etc/hcw/coder run --rm --no-deps --entrypoint mv coder-postgres /var/lib/postgresql/18/docker /var/lib/postgresql/18/docker.pre-upgrade
   ```

4. Merge the pin bump and re-run `bootstrap.sh`. The new image initialises
   an empty cluster and Coder migrates it. Until the next step, the first
   allowed GitHub account to sign in would own an empty deployment, so run
   the next step straight after.
5. Restore the step-2 dump with the three lines in `lab-host/README.md`,
   "Backups and restore". They stop Coder, recreate the database from the
   newest dump and start Coder again.

To go back, stop both services, set the new cluster aside the same way,
rename `docker.pre-upgrade` back to `docker`, and revert the pin.

## Handlers

`Reload caddy for the coder route` (route file added or removed), `Reload
systemd for the coder backup units` (unit files).

## Check mode

Safe. `getent` reads, the templates diff, `docker_compose_v2` reports what
`up` or `down` would do without doing it.
