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
| `templates/hcw-lab/template.test.mjs` | The hardening test (`node --test`). Fails when the socket appears outside the `coder` service, anything is `privileged`, the workspace maps a host path, joins the Compose network or does not run as 65534 |
| `package.json` | `npm test` runs `node --test`; no dependencies, no lockfile |

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
Compose network. Whoever controls the server controls the daemon; a learner
inside a workspace controls 2 GiB of `nobody`. The test is what keeps the
second sentence true when the template changes.

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

Success: `node --test` reports `pass 10`, `fail 0`; `fmt` prints nothing;
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
