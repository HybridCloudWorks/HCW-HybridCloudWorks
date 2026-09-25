# Labs host

The estate record for the lab host: the one machine in the estate that is not
in Azure. It is the on-premises half of the hybrid estate described in
[ADR 0032](../decisions/0032-learner-labs-platform.md), and this page is where
its shape is written down so that a change to it is a change to a document.

**State: planned.** Nothing on this page is provisioned. The Hostinger account
holds an empty VPS that no Terraform manages; `infra-lab/`, the `hcw-lab`
workspace, the Arc resource group and every identity in the table below are
work tracked under #656. When a row becomes real, its status changes here in
the same pull request.

This page carries no addresses. The host's IP, its Hostinger identifiers and
its SSH host keys are read from the `hcw-lab` workspace and from the host
itself, never from a published page.

## Summary

| Attribute | Value | Status |
| --- | --- | --- |
| Provider | Hostinger, billed outside Azure ([cost analysis](cost-analysis.md)) | planned |
| Plan | KVM 4 recommended (4 vCPU, 16 GB RAM, NVMe) — large enough for Coder workspaces beside the job runner | planned |
| Provisioning | Terraform, `hostinger/hostinger` provider, HCP Terraform workspace `hcw/hcw-lab`, working directory `infra-lab/`, auto-apply off | planned |
| Configuration | Ansible, from a playbook in this repository | planned |
| Operating system | Ubuntu 24.04 LTS | planned |
| Runtime | Docker Engine only; no Kubernetes (owner decision 2026-09-24) | planned |
| Public name | `lab.hybridcloudworks.com`, a Cloudflare DNS record managed from `hcw-lab` | planned |
| Hybrid control plane | Azure Arc-enabled server in `rg-lab-hybrid-prod-cus`; heartbeat and auth syslog to the Log Analytics workspace in `rg-mgmt-plat-prod-cus` | planned |
| Owner | Workload owner | — |

## What runs on it

| Component | Role | How it runs |
| --- | --- | --- |
| Caddy | TLS termination and reverse proxy for `lab.hybridcloudworks.com`; the only thing listening on 80 and 443 | Docker Compose |
| Coder (Community edition) | Browser labs; learner sign-in by GitHub OAuth; Docker-based workspaces from the `lab-image/` images | Docker Compose, behind Caddy |
| `vps-agent` | Pull-based lab job runner (`vps-agent/`); dials out to the Functions API, runs each job in `docker run --network none` | Docker Compose |
| node-exporter | Host metrics for the lab status page | Docker Compose, host-local |
| Azure Connected Machine agent and Azure Monitor Agent | Arc onboarding; heartbeat and `auth`/`authpriv` syslog only | Host services, installed by Ansible |

Nothing else. A process that is not in this table is a finding, and the
validation list in ADR 0032 checks `docker ps` against it.

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
the Function App that reads `CODER_URL` and `CODER_STATUS_TOKEN` from Key Vault.

## Backup posture

**Rebuildable, no data of record.** The host holds nothing that cannot be
recreated from the repository: Terraform provisions it, Ansible configures it,
and every image it runs is published from `lab-image/` and pinned by digest.
Lab job records live in Cosmos DB, not on the host. Coder workspaces are
learner scratch space with no retention promise. There is no backup schedule,
and a compromised or broken host is destroyed and re-applied. If the host ever
acquires data of record, that is a revisit trigger in ADR 0032.

## Identities the host holds

| Identity | Where it lives | Scope | Status |
| --- | --- | --- | --- |
| Owner and Ansible SSH public keys | `~/.ssh/authorized_keys`, written by Terraform at provisioning and managed by Ansible after | Shell access to the host | planned |
| `vps-agent` Entra confidential client (certificate) | Private key generated on the host, `/etc/hcw/labs-agent.pem`, root-owned; only the public certificate goes to the app registration | The `LabAgent` app role on the Functions API — three endpoints, no database access | planned |
| Arc machine identity | System-assigned by Azure at onboarding, held by the Connected Machine agent | Whatever roles `infra/` grants it; none beyond the data collection rule today | planned |
| Coder GitHub OAuth app secret | Coder's Docker Compose environment | Learner sign-in to Coder; nothing on the site | planned |
| Coder status token | Issued by Coder; the value is held in Key Vault `kv-site-prod-cus-01` as `CODER_STATUS_TOKEN`, not on the host | Read-only Coder API for the site's status proxy | planned |
| Caddy ACME account | Caddy's data volume | Certificate issuance for `lab.hybridcloudworks.com` | planned |

Identities that are **not** on the host, by design: the Hostinger API token and
the Cloudflare API token (HCP Terraform workspace variables in `hcw-lab`), the
Arc onboarding service principal credential (Ansible Vault, used once at
onboarding and not persisted), and any Cosmos DB key (the runner has never held
one — see the header comment of `vps-agent/index.js`).

## Related

- [ADR 0032](../decisions/0032-learner-labs-platform.md): the decisions this
  page records the shape of
- [Target architecture §5.3](architecture.md#53-labs-flow): the labs flow
- [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed):
  the inputs the host and its workspace need, with live status
- [Cost analysis](cost-analysis.md): Hostinger is tracked outside Azure
