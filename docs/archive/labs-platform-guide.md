# Labs Platform Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


The labs platform turns the Hostinger VPS into a **backend-only lab execution
engine** for HybridCloudWorks. Admins (and later, restricted public flows)
submit jobs; the VPS pulls them from a Firestore queue and runs them inside
locked-down Docker containers. The VPS never accepts inbound traffic.

Related code:

| Piece | Path |
| --- | --- |
| Cloud Functions (enqueue / snapshot / cancel) | `functions/labs-functions.js` (exported from `functions/index.js`) |
| VPS agent daemon | `labs/vps-agent/` |
| Capability allowlist (agent side) | `labs/vps-agent/lib/capabilities.js` |
| Docker sandbox runner | `labs/vps-agent/lib/docker-runner.js` |
| Firestore rules | `platform/firebase/firestore.rules` (`lab_jobs`, `lab_agents`) |
| Admin UI | `src/pages/admin/LabsPage.jsx` (`/admin/labs`) |
| VPS runbook | `labs/vps-agent/README.md` |

## Architecture

Pull-based: the VPS dials out to Firestore; nothing dials in.

```
            ┌────────────────────────────┐
            │   Admin Portal (/admin/labs)│
            │  Dashboard · Console · Setup│
            └───────┬───────────▲────────┘
        enqueueLabJob│           │ onSnapshot (read-only,
        cancelLabJob │           │ isAdmin() rules)
   getLabsSnapshot   │           │
            ┌────────▼───────────┴────────┐
            │       Cloud Functions       │
            │  - admin claims (editor/    │
            │    viewer) via custom claims│
            │  - server-side job-type     │
            │    allowlist + payload caps │
            └────────┬────────────────────┘
                     │ Admin SDK writes
            ┌────────▼────────────────────┐
            │          Firestore          │
            │  lab_jobs   (job queue)     │
            │  lab_agents (heartbeats)    │
            └────────▲────────────────────┘
                     │ OUTBOUND ONLY
                     │ (listener + poll fallback,
                     │  scoped service account)
            ┌────────┴────────────────────┐
            │   Hostinger VPS (no inbound │
            │   ports, key-only SSH)      │
            │  hcw-labs-agent (systemd)   │
            │   1. heartbeat every 30s    │
            │   2. claim job (transaction)│
            │   3. run in Docker sandbox  │
            │   4. write result back      │
            │        ┌─────────────────┐  │
            │        │ Docker container│  │
            │        │ --network none  │  │
            │        │ --read-only     │  │
            │        │ cap-drop ALL    │  │
            │        │ non-root, limits│  │
            │        └─────────────────┘  │
            └─────────────────────────────┘
```

## Data model

### `lab_jobs/{jobId}` — job queue

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Must be in the server-side allowlist (`LAB_JOB_TYPES`) |
| `payload` | string | Size-capped per type; mounted as a read-only file, never executed |
| `status` | string | `queued → claimed → running → succeeded \| failed \| timeout`; `cancelled` (from `queued` only) |
| `requestedBy` / `requestedByEmail` | string | Admin who enqueued |
| `agentId` | string\|null | Agent that claimed the job |
| `exitCode` | number\|null | Container exit code (`-1` on agent error) |
| `output` | string\|null | stdout+stderr, capped at 64 KB |
| `createdAt` / `claimedAt` / `finishedAt` | timestamp | Lifecycle timestamps |
| `cancelledBy` | string | Set by `cancelLabJob` |

### `lab_agents/{agentId}` — heartbeats

| Field | Type | Notes |
| --- | --- | --- |
| `agentId`, `hostname`, `version` | string | Identity |
| `capabilities` | string[] | Job types this agent advertises |
| `status` | string | `idle` / `busy` / `stopping` / `offline` |
| `activeJobs` | number | Currently running jobs |
| `lastSeenAt` | timestamp | Heartbeat every 30s; **offline if older than 90s** (3 missed beats) |

Job types currently allowlisted (keep `functions/labs-functions.js` and
`labs/vps-agent/lib/capabilities.js` in sync):

- `shell-echo` — smoke test, echoes the payload (4 KB cap, alpine:3.20)
- `terraform-validate` — `terraform init -backend=false && validate` (64 KB, hashicorp/terraform:1.9)
- `ansible-check` — `ansible-playbook --syntax-check` (64 KB, alpine/ansible:2.17.0)

## Security model

Defense in depth, layer by layer:

