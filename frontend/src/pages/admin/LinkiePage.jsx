/**
 * Linkie Hub (route `/admin/linkie`) — the link-in-bio profile: its posts, the
 * published pages pushed onto it, and what the traffic looks like.
 *
 * Three tabs by duty (#577, components/admin/linkie):
 *
 *   Links      the posts on the profile, written here or pushed from a live page
 *   Analytics  the traffic Linkie reports, read-only
 *   Settings   whether the key works, and where the rest is set
 *
 * The third tab was "Connection". The Newsletter Hub standard puts a provider's
 * connection test on Settings — an operator opens it when something is wrong,
 * not while composing — so it moved, and `?tab=connection` lands there
 * (linkie/tabs.js).
 *
 * `?profile=` selects which profile the tabs are scoped to and survives a tab
 * change: every posts and analytics path is profile-scoped, so a link that
 * names a tab without its profile would land on someone else's posts.
 *
 * The profile probe is page-level because it is not a readiness check that
 * happens to resolve the profile — it IS the resolve, and both working tabs
 * need its answer (useLinkie).
 */
import React from 'react';
import { useSearchParams } from 'react-router';
import { Link2 } from 'lucide-react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Label } from '@/components/ui/label';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import HubTabs from '@/components/admin/HubTabs';
import LinksTab from '@/components/admin/linkie/LinksTab';
import AnalyticsTab from '@/components/admin/linkie/AnalyticsTab';
import SettingsTab from '@/components/admin/linkie/SettingsTab';
import useLinkie from '@/components/admin/linkie/useLinkie';
import { TABS, resolveTab } from '@/components/admin/linkie/tabs';
import { profileLabel, selectProfile } from '@/lib/linkie';

/**
 * Each tab's panel, by id. With TABS in linkie/tabs.js this is the whole of
 * adding a tab: every panel receives the same hub state.
 */
const PANELS = {
  links: LinksTab,
  analytics: AnalyticsTab,
  settings: SettingsTab,
};

/** The profile picker, shown only when the key owns more than one. */
function ProfilePicker({ profiles, profileId, onSelect }) {
  if (profiles.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-xs" htmlFor="linkie-profile">
        Profile
      </Label>
      <select
        id="linkie-profile"
        value={profileId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {profiles.map((profile) => (
          <option key={profile._id} value={profile._id}>
            {profileLabel(profile)}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        Posts and analytics are scoped to this profile.
      </span>
    </div>
  );
}

export default function LinkiePage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const preferredProfileId = searchParams.get('profile') || '';
  const hub = useLinkie(authReady);

  // `profile` is carried through every navigation: dropping it on a tab change
  // would silently move the operator to whichever profile sorts first.
  const updateParams = (patch) => {
    const next = { tab: activeTab };
    if (preferredProfileId) next.profile = preferredProfileId;
    setSearchParams({ ...next, ...patch });
  };

  const selectedProfile = selectProfile(hub.profiles, preferredProfileId);
  const profileId = selectedProfile?._id || null;
  const ActivePanel = PANELS[activeTab];

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Link2}
        title="Linkie Hub"
        service="Linkie"
        connected={hub.connected}
        description="Manage your Linkie posts, push published content, and review link analytics."
        accent="emerald"
      />

      <ProfilePicker
        profiles={hub.profiles}
        profileId={profileId}
        onSelect={(profile) => updateParams({ profile })}
      />

      <HubTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => updateParams({ tab: id })}
        idPrefix="linkie"
        label="Linkie Hub"
      >
        <ActivePanel
          recentContent={hub.recentContent}
          profileId={profileId}
          profileNotice={hub.profileNotice}
          onStatusChange={hub.onConnectionTested}
        />
      </HubTabs>
    </div>
  );
}
