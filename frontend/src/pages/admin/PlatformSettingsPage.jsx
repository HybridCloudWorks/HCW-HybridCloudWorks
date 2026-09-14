/**
 * Platform Settings Hub (route `/admin/platform`) — the `admin_config`
 * documents the pipeline reads on every run, one tab per concern (#571), at
 * the Newsletter Hub's level of separation (components/admin/platform-settings):
 *
 *   Content defaults   default covers; a link to the newsletter's own settings
 *   Social automation  autoposting to Publer on a live publish
 *   Audio              podcast feeds and the Listen & Learn voice
 *   Change history     every save, who made it and what it recorded
 *
 * Each tab mounts only while it is open and loads its own settings, with its
 * own loading and error states, so a failure in one never blanks another.
 * Tabs deep-link with `?tab=`; an id this page does not know lands on the
 * first tab rather than on a blank page.
 *
 * There is no single provider here, so the header names none: Publer is named
 * where it is used, on Social automation.
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';
import ContentDefaultsTab from '@/components/admin/platform-settings/ContentDefaultsTab';
import SocialAutomationTab from '@/components/admin/platform-settings/SocialAutomationTab';
import AudioTab from '@/components/admin/platform-settings/AudioTab';
import ChangeHistoryTab from '@/components/admin/platform-settings/ChangeHistoryTab';

export const TABS = Object.freeze([
  { id: 'content', label: 'Content defaults', Component: ContentDefaultsTab },
  { id: 'social', label: 'Social automation', Component: SocialAutomationTab },
  { id: 'audio', label: 'Audio', Component: AudioTab },
  { id: 'history', label: 'Change history', Component: ChangeHistoryTab },
]);

/** The tab a `?tab=` value opens: a known id, else the first tab. */
export function resolveTab(requested) {
  return TABS.find((tab) => tab.id === requested) ?? TABS[0];
}

export default function PlatformSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = resolveTab(searchParams.get('tab'));
  const ActiveTab = active.Component;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <SlidersHorizontal className="h-6 w-6" /> Platform Settings Hub
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Documents the pipeline reads on every run. Each save is checked against the exact shape
          the code expects before it is stored, replaces the document whole, and is listed under
          Change history.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Platform settings"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`platform-tab-${id}`}
            aria-selected={active.id === id}
            aria-controls="platform-tabpanel"
            onClick={() => setSearchParams({ tab: id })}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              active.id === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="platform-tabpanel" role="tabpanel" aria-labelledby={`platform-tab-${active.id}`}>
        <ActiveTab key={active.id} />
      </div>
    </div>
  );
}
