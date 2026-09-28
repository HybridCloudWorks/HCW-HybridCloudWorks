# lab-host/coder

Coder Community edition on the lab host: the Compose file, the `hcw-lab`
workspace template and the test that holds both to the boundary ADR 0032
draws (#679, Phase 1 of #659). The Ansible `coder` role in `../ansible`
deploys the Compose file; the template is published from a workstation with
the Coder CLI. Operating procedures — enabling, first sign-in, the kill
switches, rotation, backups — are in [`../README.md`](../README.md) under
"Coder".

## Files

| File | What it is |
| --- | --- |
| `docker-compose.yml` | `coder` and `coder-postgres`, the only two Compose services on the host. Images are interpolated from a role-written `.env` so the digests live once, in `../ansible/group_vars/all.yml`. Every `CODER_*` name is checked against <https://coder.com/docs/reference/cli/server> (comment at the top) |
| `compose-config-check.sh` | Proves the Compose file parses without the host: stand-ins for the three role-written files in a temporary directory, then `docker compose config`. Prints the two service names on success |
| `templates/hcw-lab/main.tf` | The workspace template: Coder's Docker starter adapted to uid 65534, one CPU, 2 GiB, no socket, no host path, no capabilities, a per-workspace volume and a per-workspace bridge network, `code-server` on `*.coder.lab`. Providers and the module are pinned; `.terraform.lock.hcl` is committed |
| `templates/hcw-lab/README.md` | Shown to learners on the template's page in Coder |
| `templates/hcw-lab/template.test.mjs` | The hardening test (`node --test`). Fails when the socket appears outside the `coder` service, anything is `privileged`, the workspace maps a host path, joins the Compose network or does not run as 65534, or when workspace apps could be served by path on the dashboard's origin (`CODER_DISABLE_PATH_APPS` not `"true"`, or an app that is not a subdomain app) |
| `package.json` | `npm test` runs `node --test`; no dependencies, no lockfile |
| `launcher/` | The lab launcher: `index.html`, `main.js`, `launcher.js` and `launcher.css`, static, with no build step and no third-party code. The `coder` role installs them and Caddy serves them at `https://coder.lab.hybridcloudworks.com/_hcw/lab/` (below). `scripts/lab-host-launcher.test.mjs` tests the logic in `launcher.js` with a mocked Coder, the files and the route |

## The lab launcher

The site's panes load this, not a Coder page (owner decision 2026-09-28:
the lab is reached only through panes on the site). Coder's dashboard opens
code-server in a new window or tab, `open_in` has no same-frame value, and
the panes-only rule turns a new window into the labs page, so the editor
could never open in a pane from the dashboard. The launcher, on the
dashboard's own name so it has the learner's session and Coder's API:

1. Takes `?lab=<id>` and maps it, through `LAB_WORKSPACES`, to the learner's
   workspace for that lab: `lab-lzb`, `lab-tfv` or `lab-asc`. Anything else
   gets `There's no lab at this address.` The names are the site
   catalogue's `workspaceName`s, and tests on both sides fail when they
   differ. At most 16 characters, because code-server's address,
   `code-server--<workspace>--<owner>`, is one DNS label of 63 and a Coder
   username can be 32.
2. `GET /api/v2/users/me`. A 401 says to use **Sign in with GitHub** above
   the pane, which is the site's button.
3. `GET /api/v2/users/me/workspace/<name>`. None yet: Coder's own create
   page, `/templates/hcw-lab/workspace?mode=auto&name=<name>&param.lab=<id>`,
   in a frame of the same origin, where the learner confirms Coder's
   dialog. Stopped, failed or cancelled: Coder's own workspace page,
   `/@me/<name>`, where Start is. It never creates or starts anything
   itself, sends no POST and reads no CSRF token.
4. Waits, from one second between reads up to five, until the latest build
   is running, the agent is connected and ready, and the `code-server`
   app's `health` is `healthy`. Ten minutes, or six failed reads in a row,
   end it with `Lab workspaces aren't available right now.`
5. Checks `subdomain_name` against `^code-server--[a-z0-9-]+--[a-z0-9-]+$`
   and against this workspace's name, then
   `location.replace('https://' + name + '.coder.lab.hybridcloudworks.com/')`.
   The suffix is a constant. code-server stays on its own name, away from
   Coder's API.
6. Posts its state to the site, `{ type: 'hcw-lab', state }`, once to
   `https://hybridcloudworks.com` and once to
   `https://www.hybridcloudworks.com`; the browser delivers the one that
   matches the page holding the pane.

