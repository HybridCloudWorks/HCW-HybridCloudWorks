# caddy

TLS for the lab terminates in Caddy, host-native under systemd (ADR 0032).
It holds certificates for three names — `lab.hybridcloudworks.com`,
`*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com` —
obtained through the Cloudflare DNS-01 challenge. Everything behind it (Coder
in #679, anything later) is a route added to this role's `conf.d`, never a
second listener. Every name can be reached only through panes on the site
("Panes only", below). Docker Compose on this host is for Coder and its PostgreSQL
only; Caddy is not in it, because the upstream image lacks the module.

## Why a build and not a download

The stock `caddy` apt package has no Cloudflare module. The
`caddyserver.com/api/download` endpoint adds modules but **always builds the
latest Caddy release** and ignores a `version` parameter (checked
2026-09-25: a request naming a nonexistent version returned the identical
binary), so it cannot be pinned and has no checksum to record. This role
builds with `xcaddy` inside the official `caddy:<version>-builder` image
instead, **pulled and run by digest** (`caddy@sha256:…` from
`group_vars/all.yml`), never by tag: Docker verifies the content against the
digest on pull, a moved tag cannot change what runs, and a bumped pin is a
new reference that is simply pulled. Docker is already on the host, so
nothing new is installed to do it; the build takes a few minutes the first
time and is skipped once `/opt/caddy/bin/caddy-<version>-cloudflare-<module>-<first
12 hex of the builder digest>` exists. Bumping any of the three inputs
changes that filename and triggers a rebuild, so the binary on disk can
never claim a builder it was not built with.

The build's provenance is the `caddy_*` pins in `group_vars/all.yml` (Caddy
tag, module tag, the builder image's tag for humans and its index digest for
Docker), and the role writes the same facts to `<binary>.provenance` next to
the binary it produced.

## What it does

1. `caddy` system user and group, `/etc/caddy`, `/etc/caddy/conf.d`,
   `/opt/caddy/bin`, `/var/lib/caddy`.
2. Pulls `caddy@<pinned digest>` (`docker_image_pull`, `pull: not_present`,
   so a new digest is fetched and an existing one is not re-downloaded),
   runs `xcaddy build <caddy_version> --with
   github.com/caddy-dns/cloudflare@<module version>` in it, then refuses the
   result unless `caddy version` names the pinned version and `caddy
   list-modules` shows `dns.providers.cloudflare`.
3. Installs the binary to `/usr/local/bin/caddy`.
4. Writes `/etc/caddy/env` as owner `root`, group `caddy`, mode `0640` with
   `CLOUDFLARE_API_TOKEN` from `vault_cloudflare_api_token`, with `no_log`
   so the value never reaches output or diff. The unit runs as the non-root
   `caddy` user and reads the file through `EnvironmentFile=`, so the
   group read is what lets renewals work; nobody outside that group can
   read it. This is a **runtime** token, distinct from the one Terraform
   uses in #661.
5. Renders `/etc/caddy/conf.d/00-apex.caddy` (the placeholder `respond` for
   the apex) and `/etc/caddy/Caddyfile`, validated with `caddy validate`
   before it replaces the live file. The site block lists all three names,
   imports the `lab_panes_only` snippet (below) and then `conf.d/*.caddy`,
   and ends in a catch-all 404 for names nothing claims.
6. Installs `caddy.service` running as `caddy:caddy` with
   `EnvironmentFile=/etc/caddy/env`, `AmbientCapabilities=CAP_NET_BIND_SERVICE`
   and `Type=notify`, then enables and starts it.

**Fail closed.** With no token in the vault the Caddyfile serves a single
HTTP-only apex that answers 503 and says TLS is off. It imports nothing from
`conf.d`, so a missing secret can never put an application route (Coder's,
later) on plaintext. The first bootstrap is still green; the second run,
after the vault exists, switches to TLS.

## Panes only

