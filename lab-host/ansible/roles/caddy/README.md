# caddy

TLS for `lab.hybridcloudworks.com` and `*.lab.hybridcloudworks.com` terminates
in Caddy on the host, with one wildcard certificate obtained through the
Cloudflare DNS-01 challenge. Everything behind it (Coder in #679, anything
later) is a route added to this role's `conf.d`, never a second listener.

## Why a build and not a download

The stock `caddy` apt package has no Cloudflare module. The
`caddyserver.com/api/download` endpoint adds modules but **always builds the
latest Caddy release** and ignores a `version` parameter (checked
2026-09-25: a request naming a nonexistent version returned the identical
binary). So this role builds with `xcaddy` inside the official
`caddy:<version>-builder` image, pulled by tag and then asserted against the
digest in `group_vars/all.yml`. Docker is already on the host, so nothing new
is installed to do it; the build takes a few minutes the first time and is
skipped once `/opt/caddy/bin/caddy-<version>-cloudflare-<module>` exists.
Bumping either version changes that filename and triggers a rebuild.

## What it does

1. `caddy` system user and group, `/etc/caddy`, `/etc/caddy/conf.d`,
   `/opt/caddy/bin`, `/var/lib/caddy`.
2. Pulls the builder image, asserts its `RepoDigests` contains the pinned
   digest, runs `xcaddy build <caddy_version> --with
   github.com/caddy-dns/cloudflare@<module version>`, and refuses the result
   unless `caddy list-modules` shows `dns.providers.cloudflare`.
3. Installs the binary to `/usr/local/bin/caddy`.
4. Writes `/etc/caddy/env` (root, 0600) with `CLOUDFLARE_API_TOKEN` from
   `vault_cloudflare_api_token`, with `no_log` so the value never reaches
   output or diff.
5. Renders `/etc/caddy/conf.d/00-apex.caddy` (the placeholder `respond` for
   the apex) and `/etc/caddy/Caddyfile`, validated with `caddy validate`
   before it replaces the live file. The site block imports
   `conf.d/*.caddy` and ends in a catch-all 404 for wildcard names nothing
   claims.
6. Installs `caddy.service` with `EnvironmentFile=/etc/caddy/env`,
   `AmbientCapabilities=CAP_NET_BIND_SERVICE` and `Type=notify`, then
   enables and starts it.

With no token in the vault the Caddyfile serves the same routes over plain
HTTP and the catch-all says TLS is off. That keeps a first bootstrap green;
the second run, after the vault exists, switches to TLS.

## Adding a route (how #679 slots in)

Drop a file in `/etc/caddy/conf.d/` named `NN-<owner>.caddy` containing a
named matcher and a `handle` block, then notify `Reload caddy`. The
`00-apex.caddy` file is the example to copy.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `caddy_version` | required | Caddy tag for `xcaddy build` |
| `caddy_cloudflare_module_version` | required | `caddy-dns/cloudflare` tag |
| `caddy_builder_image`, `caddy_builder_image_tag`, `caddy_builder_image_digest` | required | Builder image pin |
| `caddy_site_domain` | required | Apex; the block also covers `*.` |
| `caddy_cloudflare_api_token` | `vault_cloudflare_api_token` or empty | DNS-01 credential |
| `caddy_acme_email` | `vault_caddy_acme_email` or empty | ACME contact, omitted when empty |
| `caddy_apex_response` | placeholder text | Apex body |
| `caddy_unknown_host_response` | placeholder text | 404 body |

Paths and the service user are in `defaults/main.yml`;
`meta/argument_specs.yml` is the contract.

## Handlers

`Restart caddy` (binary, env file, unit), `Reload caddy` (Caddyfile, conf.d).

## Check mode

Safe with one gap: on a host that has never been bootstrapped there is no
`caddy` binary, so the Caddyfile is rendered without `caddy validate` in
that one situation. Every later check run validates.
