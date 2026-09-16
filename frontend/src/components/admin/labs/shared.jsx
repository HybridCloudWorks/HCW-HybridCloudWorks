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

export function AgentCard({ agent, now }) {
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
