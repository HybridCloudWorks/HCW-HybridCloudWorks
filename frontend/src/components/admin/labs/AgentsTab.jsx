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
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, Server } from 'lucide-react';
import { AgentCard } from './shared';
import { fleetState } from './labsView';
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

export default function AgentsTab({ hub }) {
  const { agents, now } = hub;
  const fleet = fleetState(agents, now);

  return (
    <div className="space-y-6 max-w-3xl">
      <FleetBanner fleet={fleet} />

      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} now={now} />
          ))}
        </div>
      )}

      {/* A stale agent is installed and stopped; a reinstall is the wrong fix. */}
      {fleet.state === 'stale' && <Reconnect />}

      {fleet.state === 'none' && (
        <Card className="p-6 text-sm text-muted-foreground flex items-start gap-3">
          <Server className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Nothing has ever connected, so there is nothing to reconnect.{' '}
            <a href={tabHref('settings')} className="underline">
              The Settings tab
            </a>{' '}
            has the six provisioning steps.
          </span>
        </Card>
      )}
    </div>
  );
}
