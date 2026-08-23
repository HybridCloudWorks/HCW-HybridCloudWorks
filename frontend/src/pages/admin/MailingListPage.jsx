/**
 * Mailing List — Klaviyo integration.
 *
 * All Klaviyo API calls route through the `klaviyoProxy` Cloud Function
 * (KLAVIYO_PRIVATE_KEY lives in Secret Manager — never in the client bundle).
 * Public signups happen through the separate rate-limited `newsletterSubscribe`
 * function consumed by <NewsletterSignup />.
 *
 * Required Cloud Function secrets (set via `firebase functions:secrets:set`):
 *   KLAVIYO_PRIVATE_KEY — Klaviyo private API key
 *   KLAVIYO_LIST_ID     — default newsletter list ID (used by newsletterSubscribe)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import {
  Mail,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Users,
  Megaphone,
  Eye,
  PenTool,
} from 'lucide-react';
import { postJSON } from '@/lib/api';
import { runJob } from '@/lib/jobs';

const TABS = [
  { id: 'lists', label: 'Subscribers / Lists' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'connection', label: 'Connection' },
];

// ── Klaviyo proxy wrappers ────────────────────────────────────────────────────

const klaviyoFetch = (path, method = 'GET', body) =>
  postJSON('klaviyoProxy', { path, method, body });

const kListLists = () => klaviyoFetch('/api/lists/');
const kListProfiles = (pageSize = 50) =>
  klaviyoFetch(`/api/profiles/?page[size]=${pageSize}&sort=-created`);
const kListCampaigns = () =>
  klaviyoFetch(`/api/campaigns/?filter=${encodeURIComponent("equals(messages.channel,'email')")}`);

// ── Weekly digest (a platform job, T-322) ───────────────────────────────────
// Site-Main called generateWeeklyDigest over HTTP with a 20 s client abort the
// 300 s handler never met. Here the drafting runs as the
// `generate-weekly-digest` job and the page polls; dryRun returns the preview
// without saving to `newsletters`.
const runWeeklyDigest = async (dryRun) => {
  const job = await runJob('generate-weekly-digest', { dryRun, days: 7 });
  if (job.status !== 'succeeded') {
    throw new Error(job.error || `Digest ${job.status}`);
  }
  return job.result || {};
};

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function LoadState({ loading, error, onRetry, children }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return children;
}

// ── Subscribers / Lists Tab ───────────────────────────────────────────────────

function ListsTab() {
  const [lists, setLists] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listsRes, profilesRes] = await Promise.all([kListLists(), kListProfiles()]);
      setLists(Array.isArray(listsRes?.data) ? listsRes.data : []);
      setProfiles(Array.isArray(profilesRes?.data) ? profilesRes.data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      load();
    });
  }, [load]);

  return (
    <LoadState loading={loading} error={error} onRetry={load}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Lists
            {lists.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {lists.length}
              </Badge>
            )}
          </h3>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 h-7">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lists found in Klaviyo.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {lists.map((list) => (
              <Card key={list.id} className="p-4">
                <p className="text-sm font-medium">{list.attributes?.name || list.id}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  ID: <code>{list.id}</code> · Created {fmtDate(list.attributes?.created)}
                </p>
              </Card>
            ))}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-3">
            Recent Subscribers
            {profiles.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {profiles.length}
              </Badge>
            )}
          </h3>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles found.</p>
          ) : (
            <div className="space-y-1.5">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border text-sm"
                >
                  <span className="flex-1 min-w-0 truncate font-medium">
                    {p.attributes?.email || '—'}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {fmtDate(p.attributes?.created)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LoadState>
  );
}

// ── Campaigns Tab (read-only) ─────────────────────────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [digestNotice, setDigestNotice] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await kListCampaigns();
      setCampaigns(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDraftWeeklyDigest = async () => {
    setDrafting(true);
    setDigestNotice(null);
    try {
      const res = await runWeeklyDigest(false);
      setDigestNotice({
        ok: res.success === true,
        message: res.success
          ? `Weekly digest drafted from ${res.sourceItemsCount} item(s). Draft id: ${res.draftId}`
          : res.message || 'No action taken.',
      });
    } catch (err) {
      setDigestNotice({ ok: false, message: err.message });
    } finally {
      setDrafting(false);
    }
  };

  const handlePreviewDigest = async () => {
    setPreviewing(true);
    setDigestNotice(null);
    try {
      const res = await runWeeklyDigest(true);
      if (res.success) {
        setPreview(res);
      } else {
        setDigestNotice({ ok: false, message: res.message || 'No content to preview.' });
      }
    } catch (err) {
      setDigestNotice({ ok: false, message: err.message });
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      load();
    });
  }, [load]);

  return (
    <LoadState loading={loading} error={error} onRetry={load}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Megaphone className="h-4 w-4" /> Email Campaigns (read-only)
          </h3>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviewDigest}
              disabled={previewing || drafting}
              className="gap-1.5 h-7"
            >
              {previewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              Preview Digest
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDraftWeeklyDigest}
              disabled={drafting || previewing}
              className="gap-1.5 h-7"
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenTool className="h-3.5 w-3.5" />
              )}
              Draft Weekly Digest
            </Button>
            <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 h-7">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
        {digestNotice && (
          <p
            className={`text-sm flex items-center gap-2 ${digestNotice.ok ? 'text-emerald-600' : 'text-destructive'}`}
          >
            {digestNotice.ok ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {digestNotice.message}
          </p>
        )}
        {preview && (
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{preview.title}</p>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Preview only, nothing saved. {preview.sourceItemsCount} source item(s).
            </p>
            <pre className="text-xs whitespace-pre-wrap max-h-96 overflow-auto rounded-md bg-muted p-3">
              {preview.content}
            </pre>
          </Card>
        )}
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No campaigns found. Create campaigns in Klaviyo.
          </p>
        ) : (
          campaigns.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.attributes?.name || c.id}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fmtDate(c.attributes?.created_at || c.attributes?.created)} ·{' '}
                    {c.attributes?.send_strategy?.method || ''}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize text-[10px] shrink-0">
                  {c.attributes?.status || 'unknown'}
                </Badge>
              </div>
            </Card>
          ))
        )}
      </div>
    </LoadState>
  );
}

// ── Connection Tab ────────────────────────────────────────────────────────────

function ConnectionTab({ onStatusChange }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await kListLists();
      const count = Array.isArray(res?.data) ? res.data.length : 0;
      setResult({ ok: true, message: `Connected to Klaviyo — ${count} list(s) visible.` });
      onStatusChange?.(true);
    } catch (err) {
      setResult({ ok: false, message: err.message });
      onStatusChange?.(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Klaviyo API Connection</CardTitle>
          <CardDescription>
            KLAVIYO_PRIVATE_KEY and KLAVIYO_LIST_ID are stored in Google Secret Manager and used
            server-side by the klaviyoProxy / newsletterSubscribe Cloud Functions — they are never
            sent to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleTest} disabled={testing} className="gap-2">
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Test Connection
          </Button>
          {result && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                result.ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <p>{result.message}</p>
            </div>
          )}
          <a
            href="https://www.klaviyo.com/settings/account/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Manage API Keys in Klaviyo <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MailingListPage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'lists';
  const [connected, setConnected] = useState('checking');

  useEffect(() => {
    if (!authReady) return;
    kListLists()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, [authReady]);

  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Mail}
        title="Mailing List"
        service="Klaviyo"
        connected={connected}
        description="Newsletter subscribers, lists, and campaigns powered by Klaviyo."
        accent="violet"
      />

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'lists' && <ListsTab />}
        {activeTab === 'campaigns' && <CampaignsTab />}
        {activeTab === 'connection' && <ConnectionTab onStatusChange={setConnected} />}
      </div>
    </div>
  );
}
