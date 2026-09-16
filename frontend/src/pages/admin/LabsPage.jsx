/**
 * Labs Hub (route `/admin/labs`) — the VPS agents that run jobs for this
 * estate, the jobs they have run, and how a new agent is provisioned.
 *
 * Five tabs by duty (#577, components/admin/labs):
 *
 *   Dashboard  is the fleet up and is anything moving
 *   Jobs       every run the snapshot carries, expandable to what it printed
 *   Console    submit a job and watch it run
 *   Agents     which agents can be reached, and what to do when one cannot
 *   Settings   how a new VPS agent is provisioned
 *
 * Two of those are new. **Jobs** existed only as the bottom third of Dashboard,
 * with columns stopping at the exit code: a job that failed yesterday could be
 * seen to have failed and not why, because its output was rendered only for
 * whichever job the Console had just submitted. **Agents** was the top card of
 * Setup, under six install steps — so "the agent is disconnected" was answered
 * with provisioning instructions whether or not anything needed provisioning.
 *
 * This page already validated `?tab=`, which none of the other hubs did. What
 * it had no answer for was an id that USED to be a tab: `setup` fell through to
 * Dashboard silently. `resolveTab` sends it to Settings (labs/tabs.js).
 *
 * The snapshot is read once, here, because every tab is a view of it — and its
 * staleness clock is deliberately independent of the fetch, so that during an
 * outage `now` keeps advancing and agents stop looking connected (T-309).
 */
import React from 'react';
import { useSearchParams } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import HubTabs from '@/components/admin/HubTabs';
import DashboardTab from '@/components/admin/labs/DashboardTab';
import JobsTab from '@/components/admin/labs/JobsTab';
import ConsoleTab from '@/components/admin/labs/ConsoleTab';
import AgentsTab from '@/components/admin/labs/AgentsTab';
import SettingsTab from '@/components/admin/labs/SettingsTab';
import useLabsLive from '@/components/admin/labs/useLabsLive';
import { FALLBACK_JOB_TYPES, fleetState } from '@/components/admin/labs/labsView';
import { TABS, resolveTab } from '@/components/admin/labs/tabs';

/**
 * Each tab's panel, by id. With TABS in labs/tabs.js this is the whole of
 * adding a tab: every panel receives the same hub state.
 */
const PANELS = {
  dashboard: DashboardTab,
  jobs: JobsTab,
  console: ConsoleTab,
  agents: AgentsTab,
  settings: SettingsTab,
};

export default function LabsPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const live = useLabsLive(authReady);

  const setTab = (id) => {
    if (id === activeTab) return;
    setSearchParams({ tab: id });
  };

  // The server's allowlist when it sent one, the built-in list otherwise: the
  // Console must offer something to submit even before the first snapshot.
  const hub = {
    ...live,
    jobTypes: live.jobTypes.length ? live.jobTypes : FALLBACK_JOB_TYPES,
  };
  const ActivePanel = PANELS[activeTab];
  const fleet = fleetState(hub.agents, hub.now);

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={FlaskConical}
        title="Labs Hub"
        service="VPS agent"
        connected={fleet.state === 'online'}
        description="Run Terraform, Ansible and shell jobs on the Hostinger VPS agents, and see what they returned."
        accent="amber"
      />

      <HubTabs tabs={TABS} active={activeTab} onSelect={setTab} idPrefix="labs" label="Labs Hub">
        <ActivePanel hub={hub} />
      </HubTabs>
    </div>
  );
}