Owner decision 2026-09-28: "The lab should only be accessible through
'panes' from my site, lock to that", and a direct visit goes to the site's
labs page. The Caddyfile's `lab_panes_only` snippet does both, and it is
imported into the site block ahead of every route. So it covers every lab
name and every response: the apex, a name nothing claims, Coder's names,
and any route added later. A route does not have to repeat it.

- **Only the site may frame the lab.** Every response carries
  `Content-Security-Policy: frame-ancestors` with `caddy_frame_ancestors`:
  `'self' https://hybridcloudworks.com https://www.hybridcloudworks.com`.
  There is no `X-Frame-Options`, because it cannot name an allowed origin.
  Both site hostnames are listed because `www` serves the site rather than
  redirecting to the apex. `'self'` is there for code-server, whose
  webviews are iframes of its own origin, and it admits no other site,
  because the browser checks every ancestor up to the top window. The
  header is set when the request arrives, so a proxied upstream's own
  policy is sent beside it and the browser enforces both. That is why
  Coder's route removes Coder's default `frame-ancestors 'self'`.
- **No direct browsing.** The named matcher `@lab_direct_visit` selects a
  top-level visit: `Sec-Fetch-Dest: document`, or no `Sec-Fetch-Dest` with
  `Sec-Fetch-Mode: navigate`. It answers with `302` to
  `caddy_direct_visit_redirect`, `https://hybridcloudworks.com/education/labs`.
  Everything else passes. That covers panes (`iframe`); fetch, XHR and
  WebSockets from a page in a pane (`empty`); subresources; and clients
  that send no fetch metadata, which are Coder's agents and CLI, curl, and
  the site's status proxy. `Vary: Sec-Fetch-Dest, Sec-Fetch-Mode` keeps a
  cache from answering one with the other's response.

A script can send any of these headers, so this is a browsing rule, not
access control. Coder's GitHub sign-in is the access control. ACME is
unaffected (DNS-01, and Caddy answers an HTTP challenge before routes run),
and so are Caddy's admin API and metrics on `127.0.0.1:2019`. The comments
in `templates/Caddyfile.j2` go through each case, and
`docs/architecture/labs-host.md`, "Panes only", records the decision.

## DNS-01 through delegation

`_acme-challenge.lab.hybridcloudworks.com` and
`_acme-challenge.coder.lab.hybridcloudworks.com` are CNAMEs into a dedicated
lab zone (#661); Caddy follows the CNAME and writes the TXT record there, so
the runtime token only needs DNS edit on that zone. Until the lab zone exists
the token has DNS edit on the production zone, the interim risk ADR 0032
accepts, recorded in `lab-host/README.md`.

## Adding a route (how #679 slots in)

Drop a file in `/etc/caddy/conf.d/` named `NN-<owner>.caddy` containing a
named matcher and a `handle` block, then notify `Reload caddy`. The
`00-apex.caddy` file is the example to copy. The route is panes-only with
nothing more to write.

A request that has to work at the top level can be let through with
`vars <matcher> lab_top_level_allowed true`. This is only for a request
that shows no page there, such as a redirect in a sign-in flow, because
anything it returns is a direct visit. Coder's GitHub callback is the one
use (`roles/coder/templates/10-coder.caddy.j2`). Searching the repository
for `lab_top_level_allowed` lists every exemption.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `caddy_version` | required | Caddy tag for `xcaddy build` |
| `caddy_cloudflare_module_version` | required | `caddy-dns/cloudflare` tag |
| `caddy_builder_image`, `caddy_builder_image_tag`, `caddy_builder_image_digest` | required | Builder image pin; pulled and run as `image@digest` |
| `caddy_site_domain` | required | Apex; matcher and fail-closed placeholder |
| `caddy_site_names` | required | Every name the site block serves |
| `caddy_frame_ancestors` | required | `frame-ancestors` sources on every response: `'self'` and the site's two origins |
| `caddy_direct_visit_redirect` | required | Where a top-level browser visit is sent with `302`: the site's labs page |
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
