# ADR 0032: The learner labs platform — a Terraform-managed Hostinger host under Azure Arc, Docker only, Coder as the learner boundary, and public submission held Gated

**Status:** Proposed
**Decision date:** 2026-09-25
**Owners:** Workload owner and architecture owner

## Context

The estate has a Hostinger VPS that nothing manages. `vps-agent/` is a
pull-based Node job runner that dials out to the Functions API, claims a job,
runs it in `docker run --network none` against a digest-pinned image, and posts
the result back. It is admin-only: `enqueueLabJob` in `functions/src/lib/labs.js`
requires the `editor` role, and the public submission path the source
repository had (`submitPublicLabJob`) was deliberately not ported. No host is
provisioned ([Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed)),
and until this record [the target architecture](../architecture/architecture.md)
§5.3 described a browser-submitted labs flow that does not exist.

Owner direction 2026-09-24: the VPS is an empty host, any OS. Rather than a
Kubernetes lab, make it the **on-premises half of a real hybrid estate** —
provisioned by Terraform, configured by Ansible, onboarded to Azure Arc so it
appears in the same tenant as the production Azure estate, monitored by the
existing Log Analytics workspace, and shown live on a public page. It then
hosts browser labs (Coder) and the existing `vps-agent`. Every step is a pull
request a follower can read and repeat for a few dollars a month.

