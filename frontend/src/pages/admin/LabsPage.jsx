/**
 * Labs — admin control panel for the VPS lab execution platform.
 *
 * Pull-based architecture: jobs are enqueued into Firestore `lab_jobs` via the
 * enqueueLabJob Cloud Function; the Hostinger VPS agent (labs/vps-agent/)
 * dials out, claims jobs, runs them in sandboxed Docker containers and writes
 * results back. No inbound ports on the VPS. Admin clients are read-only on
 * lab_jobs / lab_agents (see platform/firebase/firestore.rules).
 *
 * Tabs:
 *   Dashboard — agent status cards + queue depth + recent jobs table (live)
 *   Console   — submit a job from the server-side allowlist, watch live output
 *   Setup     — Hostinger connect runbook (mirrors labs/vps-agent/README.md)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { postJSON } from '@/lib/api';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { FlaskConical, Loader2, Server, Send, Ban, Terminal, Cpu, ListOrdered } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'console', label: 'Console' },
  { id: 'setup', label: 'Setup' },
];

// 3 missed 30s heartbeats — must match getLabsSnapshot in functions/labs-functions.js
const STALE_AFTER_MS = 90 * 1000;

// Fallback mirror of LAB_JOB_TYPES in functions/labs-functions.js. The Console
// prefers the live list returned by getLabsSnapshot; this keeps the select
// usable if that call fails. The server re-validates on enqueue either way.
const FALLBACK_JOB_TYPES = [
  { type: 'shell-echo', description: 'Smoke test — echoes the payload back from the sandbox.' },
  {
    type: 'terraform-validate',
    description: 'terraform init -backend=false && terraform validate on the payload HCL.',
  },
  {
    type: 'ansible-check',
    description: 'ansible-playbook --syntax-check on the payload playbook YAML.',
  },
];

const STATUS_STYLES = {
  queued: 'border-sky-300 text-sky-600 dark:border-sky-700 dark:text-sky-400',
  claimed: 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
  running: 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400',
  succeeded: 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400',
  failed: 'border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400',
  timeout: 'border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400',
  cancelled: 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400',
};

function StatusBadge({ status }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] capitalize ${STATUS_STYLES[status] || STATUS_STYLES.cancelled}`}
    >
      {status}
    </Badge>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

function isAgentOnline(agent, now) {
  const lastSeen = toMillis(agent.lastSeenAt);
  return lastSeen > 0 && now - lastSeen < STALE_AFTER_MS;
}

function formatDuration(job) {
  const start = toMillis(job.claimedAt) || toMillis(job.createdAt);
  const end = toMillis(job.finishedAt);
  if (!start || !end || end < start) return '—';
  const seconds = (end - start) / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTime(ts) {
  const ms = toMillis(ts);
  return ms ? new Date(ms).toLocaleString() : '—';
}

/**
 * Polling view of lab_agents + recent lab_jobs (admin read-only) — the
 * getLabsSnapshot RPC every 15s replaces the two Firestore subscriptions,
 * and also supplies the server's job-type allowlist.
 */
