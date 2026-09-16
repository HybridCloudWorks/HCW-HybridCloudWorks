/**
 * Social Hub (route `/admin/social`) — schedule HCW articles to LinkedIn, X,
 * Facebook, Instagram, Threads and YouTube through Publer, and see what went
 * out.
 *
 * Until #575 this was one 1,551-line component holding the Publer client, the
 * view helpers and four tabs' worth of JSX. It now has a tab per duty, at the
 * Newsletter Hub's standard (components/admin/social):
 *
 *   Compose    pick a published page, choose accounts, write the caption and
 *              schedule it — or publish it now
 *   Queue      what Publer is holding, and this hub's own records of it
 *   Published  the history, by day, with the per-account outcomes Publer sent
 *   Accounts   the connected profiles and which platforms they cover
 *   Settings   whether the proxy can use its credentials, and where the rest
 *              of it is set
 *
 * Deep links are `?tab=`; the old id `settings` still lands on Settings, and
 * the words for content that moved (connection, profiles, calendar) land where
 * it went (social/tabs.js).
 *
 * Each tab reads its own data, so a Publer key that is missing cannot blank the
 * content picker and a content read that fails cannot empty the account list.
 * There is nothing for two tabs here to disagree about: unlike the Listen &
 * Learn Hub, no tab writes state another tab shows.
 *
 * Publer credentials are function-app settings resolved by the `publerProxy`
 * Azure Function and are never bundled into the client (FINDING-04):
 *   PUBLER_API_KEY        — Publer API key
 *   PUBLER_WORKSPACE_ID   — Publer workspace ID
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { Share2 } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import HubTabs from '@/components/admin/HubTabs';
import ComposeTab from '@/components/admin/social/ComposeTab';
import QueueTab from '@/components/admin/social/QueueTab';
import PublishedTab from '@/components/admin/social/PublishedTab';
import AccountsTab from '@/components/admin/social/AccountsTab';
import SettingsTab from '@/components/admin/social/SettingsTab';
import { publerReady } from '@/components/admin/social/publerApi';
import { TABS, resolveTab } from '@/components/admin/social/tabs';

/**
 * Each tab's panel, by id. With TABS in social/tabs.js this is the whole of
 * adding a tab: every panel is handed the same two props — whether auth is
 * ready, and the `?contentId=` a deep link from the publish flow carries — and
 * reads whatever else it needs itself.
 */
const PANELS = {
  compose: ComposeTab,
  queue: QueueTab,
  published: PublishedTab,
  accounts: AccountsTab,
  settings: SettingsTab,
};

export default function SocialHubPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));

  const setTab = (id) => {
    if (id === activeTab) return;
    setSearchParams({ tab: id });
  };

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Share2}
        title="Social Hub"
        service="Publer"
        connected={publerReady()}
        description="Schedule content to LinkedIn, X, Facebook, Instagram, Threads and YouTube via Publer."
        accent="pink"
      />

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setTab}
        idPrefix="social"
        label="Social Hub"
      >
        <ActivePanel ready={authReady} contentId={searchParams.get('contentId') || ''} />
      </HubTabs>
    </div>
  );
}
