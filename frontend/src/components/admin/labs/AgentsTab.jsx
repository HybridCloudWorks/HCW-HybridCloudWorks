/**
 * Agents — which VPS agents this hub can reach, and what to do when it cannot
 * (#577).
 *
 * New in #577. The live connection state was the top card of the Setup tab,
 * under six provisioning steps that are irrelevant once an agent exists — so
 * "the agent is disconnected" was answered with a wall of install instructions
 * whether or not anything needed installing.
 *
 * The three states get three different answers, which is the point of the tab:
 *
 *   online   nothing to do; the agents are listed with their heartbeats
 *   stale    an agent HAS connected and stopped. The fix is on the box —
 *            restart the service and read its log — not a reinstall
 *   none     nothing has ever connected, so the steps really are the answer
 *
 * Collapsing `stale` into "not connected" is what sent an operator to
 * reinstall something already installed.
 *
 * #740 made this tab the registry's write path as well: **Register agent**
 * (RegisterAgentForm.jsx) writes `lab_agents/{agentId}`, the record the API's
 * agent guard admits an agent by, and each card carries **Deactivate** or
 * **Activate**. Deactivating asks first, because the API refuses that agent
 * from its next call; activating does not, because it only restores what an
 * operator already set up. Both refresh the snapshot so the card changes when
 * the toast appears.
 */
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ConfirmModal from '@/components/admin/ConfirmModal';
import { AlertTriangle, CheckCircle, Loader2, Power, PowerOff, Server } from 'lucide-react';
import { sendJSON } from '@/lib/api';
import { AgentCard } from './shared';
import { REGISTER_SCRIPT, fleetState } from './labsView';
import RegisterAgentForm from './RegisterAgentForm';
import { tabHref } from './tabs';

/** The one command that restarts the agent, and the one that says why it stopped. */
const RECONNECT = Object.freeze([
  {
    title: 'Restart the service on the VPS',
    body: 'sudo systemctl restart hcw-labs-agent — the agent is pull-based, so nothing needs to be opened inbound for it to come back.',
  },
  {
    title: 'Read why it stopped',
    body: 'sudo journalctl -u hcw-labs-agent -n 100 --no-pager. An expired certificate, a rotated Entra secret or a failed npm ci all look identical from here: the heartbeat simply stops.',
  },
  {
    title: 'Check the credential has not expired',
    body: 'The agent authenticates with a certificate on the LabAgent app role. If journalctl shows an auth failure rather than a crash, the certificate or the app registration is what to renew — not the install.',
  },
]);

function Reconnect() {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Getting it back</h2>
      {RECONNECT.map((step, i) => (
        <Card key={step.title} className="p-4">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-xs font-bold">
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
  );
}

/** The banner, which is the only part that differs across the three states. */
function FleetBanner({ fleet }) {
  const online = fleet.state === 'online';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {online ? (
          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        )}
        <div>
          <p className="text-sm font-semibold">{fleet.label}</p>
          <p className="text-xs text-muted-foreground">
            {online
              ? fleet.online.map((a) => a.agentId || a.id).join(', ')
              : 'This updates live when the agent heartbeats.'}
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Deactivate or Activate one agent: `PATCH cms/labs/agents/{agentId}`.
 *
 * Nothing is offered when the snapshot carries no `active` (an API older than
 * #740): the button would have to guess which of the two to show.
 */
function ActiveToggle({ agent, onChanged }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  if (typeof agent.active !== 'boolean') return null;
  const id = agent.agentId || agent.id;

  const apply = async (active) => {
    setConfirming(false);
    setSaving(true);
    try {
      await sendJSON(`cms/labs/agents/${encodeURIComponent(id)}`, 'PATCH', { active });
      toast(
        active
          ? {
              title: 'Agent activated',
              description: `The API admits ${id} from its next heartbeat.`,
            }
          : { title: 'Agent deactivated', description: `The API refuses ${id} from its next call.` }
      );
      onChanged?.();
    } catch (err) {
      toast({
        title: active ? 'Activate failed' : 'Deactivate failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const Icon = agent.active ? PowerOff : Power;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={saving}
        className="gap-1"
        aria-label={`${agent.active ? 'Deactivate' : 'Activate'} ${id}`}
        onClick={() => (agent.active ? setConfirming(true) : apply(true))}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
        {agent.active ? 'Deactivate' : 'Activate'}
      </Button>
      <ConfirmModal
        open={confirming}
        title={`Deactivate ${id}?`}
        description={
          'The API refuses its next heartbeat and job claim with "Agent access required", so it stops taking work. Its object id and job types are kept, and Activate turns it back on.'
        }
        confirmLabel="Deactivate"
        onConfirm={() => apply(false)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export default function AgentsTab({ hub }) {
  const { agents, now, jobTypes, refresh } = hub;
  const fleet = fleetState(agents, now);

  return (
    <div className="space-y-6 max-w-3xl">
      <FleetBanner fleet={fleet} />

      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.agentId || agent.id}
              agent={agent}
              now={now}
              registry
              actions={<ActiveToggle agent={agent} onChanged={refresh} />}
            />
          ))}
        </div>
      )}

      {/* A stale agent is installed and stopped; a reinstall is the wrong fix. */}
      {fleet.state === 'stale' && <Reconnect />}

      {fleet.state === 'none' && (
        <Card className="p-6 text-sm text-muted-foreground flex items-start gap-3">
          <Server className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Nothing has ever connected, so there is nothing to reconnect. Register it below with the
            two values <code>{REGISTER_SCRIPT}</code> prints;{' '}
            <a href={tabHref('settings')} className="underline">
              the Settings tab
            </a>{' '}
            has the six provisioning steps.
          </span>
        </Card>
      )}

      <RegisterAgentForm jobTypes={jobTypes} onRegistered={refresh} />
    </div>
  );
}
