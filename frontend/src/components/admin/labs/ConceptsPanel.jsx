/**
 * Concepts — the three things the Labs Hub manages, each defined once with
 * its live state (ADR 0033 "Labs": Agent / Desktop / Lab explained):
 *
 *   Agent    the VPS job runner (vps-agent) that claims validation jobs;
 *            its state is the fleet from the snapshot
 *   Desktop  the Coder workspace (code-server in the browser) a learner
 *            opens from a lab's page; its state is the public coder-status
 *            read, the same one the public pages show
 *   Lab      a catalogue row: providers, objectives, steps, a check; its
 *            state is how many are listed publicly
 *
 * The public pages define the same three in a learner's words
 * (components/labs/HowLabsWork.jsx); this is the operator's version, with
 * the tools named and the status in the shared vocabulary (lib/status.js).
 */
import React from 'react';
import { Card } from '@/components/ui/card';
import { Bot, FlaskConical, Monitor } from 'lucide-react';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { workspaceStatusWord } from '@/components/labs/WorkspaceStatusBadge';
import { availableLabs, labs } from '@/data/labs/catalogue';
import { usePublicData } from '@/hooks/usePublicData';
import { fetchCoderStatus } from '@/lib/publicApi';
import { fleetState, fleetStatusWord } from './labsView';
import { tabHref } from './tabs';

/** `usePublicData` key for the Desktop read on the admin page. */
export const DESKTOP_STATUS_KEY = 'labs:admin:coder-status';

function Concept({ icon: Icon, title, body, status, detail, href, hrefLabel }) {
  return (
    <Card className="p-4 flex flex-col gap-2" data-concept={title.toLowerCase()}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          {title}
        </h3>
        {status}
      </div>
      <p className="text-xs text-muted-foreground">{body}</p>
      {detail ? <p className="text-xs">{detail}</p> : null}
      <a href={href} className="text-xs underline underline-offset-4 hover:text-primary self-start">
        {hrefLabel}
      </a>
    </Card>
  );
}

/** "1 of 5 workspaces running", or why the count is not known. */
function desktopDetail(word, capacity) {
  const running = capacity?.running;
  const max = capacity?.max;
  if (typeof running === 'number' && typeof max === 'number') {
    return `${running} of ${max} workspaces running`;
  }
  return word === 'unknown' ? 'Reading Coder status…' : 'Workspace count not available';
}

export default function ConceptsPanel({ agents, now }) {
  const fleet = fleetState(agents, now);
  const desktop = usePublicData(() => fetchCoderStatus(), DESKTOP_STATUS_KEY);
  const desktopWord = workspaceStatusWord({
    status: desktop.loading && desktop.data === null ? undefined : desktop.data,
    loading: desktop.loading,
    error: desktop.error,
  });

  return (
    <section aria-labelledby="labs-concepts-heading" className="space-y-2">
      <h2 id="labs-concepts-heading" className="text-sm font-semibold">
        Concepts
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Concept
          icon={Bot}
          title="Agent"
          body="The job runner on the lab host (vps-agent, systemd unit hcw-labs-agent). It claims validation jobs of the types it is registered for, runs each as one fixed, sandboxed command with no network, and reports the result."
          status={<StatusBadge system={fleetStatusWord(fleet)} size="xs" />}
          detail={fleet.label}
          href={tabHref('agents')}
          hrefLabel="Agents tab"
        />
        <Concept
          icon={Monitor}
          title="Desktop"
          body="The Coder workspace a learner opens from a lab's page: code-server in the browser, one container per learner per lab from the hcw-lab template, GitHub sign-in, autostop after an hour."
          status={<StatusBadge system={desktopWord} size="xs" />}
          detail={desktopDetail(desktopWord, desktop.data?.capacity)}
          href="/education/labs"
          hrefLabel="Public labs index"
        />
        <Concept
          icon={FlaskConical}
          title="Lab"
          body="A catalogue row: the provider hubs it is listed under, objectives, prerequisites, steps in order, resources and the runner check that confirms the work. Published under each provider's Learn section."
          status={
            <StatusBadge
              status={{
                id: availableLabs.length > 0 ? 'listed' : 'none',
                label: `${availableLabs.length} listed`,
                tone: availableLabs.length > 0 ? 'ok' : 'warn',
                help: `${availableLabs.length} of ${labs.length} catalogue rows are listed on the public pages.`,
              }}
              size="xs"
            />
          }
          detail={`${labs.length} in the catalogue`}
          href={tabHref('catalogue')}
          hrefLabel="Catalogue tab"
        />
      </div>
    </section>
  );
}