function useLabsLive(enabled) {
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const load = async () => {
      try {
        const snap = await postJSON('getLabsSnapshot', {});
        if (cancelled) return;
        setError(null);
        setAgents(snap?.agents || []);
        setJobs(snap?.jobs || []);
        if (Array.isArray(snap?.jobTypes) && snap.jobTypes.length) setJobTypes(snap.jobTypes);
        setNow(Date.now());
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    load();
    const ticker = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [enabled]);

  return { agents, jobs, jobTypes, error, now };
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────

function AgentCard({ agent, now }) {
  const online = isAgentOnline(agent, now);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Server
          className={`h-5 w-5 shrink-0 mt-0.5 ${online ? 'text-emerald-500' : 'text-muted-foreground'}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{agent.agentId || agent.id}</p>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                online
                  ? 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400'
                  : 'border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400'
              }`}
            >
              {online ? 'Online' : 'Offline'}
            </Badge>
            {agent.version && (
              <Badge variant="outline" className="text-[10px]">
                v{agent.version}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {agent.hostname || 'unknown host'} · last seen {formatTime(agent.lastSeenAt)}
            {online && agent.status ? ` · ${agent.status}` : ''}
          </p>
          {(agent.capabilities || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {agent.capabilities.map((cap) => (
                <Badge key={cap} variant="outline" className="text-[10px] font-mono">
                  {cap}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DashboardTab({ agents, jobs, now, error }) {
  const queueDepth = jobs.filter((j) => j.status === 'queued').length;
  const onlineCount = agents.filter((a) => isAgentOnline(a, now)).length;

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">Live subscription error: {error}</p>}

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 flex items-center gap-3">
          <Server className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-lg font-bold leading-none">
              {onlineCount}/{agents.length || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Agents online</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <ListOrdered className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-lg font-bold leading-none">{queueDepth}</p>
            <p className="text-xs text-muted-foreground mt-1">Jobs queued</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <Cpu className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-lg font-bold leading-none">
              {jobs.filter((j) => j.status === 'running' || j.status === 'claimed').length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Jobs in flight</p>
          </div>
        </Card>
      </div>

      {/* Agents */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Agents</h2>
        {agents.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No agents have ever connected. Head to the Setup tab to provision the Hostinger VPS.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} now={now} />
            ))}
          </div>
        )}
      </div>

      {/* Recent jobs */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Recent jobs</h2>
        {jobs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No jobs yet. Submit a shell-echo smoke test from the Console tab.
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Exit</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono">{job.type}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-3 py-2 font-mono">{job.agentId || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatTime(job.createdAt)}</td>
                    <td className="px-3 py-2">{formatDuration(job)}</td>
                    <td className="px-3 py-2 font-mono">{job.exitCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Console tab ───────────────────────────────────────────────────────────────

const PAYLOAD_PLACEHOLDERS = {
  'terraform-validate': '# main.tf contents…',
  'ansible-check': '# playbook.yml contents…',
};

function JobOutputPane({ activeJobId, activeJob, cancelling, onCancel }) {
  const isTerminal = ['succeeded', 'failed', 'timeout', 'cancelled'].includes(activeJob?.status);
  if (!activeJobId) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Submit a job to watch it run.
      </p>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-mono text-muted-foreground">{activeJobId}</span>
        <StatusBadge status={activeJob?.status || 'queued'} />
        {activeJob?.agentId && (
          <span className="text-muted-foreground">on {activeJob.agentId}</span>
        )}
        {activeJob?.exitCode !== null && activeJob?.exitCode !== undefined && (
          <span className="font-mono text-muted-foreground">exit {activeJob.exitCode}</span>
        )}
        {activeJob?.status === 'queued' && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={cancelling}
            className="gap-1 ml-auto"
          >
            {cancelling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Ban className="h-3 w-3" />
            )}
            Cancel
          </Button>
        )}
      </div>
      <pre className="bg-muted/60 border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-auto">
        {activeJob?.output ??
          (isTerminal ? '(no output)' : 'Waiting for the agent to pick this up…')}
      </pre>
      {isTerminal && (
        <p className="text-xs text-muted-foreground">
          Finished {formatTime(activeJob?.finishedAt)} · duration {formatDuration(activeJob || {})}
        </p>
      )}
    </>
  );
}

function ConsoleTab({ jobTypes }) {
  const { toast } = useToast();
  const [type, setType] = useState(jobTypes[0]?.type || 'shell-echo');
  const [payload, setPayload] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  // Keep the selected type valid when the live job-type list arrives —
  // derived during render rather than synced via effect.
  const effectiveType =
    jobTypes.length && !jobTypes.some((jt) => jt.type === type) ? jobTypes[0].type : type;

  // Status/output for the submitted job — poll getLabJob until it reaches a
  // terminal state (replaces the per-doc Firestore subscription).
  useEffect(() => {
    if (!activeJobId) return undefined;
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const res = await postJSON('getLabJob', { jobId: activeJobId });
        if (cancelled) return;
        const job = res?.job || null;
        setActiveJob(job);
        const terminal = ['succeeded', 'failed', 'cancelled'].includes(job?.status);
        if (!terminal) timer = setTimeout(poll, 5000);
      } catch (err) {
        if (cancelled) return;
        setActiveJob({
          id: activeJobId,
          status: 'failed',
          output: `status fetch error: ${err.message}`,
        });
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId]);

  const selectedSpec = jobTypes.find((jt) => jt.type === effectiveType);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await postJSON('enqueueLabJob', { type: effectiveType, payload });
      setActiveJob(null);
      setActiveJobId(res.jobId);
      toast({ title: 'Job queued', description: `${type} → ${res.jobId}` });
    } catch (err) {
      toast({ title: 'Submit failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    setCancelling(true);
    try {
      await postJSON('cancelLabJob', { jobId: activeJobId });
      toast({ title: 'Job cancelled' });
    } catch (err) {
      toast({ title: 'Cancel failed', description: err.message, variant: 'destructive' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Submit form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit a job</CardTitle>
          <CardDescription>
            Job types come from a server-side allowlist; the agent only ever runs fixed, sandboxed
            commands — the payload is mounted as a read-only file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Job type</Label>
            <select
              value={effectiveType}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {jobTypes.map((jt) => (
                <option key={jt.type} value={jt.type}>
                  {jt.type}
                </option>
              ))}
            </select>
            {selectedSpec?.description && (
              <p className="text-xs text-muted-foreground mt-1">{selectedSpec.description}</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Payload</Label>
            <Textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={10}
              placeholder={PAYLOAD_PLACEHOLDERS[effectiveType] || 'hello vps'}
              className="mt-1 font-mono text-xs"
            />
            {selectedSpec?.maxPayloadBytes && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Max {Math.round(selectedSpec.maxPayloadBytes / 1024)} KB
              </p>
            )}
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Submit job
          </Button>
        </CardContent>
      </Card>

      {/* Live job status + output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Job output
          </CardTitle>
          <CardDescription>
            Live via Firestore — updates as the agent claims, runs, and finishes the job.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <JobOutputPane
            activeJobId={activeJobId}
            activeJob={activeJob}
            cancelling={cancelling}
            onCancel={handleCancel}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Setup tab ─────────────────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    title: 'Harden the Hostinger VPS',
    body: 'SSH key-only auth (PasswordAuthentication no, PermitRootLogin no), then enable the Hostinger firewall / ufw allowing only outbound traffic plus your SSH port. The agent is pull-based — it needs zero inbound ports.',
  },
  {
    title: 'Install Docker + Node.js 20',
    body: 'curl -fsSL https://get.docker.com | sh, then install Node 20 from NodeSource. Pre-pull the sandbox images: alpine:3.20, hashicorp/terraform:1.9, alpine/ansible:2.17.0.',
  },
  {
    title: 'Create a least-privilege service account',
    body: 'In the Firebase project\'s Google Cloud Console: IAM → Service Accounts → create "labs-vps-agent" with ONLY roles/datastore.user (Firestore read/write — nothing else). Download a JSON key and copy it to /opt/hcw-labs-agent/service-account.json (chmod 600).',
  },
  {
    title: 'Install the agent',
    body: 'Copy labs/vps-agent/* to /opt/hcw-labs-agent, npm install --omit=dev, cp .env.example .env and set LABS_AGENT_SERVICE_ACCOUNT plus an LABS_AGENT_ID. Create a dedicated "labsagent" user in the docker group and chown the directory.',
  },
  {
    title: 'Enable the systemd service',
    body: 'Install the hcw-labs-agent.service unit from labs/vps-agent/README.md, then systemctl enable --now hcw-labs-agent. Tail logs with journalctl -u hcw-labs-agent -f.',
  },
  {
    title: 'Run the smoke test',
    body: 'The agent should appear Online below within ~30 seconds. Then go to the Console tab, pick shell-echo, payload "hello vps", and Submit — the job should run queued → claimed → running → succeeded with the payload echoed back.',
  },
];

function SetupTab({ agents, now }) {
  const onlineAgents = agents.filter((a) => isAgentOnline(a, now));
  const connected = onlineAgents.length > 0;

  let connectionLabel = 'No agent connected yet';
  if (connected) connectionLabel = `${onlineAgents.length} agent(s) connected`;
  else if (agents.length > 0) connectionLabel = 'Agent registered but offline (stale heartbeat)';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Live connection state */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
              connected ? 'bg-emerald-500' : 'bg-rose-400 animate-pulse'
            }`}
          />
          <div>
            <p className="text-sm font-semibold">{connectionLabel}</p>
            <p className="text-xs text-muted-foreground">
              {connected
                ? onlineAgents.map((a) => a.agentId || a.id).join(', ')
                : 'Follow the steps below — this updates live when the agent heartbeats.'}
            </p>
          </div>
        </div>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {SETUP_STEPS.map((step, i) => (
          <Card key={step.title} className="p-4">
            <div className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{step.body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Full runbook with copy-paste commands: <code>labs/vps-agent/README.md</code> and{' '}
        <code>documentation/labs-platform-guide.md</code> in the repo.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LabsPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some((t) => t.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'dashboard';
  const setTab = (id) => setSearchParams({ tab: id });

  const { agents, jobs, jobTypes: liveJobTypes, error, now } = useLabsLive(authReady);

  // Job-type allowlist for the Console (server is source of truth; fallback
  // list until the first snapshot arrives).
  const jobTypes = liveJobTypes.length ? liveJobTypes : FALLBACK_JOB_TYPES;

  const connected = useMemo(
    () => (authReady ? agents.some((a) => isAgentOnline(a, now)) : 'checking'),
    [authReady, agents, now]
  );

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={FlaskConical}
        title="Labs"
        service="VPS Agent"
        connected={connected}
        poweredBy="Hostinger VPS"
        description="Run sandboxed lab jobs (Terraform validate, Ansible checks) on the VPS via a pull-based Firestore queue — no inbound ports."
        accent="emerald"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'dashboard' && (
          <DashboardTab agents={agents} jobs={jobs} now={now} error={error} />
        )}
        {activeTab === 'console' && <ConsoleTab jobTypes={jobTypes} />}
        {activeTab === 'setup' && <SetupTab agents={agents} now={now} />}
      </div>
    </div>
  );
}
