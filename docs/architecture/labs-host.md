# Labs host

The estate record for the lab host: the one machine in the estate that is not
in Azure. It is the on-premises half of the hybrid estate described in
[ADR 0032](../decisions/0032-learner-labs-platform.md), and this page is where
its shape is written down so that a change to it is a change to a document.

**State: planned.** Nothing on this page is provisioned. The Hostinger account
holds an empty VPS that no Terraform manages yet. The Terraform that will
adopt it is in [`infra-lab/`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/infra-lab)
(#661). The `hcw-lab` workspace, the Arc resource group and every identity in
the table below are work tracked under #656. When a row becomes real, its
status changes here in the same pull request.

This page carries no addresses. The host's IP, its Hostinger identifiers and
its SSH host keys are read from the `hcw-lab` workspace and from the host
itself, never from a published page.

## Summary

| Attribute | Value | Status |
| --- | --- | --- |
| Provider | Hostinger, billed outside Azure ([cost analysis](cost-analysis.md)) | planned |
| Plan | KVM 4 recommended (4 vCPU, 16 GB RAM, NVMe) — large enough for Coder workspaces beside the job runner | planned |
| Provisioning | Terraform in [`infra-lab/`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/infra-lab): `hostinger/hostinger` provider 0.1.23, HCP Terraform workspace `hcw/hcw-lab`, working directory `infra-lab/`, auto-apply off. The existing VPS is **adopted by an `import` block, never created**, because creating a `hostinger_vps` is a purchase and destroying one cancels it; `infra-lab/README.md` has the owner's steps and the plan counts to read before any apply | code in repository; workspace not yet created |
| Configuration | Ansible, from a playbook in this repository | planned |
| Operating system | Ubuntu 26.04 LTS, x86-64 (owner decision 2026-09-26: the latest LTS, and the VPS stays on it). `lab-host/` still accepts 24.04 LTS as a stated fallback and refuses anything else | running on the VPS; a clean reinstall is pending (owner decision 2026-09-26, [ADR 0032](../decisions/0032-learner-labs-platform.md) amendment of that date) |
| Runtime | Docker Engine only; no Kubernetes (owner decision 2026-09-24) | planned |
| Public names | `lab.hybridcloudworks.com`, `*.lab.hybridcloudworks.com` and `*.coder.lab.hybridcloudworks.com`, Cloudflare DNS records managed from `hcw-lab` (`infra-lab/dns.tf`: the `lab` A record and CNAMEs to it for `*.lab`, `coder.lab` and `*.coder.lab`, all DNS-only; `coder.lab` has its own record because `*.coder.lab` makes it an empty non-terminal that `*.lab` does not answer for). One Caddy certificate carries all three names, issued by DNS-01. The target is the `_acme-challenge.lab` and `_acme-challenge.coder.lab` delegations into a dedicated lab zone; until that zone exists (owner decision 2026-09-25: none yet) there are no delegation records and Caddy writes its challenges in the production zone, the interim ADR 0032 accepts | planned |
| Hybrid control plane | Azure Arc-enabled server in `rg-lab-hybrid-prod-cus`; heartbeat and auth syslog to the Log Analytics workspace in `rg-mgmt-plat-prod-cus` | planned |
| Owner | Workload owner | — |

## What runs on it

| Component | Role | How it runs |
| --- | --- | --- |
| Caddy | TLS termination and reverse proxy for the lab names; the only thing listening on 80 and 443. A build that includes the `caddy-dns/cloudflare` module, because the stock package and the official image do not and DNS-01 needs it | Host-native systemd service; pinned version and SHA256 in `lab-host/ansible/group_vars` |
| Coder (Community edition) | Browser labs; learner sign-in by GitHub OAuth; Docker-based workspaces from the `lab-image/` images | Docker Compose, behind Caddy |
| PostgreSQL (Coder's database) | Coder's metadata: users, templates, workspace records. Listens on the Compose network only, never on the host | Docker Compose, a named volume |
| `vps-agent` | Pull-based lab job runner (`vps-agent/`); dials out to the Functions API, runs each job in `docker run --network none`, so its user is in the `docker` group | Host-native systemd service `hcw-labs-agent`, user `hcw-labs-agent`, `/opt/hcw-labs-agent` |
| node-exporter | Host metrics for the lab status page; listens on localhost only | Host-native systemd service |
| Azure Connected Machine agent and Azure Monitor Agent | Arc onboarding as `arcs-lab-hybrid-prod-cus-01`; heartbeat and `auth`/`authpriv` syslog only, by the data collection rule `dcr-lab-hybrid-prod-cus` | Host services. The Connected Machine agent is installed and connected by the Ansible `arc` role; the Azure Monitor Agent is an Arc extension the owner adds after onboarding ([runbook](../runbooks/labs-host.md), step 8) |
| Coder workspaces and lab job containers | Transient. Workspaces carry Coder's `com.coder.resource=true` label and stop after an hour; job containers carry the `hcw.lab-job` label and live for one job | `docker run`, started by Coder and by `vps-agent` |
| Portainer Business Edition | The owner's view of the host's Docker: containers, images, volumes, logs. Holds the Docker socket, so it is root on the host; reachable only through an SSH tunnel. Off until the owner turns it on (owner decision 2026-09-26) | One container, `portainer`, with a named volume; HTTPS on `127.0.0.1:9443` only, no Caddy route |
| HashiCorp Vault | Secrets for the lab host only, never production HybridCloudWorks secrets (those stay in Key Vault `kv-site-prod-cus-01`). Initialised and unsealed by the owner over SSH; sealed after every restart. Off until the owner turns it on (owner decision 2026-09-26) | Host-native systemd service `vault`, user `vault`, raft storage in `/var/lib/vault`; `127.0.0.1:8200` and `127.0.0.1:8201` only |

Nothing else. A container that is neither a named service above nor carries
one of the two labels is a finding, and the validation list in ADR 0032 checks
`docker ps` that way, by name and label rather than by count.

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
- Docker pulls digest-pinned images from GHCR over 443.

No inbound port is opened for the site, for Azure or for lab jobs. The site
reaches the host in one direction only, through a server-side status proxy in
the Function App that reads the `CODER-URL` and `CODER-STATUS-TOKEN` secrets
from Key Vault through its `CODER_URL` and `CODER_STATUS_TOKEN` settings.

On the host's loopback, and nowhere else: node-exporter (9100), Coder (7080,
behind Caddy), Portainer (9443) and Vault (8200, and raft's 8201 once
unsealed). Docker's iptables rules for a published port come before ufw's, so
the two published through Docker name `127.0.0.1` in the publish itself, and
the Portainer role refuses any other address. The owner reaches Portainer
through an SSH tunnel and Vault through the CLI over SSH; neither has a Caddy
route or a public name.

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
| Arc machine identity | System-assigned by Azure at onboarding, held by the Connected Machine agent | Whatever roles `infra/` grants it; none beyond the data collection rule today | planned |
| Coder GitHub OAuth app secret | Coder's Docker Compose environment | Learner sign-in to Coder; nothing on the site | planned |
| Coder status token | Issued by Coder; the value is held in Key Vault `kv-site-prod-cus-01` as the secret `CODER-STATUS-TOKEN` (read by the Function App setting `CODER_STATUS_TOKEN`), not on the host | Read-only Coder API for the site's status proxy | planned |
| Caddy ACME account | Caddy's data volume | Issuance and renewal of the one certificate covering `lab`, `*.lab` and `*.coder.lab` | planned |
| Caddy DNS-01 token (`CLOUDFLARE_API_TOKEN` in `/etc/caddy/env`, owner `root`, group `caddy`, mode `0640`, written by Ansible from Vault; the `caddy` systemd unit runs as the non-root `caddy` user and reads it through `EnvironmentFile`) | On the host, because renewals happen there | DNS edit on the dedicated lab zone that `_acme-challenge.lab` is delegated to; DNS edit on the production zone only in the interim ADR 0032 records | planned |
| Portainer administrator and Business Edition licence key | Created and entered by the owner in Portainer's UI; the password is in the owner's password manager, and Portainer keeps its own copy in its volume. Neither is in the repository or Ansible Vault | Full control of the host's Docker daemon, through the loopback only | planned |
| HashiCorp Vault unseal keys (five, three to unseal) and initial root token | The owner's password manager only, printed once by `vault operator init`. Never on the host, in the repository, in a log or in Ansible Vault | Unsealing and administering the lab host's Vault | planned |
| Vault listener certificate | Generated on the host, `/etc/vault.d/tls/`, key `root:vault` `0640` | TLS for `127.0.0.1:8200`; trusted by the CLI through `VAULT_CACERT` | planned |

Identities that are **not** on the host, by design: the Hostinger API token and
the Terraform-side Cloudflare API token (HCP Terraform workspace variables in
`hcw-lab`; the Caddy token above is a different, narrower token), the Arc
onboarding service principal credential (Ansible Vault, used once at onboarding
and not persisted), and any Cosmos DB key (the runner has never held one — see
the header comment of `vps-agent/index.js`).

## Run the toolchain locally

The same image the host runs jobs in is the image a lab page tells a learner
to pull: `ghcr.io/hybridcloudworks/hcw-lab` carries terraform, kubeconform,
helm, ansible-core, the Azure CLI, kubectl and git, plus a Terraform provider
mirror and the vendored Azure Verified Modules, so `terraform init` works in
it with no network. Pull it, then run it with the current directory mounted
at `/workspace`; both commands drop into `bash` there as `nobody`. The pull
is anonymous once the owner has made the package public (#674); until then it
needs `docker login ghcr.io` with a token holding `read:packages`.

PowerShell:

```powershell
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```powershell
docker run --rm -it -v "${PWD}:/workspace" ghcr.io/hybridcloudworks/hcw-lab:latest
```

bash:

```bash
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```bash
docker run --rm -it -v "$PWD:/workspace" ghcr.io/hybridcloudworks/hcw-lab:latest
```

A successful run prints a `nobody@<container id>:/workspace$` prompt, and
`terraform version` there reports the version pinned in
[`lab-image/versions.env`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/lab-image/versions.env).
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