Text reaches the page only through `textContent`, never from the query
string. Caddy sends it with `default-src 'none'`, scripts, styles, fetches
and frames from `coder.lab` only, `base-uri 'none'` and `form-action
'none'`, beside the panes-only `frame-ancestors`, and `Cache-Control:
no-store`. It has no top-level exemption.

## The boundary, in one paragraph

Three processes may drive the Docker daemon on the host and nothing else: the
Coder **server** container, which has `/var/run/docker.sock` because that is
how Coder's documented Docker install creates workspaces, `vps-agent`, and,
when the owner turns it on, Portainer, which only the owner reaches, through
an SSH tunnel to the loopback (ADR 0032, amendment of 2026-09-26).
A **workspace** is a container the server creates from the template with
`user = "65534:65534"`, `privileged = false`, every capability dropped,
`no-new-privileges`, hard memory and CPU limits, one named volume at
`/tmp/home` and its own `coder-ws-<id>` bridge network with no route to the
Compose network. Its one app, code-server, is served on a name of its own
under `*.coder.lab`, and path-based apps are off (`CODER_DISABLE_PATH_APPS`,
2026-09-28), so no workspace's JavaScript runs on the dashboard's origin,
where it could call the Coder API as the learner. Whoever controls the
server controls the daemon; a learner inside a workspace controls 2 GiB of
`nobody`. The test is what keeps those sentences true when either file
changes.

## Community edition caps

Written down so nobody rediscovers them (#659):

- **One platform integration.** Understood to mean external auth for git
  providers, not the GitHub OAuth login; #682's live check confirms which.
- **Five concurrent AI agents.** Not used by this template.
- Autostop requirement, dormancy and failure cleanup are Premium; the
  one-hour default TTL is Community and is set with `coder templates edit`.
- No enforced workspace count. `coder_max_workspaces` in `group_vars` is the
  number the host is sized for and the role asserts it against the host's
  memory; it is not a Coder setting.
- No user without a sign-in. In v2.37.3, `--login-type none` needs a
  service account, and service accounts are Premium (the server answers
  `Service Accounts is a Premium feature`; measured 2026-09-28). The site's
  status token therefore belongs to a GitHub user that no GitHub account can
  become ([`../README.md`](../README.md), "The status token for the site").

## Checking without the host

From the repository root. PowerShell:

```powershell
node --test "lab-host/coder/**/*.test.mjs"
```

```powershell
terraform -chdir=lab-host/coder/templates/hcw-lab fmt -check -diff
```

```powershell
terraform -chdir=lab-host/coder/templates/hcw-lab init -backend=false
```

```powershell
terraform -chdir=lab-host/coder/templates/hcw-lab validate
```

The Compose check is bash (Git Bash), because it is a shell script:

```bash
bash lab-host/coder/compose-config-check.sh
```

Success: `node --test` reports `pass 11`, `fail 0`; `fmt` prints nothing;
`validate` prints `Success! The configuration is valid.`; the compose check
prints `coder-postgres` and `coder` (dependency order). The
`coder (lab-host)` job in `.github/workflows/ci.yml` runs the same four on
every change under `lab-host/coder/`.

A `terraform plan` also works offline and shows the rendered startup
script, because the `coder_*` data sources fall back to defaults with no
server. PowerShell:

```powershell
terraform -chdir=lab-host/coder/templates/hcw-lab plan -refresh=false
```

## Updating

| Change | Where | Then |
| --- | --- | --- |
| Coder or PostgreSQL version | `coder_image_*`, `coder_postgres_image_*` in `../ansible/group_vars/all.yml` (`../ansible/roles/coder/README.md` shows the `imagetools inspect` lines) | Merge, then re-run `bootstrap.sh` on the host, which checks out the merged `main`. A new PostgreSQL major is a dump and a restore, not a pin bump alone: `../ansible/roles/coder/README.md`, "The next major" |
| Workspace image | `image_tag` and `image_digest` in `templates/hcw-lab/main.tf`, from the `publish-lab-image.yml` job summary | `coder templates push` again (`../README.md`, "Coder") |
| Providers or the `code-server` module | `required_providers` and `module "code-server"` in `main.tf`, then `terraform init -upgrade` to refresh `.terraform.lock.hcl` | `coder templates push` |
| A new lab | `local.labs` in `main.tf` and the matching `option` and `validation` regex; the catalogue in `frontend/src/data/labs/catalogue.js` (#681) | `coder templates push` |
| Workspace limits | `memory_mib`, `cpu_quota` in `main.tf`; `coder_workspace_memory_mib` in the role's defaults if the memory changes, so the capacity assertion stays true | `coder templates push` |

Every one of those is caught by `template.test.mjs` if it loosens the
boundary, which is the point of running it in CI.
