/**
 * Listen & Learn Hub (route `/admin/listen-and-learn`) — one study podcast per
 * scored area of a certification's official study guide, generated as drafts
 * and published only on approval.
 *
 * Until #574 this was one scroll: the generate form, the grounding panel, the
 * list of sets, and the chosen set's episodes, all stacked. It now has a tab
 * per duty, at the Newsletter Hub's standard
 * (components/admin/listen-and-learn):
 *
 *   Generate   pick a certification, ground it on owner-supplied pages and
 *              videos (#433), and run — with the expected speech spend
 *   Review     generated episodes that are not live, with transcripts and an
 *              audio preview, and the approval that publishes them
 *   Published  what is live for a set, where an episode can be withdrawn
 *   Settings   the voice default (set on Platform settings) and why
 *              certification episodes are grounded the way they are
 *
 * Deep links are `?tab=`; the old section words (sets, episodes, voice,
 * grounding) and anything unknown land where their content went
 * (listen-and-learn/tabs.js).
 *
 * The sets and the chosen set's episodes are read once, here on the page,
 * because Review and Published both show them and an approval on one must be
 * on the other (useListenAndLearn, with its generation guard on reads and a
 * per-episode in-flight guard on approvals). A run keeps reporting its
 * progress while the operator is on another tab, because `generating` and
 * `progress` live in the hook rather than in the Generate tab.
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { Headphones } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import HubTabs from '@/components/admin/HubTabs';
import GenerateTab from '@/components/admin/listen-and-learn/GenerateTab';
import { ReviewTab, PublishedTab } from '@/components/admin/listen-and-learn/SetEpisodesTab';
import SettingsTab from '@/components/admin/listen-and-learn/SettingsTab';
import useListenAndLearn from '@/components/admin/listen-and-learn/useListenAndLearn';
import { TABS, resolveTab } from '@/components/admin/listen-and-learn/tabs';

/**
 * Each tab's panel, by id. With TABS in listen-and-learn/tabs.js this is the
 * whole of adding a tab: every panel receives the same hub state.
 */
const PANELS = {
  generate: GenerateTab,
  review: ReviewTab,
  published: PublishedTab,
  settings: SettingsTab,
};

export default function ListenAndLearnPage() {
  // The hook returns `authReady`; destructuring `ready` left this undefined
  // and the initial load below never ran.
  const { authReady: ready } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const hub = useListenAndLearn(ready);

  const setTab = (id) => {
    if (id === activeTab) return;
    setSearchParams({ tab: id });
  };

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Headphones}
        title="Listen & Learn"
        service="Gemini TTS"
        connected="unknown"
        description="One study podcast per scored area of a certification's official study guide. Every episode is generated as a draft — nothing reaches the site until it is approved here."
        poweredBy="Gemini TTS"
        accent="violet"
      />

      {hub.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {hub.error}
        </div>
      )}

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={setTab}
        idPrefix="listen-and-learn"
        label="Listen & Learn Hub"
      >
        <ActivePanel hub={hub} />
      </HubTabs>
    </div>
  );
}
