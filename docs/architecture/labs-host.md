# Labs host

The estate record for the lab host: the one machine in the estate that is not
in Azure. It is the on-premises half of the hybrid estate described in
[ADR 0032](../decisions/0032-learner-labs-platform.md), and this page is where
its shape is written down so that a change to it is a change to a document.

**State: live, and behind `main`.** The host runs: it is configured by the
playbook in `lab-host/`, Arc-connected, Coder answers on its public name, and
the job runner heartbeats (read-only review of 2026-10-08, #1009). This page
describes what `main` holds, and the host holds what its last `bootstrap.sh`
run checked out, which was before the changes listed under
[Applied state](#applied-state). Nothing re-runs the playbook on its own
(#950), so a merged change is on the host only after the owner's next run. A
row whose change has not reached the host says so. The Terraform that adopts
the VPS is in [`infra-lab/`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/tree/main/infra-lab)
(#661); its state is the Provisioning row. When a row changes, its status
changes here in the same pull request.

This page carries no addresses. The host's IP, its Hostinger identifiers and
its SSH host keys are read from the `hcw-lab` workspace and from the host
itself, never from a published page.

## Summary

| Attribute | Value | Status |
| --- | --- | --- |
| Provider | Hostinger, billed outside Azure ([cost analysis](cost-analysis.md)) | live |
| Plan | KVM 4 recommended (4 vCPU, 16 GB RAM, NVMe) — large enough for Coder workspaces beside the job runner | planned |
| Provisioning | Terraform in [`infra-lab/`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/tree/main/infra-lab): `hostinger/hostinger` provider 0.1.23, HCP Terraform workspace `hcw/hcw-lab`, working directory `infra-lab/`, auto-apply off. The existing VPS is **adopted by an `import` block, never created**, because creating a `hostinger_vps` is a purchase and destroying one cancels it; `infra-lab/README.md` has the owner's steps and the plan counts to read before any apply | code in repository; workspace not yet created |
| Configuration | Ansible, from a playbook in this repository, run by the owner with `lab-host/bootstrap.sh` | live, and behind `main`: last converged 2026-10-07 around 04:33 UTC ([Applied state](#applied-state)) |
| Operating system | Ubuntu 26.04 LTS, x86-64 (owner decision 2026-09-26: the latest LTS, and the VPS stays on it). `lab-host/` still accepts 24.04 LTS as a stated fallback and refuses anything else | running on the VPS; a clean reinstall is pending (owner decision 2026-09-26, [ADR 0032](../decisions/0032-learner-labs-platform.md) amendment of that date) |
| Runtime | Docker Engine only; no Kubernetes (owner decision 2026-09-24) | live |
| Public names | `lab.hybridcloudworks.com`, `*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com`, Cloudflare DNS records managed from `hcw-lab` (`infra-lab/dns.tf`: the `lab` A record and CNAMEs to it for `*.lab`, `coder.lab` and `*.coder.lab`, all DNS-only; `coder.lab` has its own record because `*.coder.lab` makes it an empty non-terminal that `*.lab` does not answer for). One Caddy certificate carries all three names, issued by DNS-01. The target is the `_acme-challenge.lab` and `_acme-challenge.coder.lab` delegations into a dedicated lab zone; until that zone exists (owner decision 2026-09-25: none yet) there are no delegation records and Caddy writes its challenges in the production zone, the interim ADR 0032 accepts | live; DNS, the edge and the CSP matched the repository on 2026-10-08 (#1009) |
| Hybrid control plane | Azure Arc-enabled server in `rg-lab-hybrid-prod-cus`; heartbeat, auth syslog, service syslog at Warning and above, and four host counters to the Log Analytics workspace in `rg-mgmt-plat-prod-cus`; three alert rules there page the owner on heartbeat absence (30 min), root disk past 85%, and a watched unit failing (LAB-2, 2026-10-06) | live |
| Owner | Workload owner | — |

## Applied state

Merged is not applied. A change to `lab-host/` reaches the host when the
owner runs `bootstrap.sh`, which checks out `origin/main` and runs the
playbook; a change to the Coder template reaches Coder when the owner pushes
the template after that run ([runbook](../runbooks/labs-host.md#after-a-merge-the-playbook-then-the-template-at-once)).
Nothing does either on a schedule (#950).

The read-only review of 2026-10-08 (#1009) found the host last converged
around 2026-10-07T04:33Z, with the agent last restarted at 04:33:04Z. These
changes merged after that and were not on it:

| Change | Merged (UTC) | On the host |
| --- | --- | --- |
| LAB-6: guest configuration off on the Arc agent (#984) | 2026-10-07 06:21 | Not yet. Arc still reported `guestConfigurationEnabled: "true"` |
| LAB-3: the lab supply chain, including the held-package timer (#986) | 2026-10-07 06:40 | Not yet |
| Lab image digests (#989) | 2026-10-07 07:16 | Not yet |
| LAB-5: the agent behind its own Docker proxy and in no docker group, user-namespace remapping on the host daemon, Coder's workspaces on a rootless daemon (#987) | 2026-10-07 07:26 | Not yet |
| Lab images published to Docker Hub only (#1002), and the digests that followed (#1003) | 2026-10-08 05:53 and 06:24 | Not yet. The run that applies them must be followed at once by the template push |

Each row below that describes one of these says when it merged and that it
is not yet on the host. When the owner's run has applied them, this section
records the date of that run and the commit it checked out, and those rows
lose the note.

## What runs on it

| Component | Role | How it runs |
| --- | --- | --- |
| Caddy | TLS termination and reverse proxy for the lab names; the only thing listening on 80 and 443. A build that includes the `caddy-dns/cloudflare` module, because the stock package and the official image do not and DNS-01 needs it. It also enforces [panes only](#panes-only) | Host-native systemd service; pinned version and SHA256 in `lab-host/ansible/group_vars` |
| Coder (Community edition) | Browser labs; learner sign-in by GitHub OAuth; Docker-based workspaces from the `lab-image/` images | Docker Compose, behind Caddy |
| PostgreSQL (Coder's database) | Coder's metadata: users, templates, workspace records. Listens on the Compose network only, never on the host | Docker Compose, a named volume |
| Docker socket proxy (`coder-docker-proxy`) | The one Compose service that holds a Docker socket, read-only, and with LAB-5 it is the sandbox daemon's (below), never the host's (merged 2026-10-07 in #987, not yet on the host: [Applied state](#applied-state)); the Coder server reaches Docker through it over a control network the two alone share, and gets only the API sections the proxy allows (containers, images, networks, volumes, lifecycle), never exec, build, swarm or system. The proxy reads paths, not bodies, so a privileged create still succeeds, and lands on the rootless sandbox daemon as an unprivileged user (LAB-5) | Docker Compose, control network only, no published port, `--userns=host` to open the sandbox daemon's socket |
| Sandbox Docker daemon (`coder_sandbox`) | A second, **rootless** Docker daemon, run by the unprivileged system user `hcw-coder-docker`; every Coder workspace runs on it, so a workspace escape or a privileged container a compromised Coder server asks for is that user's, never root's (LAB-5, merged 2026-10-07 in #987, not yet on the host: [Applied state](#applied-state)). The cpu, memory and pids controllers are delegated to it, so the template's limits hold | systemd user unit `hcw-coder-docker` kept up by lingering; socket `/run/hcw-coder-docker/docker.sock`; data under `/var/lib/hcw-coder-docker` |
| `vps-agent` | Pull-based lab job runner (`vps-agent/`); dials out to the Functions API, runs each job in `docker run --network none`. With LAB-5 its user is in no docker group (merged 2026-10-07 in #987, not yet on the host: [Applied state](#applied-state)): the CLI it spawns reaches the host daemon through `hcw-labs-agent-docker-proxy`, which passes the calls a job makes and refuses any create that asks for privilege, a host namespace, a device, a mount or a bind beyond the job's own directory | Host-native systemd service `hcw-labs-agent`, user `hcw-labs-agent`, `/opt/hcw-labs-agent`; the proxy is one container on no network, with a Unix socket only the agent's group may open |
| node-exporter | Host metrics for the lab status page; listens on localhost only | Host-native systemd service |
| Azure Connected Machine agent and Azure Monitor Agent | Arc onboarding as `arcs-lab-hybrid-prod-cus-01`; heartbeat, `auth`/`authpriv` syslog, the `daemon`/`syslog`/`kern`/`cron`/`user` facilities at Warning and above, and four host counters (CPU, memory, root disk used and free), by the data collection rule `dcr-lab-hybrid-prod-cus` | Host services. The Connected Machine agent is installed and connected by the Ansible `arc` role, switched on by the host's arc fact; the Azure Monitor Agent is an Arc extension added after onboarding. Both are started by the owner's `scripts/lab/Register-LabArc.ps1 -Connect` ([runbook](../runbooks/labs-host.md), "Arc onboarding", step 4) |
| Coder workspaces and lab job containers | Transient. Workspaces carry Coder's `com.coder.resource=true` label and stop after an hour; job containers carry the `hcw.lab-job` label and live for one job. With LAB-5 (merged 2026-10-07 in #987, not yet on the host: [Applied state](#applied-state)) every container on the host daemon runs with user-namespace remapping (its root is an unprivileged uid on the host), and workspaces run on the sandbox daemon | Job containers: the host daemon, started by `vps-agent` through its proxy. Workspaces: the sandbox daemon, started by Coder through its proxy |
| Portainer Business Edition | The owner's view of the host's Docker: containers, images, volumes, logs. Holds the Docker socket (with `--userns=host`, which the socket needs under the remap), so it is root on the host; it sees the host daemon, not the sandbox daemon the workspaces run on; reachable only through an SSH tunnel. Off until the owner turns it on (owner decision 2026-09-26) | One container, `portainer`, with a named volume; HTTPS on `127.0.0.1:9443` only, no Caddy route |
| HashiCorp Vault | Secrets for the lab host only, never production HybridCloudWorks secrets (those stay in Key Vault `kv-site-prod-cus-01`). Initialised by the owner over SSH. Since 2026-09-29 it unseals itself at every start with the key `vault-seal` in the lab-only Key Vault `kv-labhybrid-prod-cus-01`, as the Arc machine's identity (#726; ADR 0032, amendment of 2026-09-29, accepted and live that day). The five Shamir keys are recovery keys. On since 2026-09-26 (#729; owner decision that day) | Host-native systemd service `vault`, user `vault`, raft storage in `/var/lib/vault`; `127.0.0.1:8200` and `127.0.0.1:8201` only. With auto-unseal, the unit also joins the `himds` group and reaches Key Vault over HTTPS |

Nothing else. A container that is neither a named service above nor carries
one of the two labels is a finding, and the validation list in ADR 0032 checks
`docker ps` that way, by name and label rather than by count, on each of the
two daemons: the host's (`sudo docker ps`) and the sandbox's (`sudo docker
-H unix:///run/hcw-coder-docker/docker.sock ps`).

`bootstrap.sh` enforces the "nothing else" on the way in: its first run on a
host refuses, before it changes anything, when the host already runs a
container, a self-hosted runner, Kubernetes, anything under `/opt` or a
listener this repository did not put there, and names a reinstall as the way
on ([runbook](../runbooks/labs-host.md), "The first-run host check").

## Exposure

Inbound: **22, 80 and 443 only.** SSH is key-only, for the owner and Ansible.
80 exists to answer ACME challenges and redirect to 443. Everything else is
outbound:

- `vps-agent` polls the Functions API over 443 with its own Entra certificate;
- the Arc and Azure Monitor agents call Azure over 443;
- Coder reaches GitHub for OAuth over 443;
- Docker pulls digest-pinned images over 443: from Docker Hub as `main`
  holds it (#1002, merged 2026-10-08), and from GHCR until the owner's next
  playbook run and template push apply that ([Applied state](#applied-state)).

No inbound port is opened for the site, for Azure or for lab jobs. The site's
servers reach the host in one direction only, through a server-side status
proxy in the Function App that reads the `CODER-URL` and `CODER-STATUS-TOKEN`
secrets from Key Vault through its `CODER_URL` and `CODER_STATUS_TOKEN`
settings. Whether Coder answers comes from its unauthenticated
`/api/v2/buildinfo`, and that alone opens the site's panes; the token adds
only the labs card's templates and running count. A visitor's browser
reaches the lab only inside the site's pages, as described under
[panes only](#panes-only).

On the host's loopback, and nowhere else: node-exporter (9100), Coder (7080,
behind Caddy), Portainer (9443) and Vault (8200, and raft's 8201 once
unsealed). Docker's iptables rules for a published port come before ufw's, so
the two published through Docker name `127.0.0.1` in the publish itself, and
the Portainer role refuses any other address. The owner reaches Portainer
through an SSH tunnel and Vault through the CLI over SSH; neither has a Caddy
route or a public name.

### Panes only

**Owner decision 2026-09-28:** "The lab should only be accessible through
'panes' from my site, lock to that." A direct visit goes to the labs page.
Caddy enforces this for every name it serves (`lab`, every `*.lab`,
`coder.lab` and `*.coder.lab`) and on every response, including the 404 for
a name nothing claims. It sits in the site block ahead of every route, so a
route added later is covered without doing anything
(`lab-host/ansible/roles/caddy/templates/Caddyfile.j2`, `lab_panes_only`).

| Rule | What Caddy does |
| --- | --- |
| Only the site may frame the lab | Every response carries `Content-Security-Policy: frame-ancestors 'self' https://hybridcloudworks.com https://www.hybridcloudworks.com`. `www` is listed because it serves the site with a 200 rather than redirecting to the apex (checked 2026-09-28). `'self'` is for code-server, whose webviews are iframes of its own origin. It admits no other site, because the browser checks every ancestor up to the top window. There is no `X-Frame-Options`, because it cannot name an allowed origin |
| No direct browsing | A request with `Sec-Fetch-Dest: document`, a top-level navigation, gets `302` to `https://hybridcloudworks.com/education/labs`. So does a request with `Sec-Fetch-Mode: navigate` and no `Sec-Fetch-Dest`, which is a navigation from a browser that sends fetch metadata without the destination |
| Everything else passes | `iframe` (the panes); `empty` (fetch, XHR and WebSockets from a page in a pane, such as Coder's API calls); subresources; and requests with no fetch metadata at all: Coder's workspace agents and CLI, and the Function App's status proxy (Node's `fetch` sends `Sec-Fetch-Mode: cors` and no destination) |

What keeps working, and why:

- **Certificates.** Caddy obtains them by DNS-01, so no challenge request
  arrives over HTTP, and Caddy would answer one before any route in any
  case.
- **Caddy's admin API and metrics** listen on `127.0.0.1:2019`, not on the
  lab names.
- **The lab agent** dials out to the Functions API and receives nothing
  inbound. Nothing else on the host takes a connection through Caddy apart
  from Coder, and Coder's own clients send no fetch metadata.
- **Coder** (on since 2026-09-28, for members of the `HybridCloudWorks`
  GitHub organisation only). Its route removes Coder's
  default `frame-ancestors 'self'`, because the browser enforces every
  policy it receives and that one would keep Coder out of the panes. It
  lets Coder's GitHub sign-in callback through at the top level, because
  GitHub cannot be framed. That path only redirects, and the redirect that
  ends sign-in lands on the labs page. Anything Coder opens in a new tab or
  window, such as a workspace app, is a top-level visit and lands on the
  labs page, so a pane has to show it instead.
- **The lab launcher** (2026-09-28) is how a pane shows code-server. Coder's
  dashboard opens it in a new window or tab, so the site's panes load a
  small static page on Coder's own name instead,
  `https://coder.lab.hybridcloudworks.com/_hcw/lab/?lab=<id>`
  (`lab-host/coder/launcher/`), which Caddy serves from disk before any
  request reaches Coder. With the learner's session it reads their
  workspace for that lab (GET only, same origin), shows Coder's own create
  or workspace page in a frame of its own when the learner has to confirm
  or press Start, and once code-server is healthy replaces itself with
  code-server's own name, which it checks is exactly the name Coder builds
  for that workspace and the signed-in learner.
  code-server stays on its own origin. The launcher's route adds its own
  policy beside `frame-ancestors`: `default-src 'none'`, scripts, styles,
  fetches, images and frames from `coder.lab` only, `base-uri 'none'`,
  `form-action 'none'`, and `Cache-Control: no-store`. It has no top-level
  exemption, so a direct visit to it goes to the labs page like any other.

Limits, stated so they are not mistaken for more:

- **This is a browsing rule, not access control.** Any script can send
  `Sec-Fetch-Dest: iframe`. Coder's GitHub sign-in is the access control
  for anything that matters.
- **A browser too old to send fetch metadata** (Safari before 16.4) cannot
  be told apart from the platform's own clients, so its top-level visits
  pass. `frame-ancestors` still applies to it.
- **The site's own side is separate.** The site's
  `frontend/staticwebapp.config.json` decides what its pages may frame
  (`frame-src`), and since #751 it admits exactly Coder's name and its
  workspace apps' wildcard. Each lab card opens the lab's page on the site,
  `/education/labs/<id>`, which frames the lab launcher in a pane, hears its
  state through `postMessage` (only from Coder's origin and the pane's own
  window), and opens GitHub sign-in at the callback path above in a tab of
  its own (`frontend/src/pages/shared/LabPanePage.jsx`;
  [ADR 0032, amendment "Coder in the site's panes"](../decisions/0032-learner-labs-platform.md#amendment-2026-09-28-coder-in-the-sites-panes)).

The lab side is in `lab-host/` and is applied by the next `bootstrap.sh`
run on the host. It reverses ADR 0032's "never embeds Coder" (decision 4)
on the lab side.

## Backup posture

**Rebuildable, no data of record.** The host holds nothing that cannot be
recreated from the repository: Terraform provisions it, Ansible configures it,
and every image it runs is pinned by digest in the repository. Two kinds of
image are pinned in two places: the learner and job toolchain (`hcw-lab`,
`hcw-lab-runner`) is built and published from `lab-image/` and pinned in the
Coder template and `vps-agent/lib/capabilities.js`; the infrastructure
services Coder and PostgreSQL run their upstream images, pinned by digest in
the Compose file under `lab-host/`. Caddy, `vps-agent` and node-exporter are
host-native, installed by Ansible at versions pinned with checksums in
`lab-host/`.
Lab job records live in Cosmos DB, not on the host. Coder workspaces are
learner scratch space with no retention promise.

Coder's PostgreSQL is the one stateful service, and it is treated as
**rebuildable metadata, not data of record**: learners are GitHub OAuth users
and reappear on next sign-in, templates are pushed again from
`lab-host/coder/templates/`, and workspace records describe containers that
stop after an hour. Losing it costs a re-push and a re-sign-in. As a
convenience, not a promise, the Ansible `coder` role runs a nightly `pg_dump`
into a host directory that keeps seven days, so an operator error can be
undone without a rebuild; that dump never leaves the host and is not restored
anywhere else. There is no other backup schedule, and a compromised or broken
host is destroyed and re-applied. If the host ever acquires data of record,
that is a revisit trigger in ADR 0032.

Portainer's volume and Vault's raft data are not backed up either. Portainer
holds settings that are re-entered by hand. Vault holds lab-host secrets
only, each of which its issuer can issue again, so it holds no data of
record; storing in it anything that exists nowhere else would be the revisit
trigger above.

## Identities the host holds

| Identity | Where it lives | Scope | Status |
| --- | --- | --- | --- |
| Owner and Ansible SSH public keys | `~/.ssh/authorized_keys`, written by Terraform at provisioning and managed by Ansible after | Shell access to the host | planned |
| `vps-agent` Entra confidential client (certificate) | Private key generated on the host, `/etc/hcw/labs-agent.pem`, owner `root`, group `hcw-labs-agent`, mode `0640`, so the non-root service reads it and nothing else does; only the public certificate goes to the app registration | The `LabAgent` app role on the Functions API — three endpoints, no database access | planned |
| Arc machine identity | System-assigned by Azure at onboarding, held by the Connected Machine agent; processes in the `himds` group can request its tokens | Whatever roles `infra/` grants it: from #726, Key Vault Crypto Service Encryption User (read, wrap and unwrap) on the one key `vault-seal` in `kv-labhybrid-prod-cus-01`, which Vault uses to unseal itself once the owner turns auto-unseal on; nothing else beyond the data collection rule | planned |
| Coder GitHub OAuth app secret | Coder's Docker Compose environment | Learner sign-in to Coder; nothing on the site | planned |
| Coder status token | Issued by Coder; the value is held in Key Vault `kv-site-prod-cus-01` as the secret `CODER-STATUS-TOKEN` (read by the Function App setting `CODER_STATUS_TOKEN`), not on the host | Read-only Coder API for the site's status proxy: scoped `template:read` and `workspace:read`, for a Coder user of its own, `hcw-status`, that holds Template Admin so the running count covers every learner (`lab-host/README.md`, "The status token for the site"). It adds the labs card's templates and running count only; the panes open without it | planned |
| Caddy ACME account | Caddy's data volume | Issuance and renewal of the one certificate covering `lab`, `*.lab` and `*.coder.lab` | planned |
| Caddy DNS-01 token (`CLOUDFLARE_API_TOKEN` in `/etc/caddy/env`, owner `root`, group `caddy`, mode `0640`, written by Ansible from Vault; the `caddy` systemd unit runs as the non-root `caddy` user and reads it through `EnvironmentFile`) | On the host, because renewals happen there | DNS edit on the dedicated lab zone that `_acme-challenge.lab` is delegated to; DNS edit on the production zone only in the interim ADR 0032 records | planned |
| Portainer administrator and Business Edition licence key | Created and entered by the owner in Portainer's UI; the password is in the owner's password manager, and Portainer keeps its own copy in its volume. Neither is in the repository or Ansible Vault | Full control of the host's Docker daemon, through the loopback only | planned |
| HashiCorp Vault unseal keys (five, three to unseal) and initial root token | The owner's password manager only, printed once by `vault operator init`. Never on the host, in the repository, in a log or in Ansible Vault | Unsealing and administering the lab host's Vault; after the move to auto-unseal they are recovery keys, which authorise `generate-root`, a rekey or a migration back and can no longer unseal | planned |
| Vault listener certificate | Generated on the host, `/etc/vault.d/tls/`, key `root:vault` `0640` | TLS for `127.0.0.1:8200`; trusted by the CLI through `VAULT_CACERT` | planned |

Identities that are **not** on the host, by design: the Hostinger API token and
the Terraform-side Cloudflare API token (HCP Terraform workspace variables in
`hcw-lab`; the Caddy token above is a different, narrower token), the Arc
onboarding service principal credential (Ansible Vault, used once at onboarding
and not persisted), and any Cosmos DB key (the runner has never held one — see
the header comment of `vps-agent/index.js`).

## Run the toolchain locally

The same image the host runs jobs in is the image a lab page tells a learner
to pull: `docker.io/hybridcloudworks/hcw-lab` carries terraform, kubeconform,
helm, ansible-core, the Azure CLI, kubectl and git, plus a Terraform provider
mirror and the vendored Azure Verified Modules, so `terraform init` works in
it with no network. Pull it, then run it with the current directory mounted
at `/workspace`; both commands drop into `bash` there as `nobody`. The
repository is public, so the pull needs no sign-in.

PowerShell:

```powershell
docker pull hybridcloudworks/hcw-lab:latest
```

```powershell
docker run --rm -it -v "${PWD}:/workspace" hybridcloudworks/hcw-lab:latest
```

bash:

```bash
docker pull hybridcloudworks/hcw-lab:latest
```

```bash
docker run --rm -it -v "$PWD:/workspace" hybridcloudworks/hcw-lab:latest
```

A successful run prints a `nobody@<container id>:/workspace$` prompt, and
`terraform version` there reports the version pinned in
[`lab-image/versions.env`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/lab-image/versions.env).
`lab-image/README.md` in the repository has the digest-pinned form, what
works offline, and the smoke test.

## Related

- [ADR 0032](../decisions/0032-learner-labs-platform.md): the decisions this
  page records the shape of
- [Target architecture §5.3](architecture.md#53-labs-flow): the labs flow
- [Labs host Arc onboarding](../runbooks/labs-host.md): the owner procedure
  that makes the hybrid control plane row real, and how to disconnect
- [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed):
  the inputs the host and its workspace need, with live status
- [Cost analysis](cost-analysis.md): Hostinger is tracked outside Azure
