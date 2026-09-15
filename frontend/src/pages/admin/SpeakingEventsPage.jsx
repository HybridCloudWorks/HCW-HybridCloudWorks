/**
 * Speaking Events Hub (route `/admin/speaking-events`) — sessions from
 * Sessionize, enriched and published from here.
 *
 * Until #573 this was one 885-line scroll: the Sessionize table, manual
 * entries, sync, publish and the explanation of all of it, one after another.
 * It now has a tab per duty, at the Newsletter Hub's standard (#578;
 * components/admin/speaking-events):
 *
 *   Upcoming    sessions today or later, with Enrich / Edit / Delete
 *   Past        delivered sessions, with slides and event links, still editable
 *   Sources     Sessionize (last read, what a sync would change, Sync) and
 *               manual entries (Manual Entry)
 *   Publishing  the public snapshot, what a publish would write, Publish
 *   Settings    the Sessionize speaker ID (read here, saved on the Integrations
 *               Hub's Sessionize card) and the public page's display rules
 *
 * Deep links are `?tab=`; an unknown id, or one naming a tab's content, lands
 * where that content is (speaking-events/tabs.js).
 *
 * State three tabs read lives here: the Sessionize read, the stored overrides,
 * the override editor and the sync. So switching tabs never refetches, and a
 * form opened on Upcoming is still open on Sources. Each read is
 * generation-guarded and each write has an in-flight guard; each tab shows
 * the loading and error state of only the reads it uses, and the header and
 * tab bar always render. Publishing reads the public snapshot itself; Settings
 * reads the speaker ID itself.
 *
 * NOT MOVED SERVER-SIDE (yet). #573 proposes reading Sessionize from the API
 * rather than the browser. This change restructures the page without changing
 * its calls: the browser still fetches the public Sessionize JSON, as the
 * Integrations Hub's Sessionize test does.
 */

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Mic } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import HubTabs from '@/components/admin/HubTabs';
import { TABS, resolveTab } from '@/components/admin/speaking-events/tabs';
import { PastTab, UpcomingTab } from '@/components/admin/speaking-events/SessionsTab';
import SourcesTab from '@/components/admin/speaking-events/SourcesTab';
import PublishingTab from '@/components/admin/speaking-events/PublishingTab';
import SettingsTab from '@/components/admin/speaking-events/SettingsTab';
import useEventEditor from '@/components/admin/speaking-events/useEventEditor';
import useSessionizeSync from '@/components/admin/speaking-events/useSessionizeSync';
import {
  useSessionizeEvents,
  useStoredEvents,
} from '@/components/admin/speaking-events/useSpeakingData';
import { mergeEvents } from '@/components/admin/speaking-events/eventModel';

const PANELS = {
  upcoming: UpcomingTab,
  past: PastTab,
  sources: SourcesTab,
  publishing: PublishingTab,
  settings: SettingsTab,
};

export default function SpeakingEventsPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));

  const sessionize = useSessionizeEvents();
  const stored = useStoredEvents(authReady);
  const editor = useEventEditor(stored);
  const sync = useSessionizeSync(sessionize, stored);
  const rows = useMemo(
    () => mergeEvents(sessionize.data, stored.data),
    [sessionize.data, stored.data]
  );

  const setTab = (id) => {
    if (id !== activeTab) setSearchParams({ tab: id });
  };
  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mic className="h-6 w-6" />
          Speaking Events Hub
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Sessions from <strong>Sessionize</strong>: ID, name, and date come from Sessionize
          automatically. Use <strong>Enrich</strong> to add description, image, and links, then
          publish them from the Publishing tab.
        </p>
      </div>

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setTab}
        idPrefix="speaking-events"
        label="Speaking Events Hub"
      >
        <ActivePanel data={{ sessionize, stored, rows }} editor={editor} sync={sync} />
      </HubTabs>
    </div>
  );
}
