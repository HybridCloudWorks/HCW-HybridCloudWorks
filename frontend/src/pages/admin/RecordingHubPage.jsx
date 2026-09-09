/**
 * Recording Hub — one page, two tabs (#442, part of #432).
 *
 *   Podcast  — the transcripts the podcast pipeline produced from published
 *              articles (#435) and from recordings (#434), with review,
 *              the host record (#437) and the show's episodes.
 *   Plaud    — everything /admin/recordings used to do (Library, Upload,
 *              Connect), plus "Script this" on every recording and audio
 *              upload for Plaud Embedded to transcribe.
 *
 * /admin/recordings redirects here. The Plaud MCP token rules and the
 * CLIENT_USER_AUTH_REVOKED remedy live in the Plaud tab's header
 * (components/admin/recording-hub/PlaudTab.jsx), where the Connect sub-tab
 * that applies them is.
 */
import React, { useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import { Mic, Radio } from 'lucide-react';
import { getJSON } from '@/lib/api';
import PodcastTab from '@/components/admin/recording-hub/PodcastTab';
import PlaudTab from '@/components/admin/recording-hub/PlaudTab';

const TABS = [
  { id: 'podcast', label: 'Podcast', icon: Mic },
  { id: 'plaud', label: 'Plaud', icon: Radio },
];

export default function RecordingHubPage() {
  useAuthReady();
  const [activeTab, setActiveTab] = useState('podcast');
  const [isConnected, setIsConnected] = useState(false);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);
  const [checkingConn, setCheckingConn] = useState(true);

  // Check Plaud connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // If the Plaud MCP server doc reports connected and a stored token
        // (the API returns hasOauthToken; the value itself is write-only).
        const res = await getJSON('cms/config/mcp-servers');
        const plaud = (res.items || []).find((d) => d.id === 'plaud');
        setIsConnected(plaud?.status === 'connected' && plaud?.hasOauthToken === true);
        setHasRefreshToken(plaud?.hasOauthRefreshToken === true);
      } catch {
        setIsConnected(false);
        setHasRefreshToken(false);
      } finally {
        setCheckingConn(false);
      }
    };
    checkConnection();
  }, []);

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Radio}
        title="Recording Hub"
        service="Plaud"
        connected={checkingConn ? 'checking' : isConnected}
        description="Review the podcast transcripts generated from articles and recordings, and browse, transcribe and script your Plaud recordings."
        accent="violet"
      />

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === 'plaud' && !isConnected && !checkingConn && (
              <span className="w-2 h-2 rounded-full bg-amber-400 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'podcast' && <PodcastTab />}
      {activeTab === 'plaud' && (
        <PlaudTab
          isConnected={isConnected}
          hasRefreshToken={hasRefreshToken}
          checkingConn={checkingConn}
          onConnected={({ refreshSupplied } = {}) => {
            setIsConnected(true);
            if (refreshSupplied) setHasRefreshToken(true);
          }}
        />
      )}
    </div>
  );
}