Four epics build on this record: the lab host itself (#656), the Landing Zone
Builder (#657), the `hcw-lab` image and Docker sandbox (#658), and browser labs
on Coder (#659). Each of their sub-issues assumes the decisions below, so they
are recorded once, here, before any of them is implemented.

## Purpose and decision drivers

- **Blast radius.** A lab experiment must never be able to touch production
  Azure state, production secrets, or the site's sign-in. The host is
  third-party, reachable from the internet, and will run learner-supplied code.
- **Cost, against the USD 150/month ceiling of [ADR 0015](0015-cost-governance.md).**
  Hostinger is billed outside Azure ([cost analysis](../architecture/cost-analysis.md)).
  The Azure side must add nothing with a standing charge that the estate cannot
  already absorb.
- **Teachability.** The point of the host is that a follower can repeat it. A
  design that needs a Kubernetes distribution, a VPN gateway or a paid Defender
  plan is one fewer people will reproduce.
- **Supply chain.** Learner-facing images are pulled implicitly by `docker run`,
  before `--network none` takes effect. Whatever runs on the host must be pinned
  by digest, built from this repository, and reviewed like any other change
  (the rule `vps-agent/lib/capabilities.js` already enforces).
- **Security and operational excellence.** Least privilege on every identity
  the host holds; outbound-only where a protocol allows it; the existing
  alerting fabric ([ADR 0022](0022-alerting-fabric.md)) rather than a second one.

## Decision

1. **The VPS is Terraform-managed through the `hostinger/hostinger` provider
   (v0.1.22, January 2026) in its own HCP Terraform workspace.** Organisation
   `hcw`, workspace `hcw-lab`, VCS-driven from this repository with working
   directory `infra-lab/`, auto-apply off. The `hostinger_api_token` and
   `cloudflare_api_token` it needs are workspace variables, never repository
   values. Lab state and `hcw-azure` state never meet: nothing in `infra-lab/`
   reads `hcw-azure` outputs, and nothing in `infra/` reads `hcw-lab`.
2. **Ubuntu 24.04 LTS, and Docker Engine is the only runtime on the host.** No
   Kubernetes of any size (owner decision 2026-09-24; the earlier k3s idea is
   dropped). Coder, `vps-agent`, Caddy and node-exporter run as containers
   under Docker Compose; the Arc agent runs as a host service because that is
   how Azure ships it.
3. **Azure Arc-enabled servers is the hybrid control plane.** The host is
   onboarded as an Arc machine in a new resource group,
   `rg-lab-hybrid-prod-cus`, in the application subscription. Onboarding uses a
   service principal holding only **Azure Connected Machine Onboarding** on
   that resource group; its credential lives in Ansible Vault and never in the
   repository or on the host after onboarding. An Azure Monitor Agent data
   collection rule sends **heartbeat and `auth`/`authpriv` syslog only** into
   the existing Log Analytics workspace in `rg-mgmt-plat-prod-cus` (Management
   subscription). Machine configuration policy is **audit only**. Defender for
   Servers stays **off** for cost. Arc itself is free.
4. **Coder (Community edition) is the learner identity boundary.** It runs
   from Docker Compose on the host with Docker-based workspaces, and learners
   sign in to it with **GitHub OAuth**. The site never signs learners in and
   never embeds Coder: `frontend/staticwebapp.config.json` keeps `frame-src`
   at `'self'` plus the Entra sign-in origin and a closed `connect-src`. The
   site links out to `lab.hybridcloudworks.com` and shows lab status through a
   server-side proxy in the Function App, which reads `CODER_URL` and a
   read-only `CODER_STATUS_TOKEN` from Key Vault `kv-site-prod-cus-01`.
5. **One toolchain, published as digest-pinned images from a new `lab-image/`
   directory.** The images go to GHCR (and to Docker Hub once an organisation
   exists there) and are the single toolchain for the lab pages, the Coder
   template and `vps-agent`. They carry a Terraform provider **filesystem
   mirror**, so `terraform init` succeeds under `--network none`. Today the
   `terraform-validate` capability in `vps-agent/lib/capabilities.js` runs
   `terraform init -backend=false` inside a network-less container, so it can
   pass only for HCL that declares no provider; the mirror is what makes a real
   landing-zone module validatable.
6. **Anonymous public lab submission stays Gated.** Accepting this ADR does not
   open it. When a later revision does, the bounds are these and no wider:
   only the `terraform-validate` job type; a 64 KB payload; 2 submissions an
   hour per client and 50 a day globally; refused outright while more than 20
   jobs are queued; jobs written with `public: true` and a 1-day TTL. Until
   then, submission is `enqueueLabJob` from `/admin/labs` under the `editor`
   role, exactly as the code stands.

## Consequences and accepted risks

- **Two Terraform workspaces, two lifecycles.** A change to the lab host is a
  run in `hcw-lab` that the owner confirms in the HCP Terraform UI, the same
  way as `hcw-azure`. The isolation is the point, and it means the two can
  drift in provider versions and conventions; the
  [IaC repository standard](../standards/iac-repository-standard.md) applies to
  both.
- **No Kubernetes means no Kubernetes lab.** Followers who want AKS or k3s
  content will not get it from this host. Docker Compose is the whole
  orchestration story, and the host is rebuilt rather than repaired.
- **Arc adds an identity to the host.** The Arc agent's system-assigned
  identity can be granted Azure roles. This record grants it none beyond what
  the data collection rule needs; any grant is a change to `infra/` with its
  own review.
- **Ingestion is bounded but not zero.** Heartbeat and auth syslog on one host
  are kilobytes a day against the workspace's 0.25 GB/day cap
  ([ADR 0031](0031-security-scanner-owner-decisions.md) records the headroom).
  A chatty `authpriv` source under an SSH brute-force attempt is the case to
  watch, and the daily-cap alert already exists.
- **Without Defender for Servers there is no managed EDR on the host.** The
  controls are SSH keys only, an inbound policy of 22, 80 and 443, audit-only
  machine configuration, and the auth syslog above. This is a stated cost
  trade, revisited in the triggers below.
- **Coder is a second identity system with its own users.** Learners have a
  GitHub-backed Coder account and nothing on the site. Coder's own hardening —
  workspace resource limits, template review, upgrade cadence — belongs to
  #659 and is not covered here.
- **`lab-image/` is a new supply-chain surface.** Every image it publishes
  must be digest-pinned where consumed, and the existing
  `capabilities.test.js` assertion that every capability names a digest is the
  gate. The Terraform provider mirror is a large image layer, and its pins are
  one more set to keep current.
- **The public path stays closed**, so the labs pages remain read-mostly until
  a revision of this record. That is deliberate: the rate limits above need a
  client identifier the anonymous site does not have yet, and choosing one
  (edge-hashed IP, signed cookie, or a Coder session) is the revision's job.

## Alternatives considered

- **k3s on the host, with lab jobs as Kubernetes Jobs.** Rejected by the owner
  on 2026-09-24. It adds a control plane to run, patch and explain for one
  node, and turns "a VPS with Docker" — the thing a follower already has — into
  a distribution they must learn first. Docker's `--network none`, pids, memory
  and CPU limits already give the sandbox the isolation the runner needs.
- **A self-hosted GitHub Actions runner on the VPS**, for labs or for CI.
  Already rejected in [ADR 0025](0025-cosmos-firewall-datacenter-sentinel.md):
  this repository is public, and a self-hosted runner on a public repository
  lets a fork pull request execute code on the host.
  [ADR 0021 (number reused)](0021-container-apps-ci-runner.md) records the
  Container Apps form of the same idea and why it was dropped.
- **Managing the VPS by hand, or from Ansible alone.** Rejected. Without a
  Terraform record the host's plan, OS and DNS live in a control panel that no
  pull request can review, which is the state it was in when this record was
  written.
- **Putting the lab host in the `hcw-azure` workspace.** Rejected. It would let
  a provider error or a mistaken destroy in a lab experiment surface in the
  production run queue, and it needs the Hostinger token in the workspace that
  holds the production Azure credential.
- **Site-hosted learner sign-in** (a public Entra External ID or GitHub OAuth
  flow on the site itself). Rejected. [ADR 0006](0006-admin-identity.md) keeps
  the site's identity for administrators only, and Coder already has the
  learner sign-in the labs need.
- **Embedding Coder in the site** through an iframe. Rejected. It requires
  opening `frame-src` and `connect-src` to the lab origin, joins the two trust
  boundaries in the browser, and gives the learner a worse editor than the one
  Coder serves directly.
- **Defender for Servers Plan 1 on the Arc machine.** Rejected for now on
  cost (a per-server monthly charge for one host with no data of record). See
  the revisit triggers.
- **Opening public submission in this record**, with the bounds above.
  Deferred to a revision, for the client-identifier reason given under
  consequences.

## Validation and revisit triggers

- **Validation:**
  - `hcw-lab` exists in the `hcw` organisation, is VCS-connected to this
    repository with working directory `infra-lab/`, has auto-apply off, and a
    plan there shows the VPS and DNS records. The `hcw-azure` workspace shows
    no change from the same commit.
  - After the owner applies, the host appears as **Connected** under Azure Arc
    > Machines in `rg-lab-hybrid-prod-cus`, and a `Heartbeat` query in the
    Management workspace returns rows for it.
  - `docker ps` on the host lists Coder, Caddy, `vps-agent` and node-exporter
    and nothing else; `which kubectl k3s` returns nothing.
  - `/education/labs` shows the Arc status card, and shows an explicit absent
    state, not a fabricated one, when the host is down.
  - `enqueueLabJob` with no `Authorization` header still answers 401, which the
    Health Hub labs probe already asserts.
  - Every image `lab-image/` publishes is referenced by digest in
    `vps-agent/lib/capabilities.js` and the Coder template.
- **Revisit when:**
  - the owner decides to open public submission, which is a revision of §6 of
    this record and nothing else;
  - the host gains data of record (learner work that cannot be rebuilt), which
    reopens the backup posture and Defender for Servers;
  - the auth syslog shows sustained credential attacks, which reopens Defender
    for Servers and the inbound policy;
  - a second lab host is wanted, which reopens the single-workspace and
    single-Compose assumptions;
  - the `hostinger/hostinger` provider changes its `hostinger_vps` resource
    incompatibly or is abandoned.

## Related decisions and references

- [ADR 0004](0004-functions-boundaries.md): the labs Function App as a
  separate trust boundary, superseded by [ADR 0019](0019-single-function-app.md),
  which keeps the boundary as a contract inside one app
- [ADR 0006](0006-admin-identity.md): Entra ID for administrators only
- [ADR 0015](0015-cost-governance.md): the USD 150 ceiling
- [ADR 0021 (number reused)](0021-container-apps-ci-runner.md) and
  [ADR 0025](0025-cosmos-firewall-datacenter-sentinel.md): why a self-hosted
  runner is rejected in a public repository
- [ADR 0022](0022-alerting-fabric.md): the alerting the host joins
- [Target architecture §5.3](../architecture/architecture.md#53-labs-flow),
  corrected alongside this record
- [Labs host](../architecture/labs-host.md): the estate record for the host
- [Required inputs §4.7](../standards/required-inputs.md#47-vps-agent-hostinger-env-never-committed):
  the inputs this record names
- Epics: #656 (the hybrid lab host), #657 (Landing Zone Builder), #658
  (`hcw-lab` image and Docker sandbox), #659 (browser labs on Coder)
- `vps-agent/index.js`, `vps-agent/lib/capabilities.js`,
  `functions/src/lib/labs.js`, `functions/src/functions/labs-http.js`,
  `frontend/staticwebapp.config.json`
