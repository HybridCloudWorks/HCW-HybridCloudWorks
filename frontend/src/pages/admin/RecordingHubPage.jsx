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
import React, { useCallback, useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import { Button } from '@/components/ui/button';
import { Mic, Radio, RefreshCw } from 'lucide-react';
import { getJSON } from '@/lib/api';
import PodcastTab from '@/components/admin/recording-hub/PodcastTab';
import PlaudTab from '@/components/admin/recording-hub/PlaudTab';

const TABS = [
  { id: 'podcast', label: 'Podcast', icon: Mic },
  { id: 'plaud', label: 'Plaud', icon: Radio },
];

/**
 * The Plaud connection as the page knows it. `unknown` is a check that
 * could not run (a thrown read) — not `disconnected`, which is a check that
 * ran and said so. Conflating the two pinned the tab to "not connected" for
 * a whole session when the first read raced the sign-in.
 */
const CONNECTION = Object.freeze({
  checking: 'checking',
  connected: 'connected',
  disconnected: 'disconnected',
  unknown: 'unknown',
});

export default function RecordingHubPage() {
  const { authReady } = useAuthReady();
  const [activeTab, setActiveTab] = useState('podcast');
  const [connection, setConnection] = useState(CONNECTION.checking);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);
  const [checkNonce, setCheckNonce] = useState(0);

  // Check the Plaud connection once auth has resolved, and again whenever
  // readiness flips or the owner asks: a read fired before the token exists
  // throws, and that throw must read as "unknown", not "disconnected".
  const recheck = useCallback(() => setCheckNonce((n) => n + 1), []);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // If the Plaud MCP server doc reports connected and a stored token
        // (the API returns hasOauthToken; the value itself is write-only).
        const res = await getJSON('cms/config/mcp-servers');
        if (cancelled) return;
        const plaud = (res.items || []).find((d) => d.id === 'plaud');
        const ok = plaud?.status === 'connected' && plaud?.hasOauthToken === true;
        setConnection(ok ? CONNECTION.connected : CONNECTION.disconnected);
        setHasRefreshToken(plaud?.hasOauthRefreshToken === true);
      } catch {
        if (!cancelled) setConnection(CONNECTION.unknown);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authReady, checkNonce]);

  const isConnected = connection === CONNECTION.connected;
  const checkingConn = connection === CONNECTION.checking;
  const headerState =
    isConnected || (checkingConn || connection === CONNECTION.unknown ? connection : false);

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Radio}
        title="Recording Hub"
        service="Plaud"
        connected={headerState}
        description="Review the podcast transcripts generated from articles and recordings, and browse, transcribe and script your Plaud recordings."
        accent="violet"
      />

      {connection === CONNECTION.unknown && (
        <p
          role="status"
          className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 flex-wrap"
        >
          Could not check the Plaud connection; the Library may still work.
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={recheck}>
            <RefreshCw className="h-3 w-3 mr-1" /> Check again
          </Button>
        </p>
      )}

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
            {id === 'plaud' && connection === CONNECTION.disconnected && (
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
            setConnection(CONNECTION.connected);
            if (refreshSupplied) setHasRefreshToken(true);
          }}
        />
      )}
    </div>
  );
}