1. **Pull-based transport.** The VPS opens zero inbound ports. It only makes
   outbound TLS connections to Firestore. Compromising the website cannot
   reach the VPS directly.
2. **Server-side allowlist.** `enqueueLabJob` rejects any `type` not in
   `LAB_JOB_TYPES` and enforces per-type payload byte caps. The agent
   re-checks the allowlist before claiming (defense in depth).
3. **No command injection surface.** Commands are fixed argv arrays in
   `lib/capabilities.js`. The user payload is written to a file and mounted
   read-only at `/workspace` — it is never interpolated into a shell string.
4. **Docker sandbox flags** (every job): `--network none`, `--read-only`,
   `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`,
   `--memory`/`--cpus` limits, non-root user `65534:65534`, hard wall-clock
   timeout with force-kill, per-job throwaway temp dir.
5. **Least-privilege service account.** The agent authenticates with a
   dedicated `labs-vps-agent` service account holding ONLY
   `roles/datastore.user` — not the default Admin SDK account. Blast radius
   if the VPS is compromised: Firestore data access, nothing else (no Auth,
   no Storage, no deploys).
6. **Firestore rules.** `lab_jobs` and `lab_agents` are admin-only client
   reads (custom-claims `isAdmin()`), with **all client writes denied** —
   writes go exclusively through Cloud Functions or the agent's Admin SDK.
7. **Admin auth on the functions.** `enqueueLabJob`/`cancelLabJob` require
   the `editor` claim; `getLabsSnapshot` requires `viewer` — same
   `requireAdminClaims` + CORS policy as the rest of the CMS functions.
8. **Host hardening.** Key-only SSH, no root login, firewall allowing only
   outbound + SSH, dedicated `labsagent` system user, hardened systemd unit
   (`NoNewPrivileges`, `ProtectSystem=full`, `PrivateTmp`).

Operational notes:

- Cancellation is queued-only by design; a claimed/running job runs to its
  (short) timeout. The agent force-removes timed-out containers.
- Output is capped at 64 KB at both the agent and Firestore write.

## Hostinger provisioning runbook

Condensed; full copy-paste commands live in `labs/vps-agent/README.md`.

1. **Harden SSH** — `PasswordAuthentication no`, `PermitRootLogin no`,
   restart sshd. Enable the Hostinger firewall (or ufw): outbound + SSH only.
2. **Install Docker + Node 20** — `get.docker.com` script, NodeSource Node 20.
   Pre-pull `alpine:3.20`, `hashicorp/terraform:1.9`, `alpine/ansible:2.17.0`.
3. **Service account** — GCP IAM → create `labs-vps-agent`, grant only
   `roles/datastore.user`, download a JSON key to
   `/opt/hcw-labs-agent/service-account.json` (`chmod 600`).
4. **Install agent** — copy `labs/vps-agent/*` to `/opt/hcw-labs-agent`,
   `npm install --omit=dev`, `cp .env.example .env` and set
   `LABS_AGENT_SERVICE_ACCOUNT` / `LABS_AGENT_ID`. Create a `labsagent` user
   in the `docker` group; chown the directory.
5. **systemd** — install `hcw-labs-agent.service` (see README),
   `systemctl enable --now hcw-labs-agent`,
   `journalctl -u hcw-labs-agent -f`.
6. **Smoke test** — Admin portal → Labs → agent shows **Online** within ~30s.
   Console → `shell-echo` → payload `hello vps` → Submit. Watch
   `queued → claimed → running → succeeded` with the payload echoed back.

## Future seam: public lab submissions (not built)

The public site (Coder Corner, Terraform/Ansible learning pages) will
eventually let visitors run validations. The design seam, **described only —
do not expose the admin functions publicly**:

- A new `submitPublicLabJob` Cloud Function wraps the same queue with a much
  tighter policy: its own restricted job-type allowlist (e.g. only
  `terraform-validate` / `ansible-check`), smaller payload caps, Firebase
  App Check + reCAPTCHA, and per-IP/per-UID rate limiting (Firestore counter
  or Redis), plus a global daily job budget.
- Public jobs get `source: 'public'` and lower claim priority; agents could
  advertise a capability subset or a dedicated low-resource agent could
  handle the public lane.
- Visitors never read `lab_jobs` directly — the wrapper returns a one-time
  job token and a `getPublicLabResult` function (or a public mirrored doc
  with only status/output) serves results, keeping the admin-only rules
  intact.
- Existing safety properties carry over unchanged: allowlisted fixed
  commands, payload-as-file, network-less containers, output caps.
