/**
 * The pieces more than one Labs tab renders (#577).
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Server } from 'lucide-react';
import { isAgentOnline } from '@/lib/labsPolling';
import { STATUS_STYLES, formatTime } from './labsView';

export function StatusBadge({ status }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] capitalize ${STATUS_STYLES[status] || STATUS_STYLES.cancelled}`}
    >
      {status}
    </Badge>
  );
}

/**
 * Only a literal `false`: a snapshot from an API older than #740 carries no
 * `active` at all, and that agent is not known to be deactivated.
 */
function DeactivatedBadge({ active }) {
  if (active !== false) return null;
  return (
    <Badge
      variant="outline"
      className="text-[10px] border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"
    >
      Deactivated
    </Badge>
  );
}

/**
 * The service principal the registry binds the agent to. "Agent access
 * required" has three causes at gate 2 (no document, deactivated, another
 * object id), and this line is how the third is told from the other two.
 */
function ObjectIdLine({ oid }) {
  if (!oid) return null;
  return (
    <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">object id {oid}</p>
  );
}

/**
 * One agent. The Agents tab passes `actions` (Activate or Deactivate, #740)
 * and `registry`, which adds the bound object id; the Dashboard passes
 * neither.
 */
export function AgentCard({ agent, now, actions = null, registry = false }) {
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
            <DeactivatedBadge active={agent.active} />
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
          {registry && <ObjectIdLine oid={agent.oid} />}
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
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </Card>
  );
}
