/**
 * Recording Hub (route `/admin/recording-hub`) — the podcast pipeline, from a
 * recording to a published episode.
 *
 * Until #576 this had one tab per PROVIDER: Podcast, and Plaud with three
 * sub-tabs of its own. That made "where do I approve a transcript" depend on
 * which service produced it, and put the OAuth setup two clicks inside a
 * working tab. It is a tab per duty now, at the Newsletter Hub's standard
 * (components/admin/recording-hub):
 *
 *   Recordings    the live Plaud library, what is stored, and the two ways to
 *                 add audio — with "Script this" on each
 *   Transcripts   what the pipeline produced, with review and approval
 *   Episodes      what is live on the show, read from the public feed
 *   Distribution  what this hub sent to RSS.com and how it went, failures first
 *   Settings      the Plaud connection, the refresh timer's record, and links
 *                 to the settings this hub reads but does not own
 *
 * Providers are named in the header and inside the tabs, not as tabs.
 *
 * Deep links are `?tab=`, which this page did not have at all before — it held
 * the selected tab in `useState`, so no link could name one and Back could not
 * leave one. The two old provider ids and the Plaud sub-tab ids land where
 * their content went (recording-hub/tabs.js).
 *
 * The transcript list is read once, here, because Transcripts and Distribution
 * are two views of it: approving a transcript is exactly what creates the
 * RSS.com record Distribution shows (useRecordingHub). /admin/recordings
 * redirects here.
 */
import React from 'react';
import { useSearchParams } from 'react-router';
import { Radio, RefreshCw } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import HubTabs from '@/components/admin/HubTabs';
import RecordingsTab from '@/components/admin/recording-hub/RecordingsTab';
import TranscriptsTab from '@/components/admin/recording-hub/TranscriptsTab';
import EpisodesTab from '@/components/admin/recording-hub/EpisodesTab';
import DistributionTab from '@/components/admin/recording-hub/DistributionTab';
import SettingsTab from '@/components/admin/recording-hub/SettingsTab';
import useRecordingHub, { CONNECTION } from '@/components/admin/recording-hub/useRecordingHub';
import { TABS, resolveTab } from '@/components/admin/recording-hub/tabs';

/**
 * Each tab's panel, by id. With TABS in recording-hub/tabs.js this is the whole
 * of adding a tab: every panel receives the same hub state.
 */
/**
 * What ServicePageHeader shows for each connection state. `checking` and
 * `unknown` pass through as themselves: the header renders a third state for
 * them, which is the whole reason the hub keeps them apart from `disconnected`.
 */
const HEADER_STATE = Object.freeze({
  [CONNECTION.connected]: true,
  [CONNECTION.disconnected]: false,
  [CONNECTION.checking]: CONNECTION.checking,
  [CONNECTION.unknown]: CONNECTION.unknown,
});

const PANELS = {
  recordings: RecordingsTab,
  transcripts: TranscriptsTab,
  episodes: EpisodesTab,
  distribution: DistributionTab,
  settings: SettingsTab,
};

export default function RecordingHubPage() {
  const { authReady } = useAuthReady();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const hub = useRecordingHub(authReady, toast);

  const setTab = (id) => {
    if (id === activeTab) return;
    setSearchParams({ tab: id });
  };

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Radio}
        title="Recording Hub"
        service="Plaud"
        connected={HEADER_STATE[hub.connection]}
        description="Browse and transcribe your Plaud recordings, review the transcripts the podcast pipeline produced, and see what reached RSS.com."
        accent="violet"
      />

      {hub.connection === CONNECTION.unknown && (
        <p
          role="status"
          className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 flex-wrap"
        >
          Could not check the Plaud connection; the Library may still work.
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
            onClick={hub.recheckConnection}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Check again
          </Button>
        </p>
      )}

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setTab}
        idPrefix="recording-hub"
        label="Recording Hub"
      >
        <ActivePanel hub={hub} />
      </HubTabs>
    </div>
  );
}
