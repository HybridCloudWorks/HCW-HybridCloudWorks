# HCW Labs VPS Agent

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


Pull-based lab job executor for the HybridCloudWorks labs platform. Runs as a
Node.js daemon on the Hostinger VPS, dials out to Firestore (no inbound ports),
claims queued `lab_jobs` matching its capabilities, executes them inside
sandboxed Docker containers, and writes results back.

See `documentation/labs-platform-guide.md` in the repo root for the full
architecture, data model, and security model.

## How it works

1. Heartbeat every 30s to `lab_agents/{agentId}` (hostname, version, capabilities, status).
2. Realtime listener (with polling fallback) on `lab_jobs` where `status == queued`
   and `type` is in this agent's capability list.
3. Atomic claim via Firestore transaction (`queued -> claimed`), so multiple
   agents never run the same job.
4. Execution in Docker with: `--network none`, `--read-only`, memory/CPU/pids
   limits, `--cap-drop ALL`, `no-new-privileges`, non-root user, and a hard
   wall-clock timeout. Payload is mounted read-only at `/workspace`.
5. stdout+stderr captured (capped at 64KB) and written back with
   `exitCode`, `finishedAt`, and final status (`succeeded|failed|timeout`).

**Commands are never built from user input.** `lib/capabilities.js` is a strict
allowlist mapping job type -> Docker image + fixed argv command template. The
payload is only ever a *file* handed to those fixed commands.

## Hostinger VPS setup

### 1. Harden SSH first

```bash
# /etc/ssh/sshd_config — key-only auth, no root login
PasswordAuthentication no
PermitRootLogin no
# then: systemctl restart sshd
```

Also enable the Hostinger firewall (or ufw) allowing only outbound traffic +
your SSH port. The agent needs **zero inbound ports**.

### 2. Install Docker and Node.js 20+

```bash
curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Pre-pull the sandbox images so first jobs don't time out:

```bash
docker pull alpine:3.20
docker pull hashicorp/terraform:1.9
docker pull alpine/ansible:2.17.0
```

### 3. Create a least-privilege service account

In Google Cloud Console (the Firebase project):

1. IAM & Admin -> Service Accounts -> Create: `labs-vps-agent`.
2. Grant ONLY **Cloud Datastore User** (`roles/datastore.user`) — Firestore
   read/write, nothing else. Do NOT use the default Firebase Admin SDK
   service account (it has project-wide power).
3. Create a JSON key, copy it to the VPS:

```bash
mkdir -p /opt/hcw-labs-agent
scp service-account.json vps:/opt/hcw-labs-agent/
chmod 600 /opt/hcw-labs-agent/service-account.json
```

### 4. Install the agent

```bash
# from the repo
scp -r labs/vps-agent/* vps:/opt/hcw-labs-agent/
ssh vps
cd /opt/hcw-labs-agent
npm install --omit=dev
cp .env.example .env   # edit values
```

Create a dedicated user with Docker access:

```bash
useradd -r -m -d /opt/hcw-labs-agent -s /usr/sbin/nologin labsagent
usermod -aG docker labsagent
chown -R labsagent:labsagent /opt/hcw-labs-agent
```

### 5. systemd unit

`/etc/systemd/system/hcw-labs-agent.service`:

```ini
[Unit]
Description=HCW Labs VPS Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=labsagent
Group=labsagent
WorkingDirectory=/opt/hcw-labs-agent
EnvironmentFile=/opt/hcw-labs-agent/.env
ExecStart=/usr/bin/node /opt/hcw-labs-agent/index.js
Restart=always
RestartSec=10
# Hardening
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now hcw-labs-agent
journalctl -u hcw-labs-agent -f
```

### 6. Smoke test

From the admin portal: **Labs -> Console -> shell-echo**, payload `hello vps`,
Submit. The job should go `queued -> claimed -> running -> succeeded` with
`hello vps` in the output pane, and the agent should show **online** on the
Dashboard tab.

## Adding a capability

1. Add the entry to `lib/capabilities.js` (image + fixed argv template).
2. Add the matching entry to `LAB_JOB_TYPES` in `functions/labs-functions.js`
   and deploy functions.
3. Pre-pull the Docker image on the VPS, add the type to
   `LABS_AGENT_CAPABILITIES`, restart the service.
