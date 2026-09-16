/**
 * Dashboard — is the fleet up, and is anything moving (#577).
 *
 * The three counters and the agent cards. The job table that used to sit below
 * them is the Jobs tab now: "how many are queued" and "what did run 47 print"
 * are different questions, and the second one needs room.
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { Cpu, ListOrdered, Server } from 'lucide-react';
import { isAgentOnline } from '@/lib/labsPolling';
import { AgentCard } from './shared';
import { tabHref } from './tabs';

function Stat({ icon: Icon, value, label }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </Card>
  );
}

export default function DashboardTab({ hub }) {
  const { agents, jobs, now, error } = hub;
  const queueDepth = jobs.filter((j) => j.status === 'queued').length;
  const inFlight = jobs.filter((j) => j.status === 'running' || j.status === 'claimed').length;
  const onlineCount = agents.filter((a) => isAgentOnline(a, now)).length;

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">Live subscription error: {error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={Server} value={`${onlineCount}/${agents.length || 0}`} label="Agents online" />
        <Stat icon={ListOrdered} value={queueDepth} label="Jobs queued" />
        <Stat icon={Cpu} value={inFlight} label="Jobs in flight" />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Agents</h2>
        {agents.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No agents have ever connected.{' '}
            <a href={tabHref('settings')} className="underline">
              The Settings tab
            </a>{' '}
            has the provisioning steps.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} now={now} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
