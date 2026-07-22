/**
 * Linkie Hub - manage Linkie links, view analytics, push published content.
 *
 * All Linkie API calls route through the `linkieProxy` Cloud Function
 * (LINKIE_API_KEY lives in Secret Manager - never in the client bundle).
 * Mirrors the SocialHubPage integration pattern.
 *
 * Required Cloud Function secret (set via `firebase functions:secrets:set`):
 *   LINKIE_API_KEY - Linkie Admin API key
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import {
  Link2,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  ExternalLink,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  BarChart3,
  Send,
} from 'lucide-react';
import { postJSON } from '@/lib/api';
import { db } from '@/lib/firebaseConfig';
import { collection, query, limit, getDocs } from 'firebase/firestore';

const TABS = [
  { id: 'links', label: 'Links' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'connection', label: 'Connection' },
];

// ── Linkie proxy wrappers ─────────────────────────────────────────────────────

const linkieFetch = (path, method = 'GET', body) =>
  postJSON('linkieProxy', { path, method, body });

const ltGetProfile = () => linkieFetch('/profiles');
const ltListLinks = () => linkieFetch('/links');
const ltCreateLink = (link) => linkieFetch('/links', 'POST', link);
const ltUpdateLink = (id, updates) => linkieFetch(`/links/${id}`, 'PUT', updates);
const ltDeleteLink = (id) => linkieFetch(`/links/${id}`, 'DELETE');
const ltGetAnalytics = () => linkieFetch('/analytics');

function extractLinks(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.links)) return res.links;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

// ── Published content helpers (same rule as SocialHubPage) ───────────────────

function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

function getLiveUrl(item) {
  return (
    item.slugPageUrl ||
    item.publishedUrl ||
    item.blogUrl ||
    item.publicUrl ||
    (item.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(item.curatedSubpagePath).startsWith('/') ? item.curatedSubpagePath : `/${item.curatedSubpagePath}`}`
      : '')
  );
}

// ── Links Tab ─────────────────────────────────────────────────────────────────

const EMPTY_LINK_FORM = { title: '', url: '' };

function LinksTab({ recentContent }) {
  const { toast } = useToast();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null); // link id (or 'new') currently saving
  const [form, setForm] = useState(EMPTY_LINK_FORM);
  const [editingId, setEditingId] = useState(null);
  const [pushingId, setPushingId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await ltListLinks();
      setLinks(extractLinks(res));
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

  const handleSubmit = async () => {
    const title = form.title.trim();
    const url = form.url.trim();
    if (!title || !url) {
      toast({ title: 'Title and URL are required', variant: 'destructive' });
      return;
    }
    setBusyId(editingId || 'new');
    try {
      if (editingId) {
        await ltUpdateLink(editingId, { title, url });
        toast({ title: 'Link updated' });
      } else {
        await ltCreateLink({ title, url });
        toast({ title: 'Link added to Linkie' });
      }
      setForm(EMPTY_LINK_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      await ltDeleteLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      toast({ title: 'Link deleted' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (link) => {
    const isHidden = link.disabled === true || link.visible === false;
    setBusyId(link.id);
    try {
      await ltUpdateLink(link.id, { disabled: !isHidden });
      setLinks((prev) =>
        prev.map((l) => (l.id === link.id ? { ...l, disabled: !isHidden } : l))
      );
    } catch (err) {
      toast({ title: 'Toggle failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const link = links[index];
    setBusyId(link.id);
    try {
      await ltUpdateLink(link.id, { position: target });
      const next = [...links];
      [next[index], next[target]] = [next[target], next[index]];
      setLinks(next);
    } catch (err) {
      toast({ title: 'Reorder failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handlePushContent = async (item) => {
    const url = getLiveUrl(item);
    const title = item.Title || item.title || 'Untitled';
    if (!url) {
      toast({ title: 'No public URL for this item', variant: 'destructive' });
      return;
    }
    setPushingId(item.id);
    try {
      await ltCreateLink({ title, url });
      toast({ title: 'Pushed to Linkie', description: title });
      await load();
    } catch (err) {
      toast({ title: 'Push failed', description: err.message, variant: 'destructive' });
    } finally {
      setPushingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: link list + add/edit form */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? 'Edit Link' : 'Add a Link'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="My latest article"
              />
            </div>
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://hybridcloudworks.com/…"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmit} disabled={busyId !== null} className="gap-1.5">
                {busyId === (editingId || 'new') ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {editingId ? 'Save Changes' : 'Add Link'}
              </Button>
              {editingId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY_LINK_FORM);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Current Links
            {links.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {links.length}
              </Badge>
            )}
          </h3>
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 h-7">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error} — check the Connection tab.</span>
          </div>
        )}
        {!loading && !error && links.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">No links yet.</p>
        )}

        {links.map((link, index) => {
          const isHidden = link.disabled === true || link.visible === false;
          const isBusy = busyId === link.id;
          return (
            <Card key={link.id || index} className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={isBusy || index === 0}
                    onClick={() => handleMove(index, -1)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={isBusy || index === links.length - 1}
                    onClick={() => handleMove(index, 1)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isHidden ? 'opacity-50' : ''}`}>
                    {link.title || 'Untitled'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isHidden && (
                    <Badge variant="outline" className="text-[10px]">
                      Hidden
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isBusy}
                    title={isHidden ? 'Show link' : 'Hide link'}
                    onClick={() => handleToggle(link)}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isBusy}
                    title="Edit"
                    onClick={() => {
                      setEditingId(link.id);
                      setForm({ title: link.title || '', url: link.url || '' });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    disabled={isBusy}
                    title="Delete"
                    onClick={() => handleDelete(link.id)}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Right: push published content to Linkie */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Push Published Content</h3>
        <p className="text-xs text-muted-foreground">
          Add the public URL of a recently published page as a Linkie link.
        </p>
        {recentContent.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No published content found.
          </p>
        )}
        <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
          {recentContent.map((item) => {
            const title = item.Title || item.title || 'Untitled';
            const url = getLiveUrl(item);
            const alreadyLinked = links.some((l) => l.url === url);
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <p className="text-xs text-muted-foreground truncate">{url || 'No public URL'}</p>
                </div>
                {url && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={alreadyLinked ? 'outline' : 'default'}
                  className="gap-1.5 shrink-0"
                  disabled={!url || alreadyLinked || pushingId === item.id}
                  onClick={() => handlePushContent(item)}
                >
                  {pushingId === item.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {pushingId !== item.id && alreadyLinked && (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  {pushingId !== item.id && !alreadyLinked && <Send className="h-3.5 w-3.5" />}
                  {alreadyLinked ? 'Linked' : 'Push'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await ltGetAnalytics();
      setAnalytics(res || {});
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
        <Button variant="outline" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const summary = analytics?.data || analytics || {};
  const stats = [
    { label: 'Views', value: summary.views ?? summary.totalViews },
    { label: 'Clicks', value: summary.clicks ?? summary.totalClicks },
    { label: 'CTR', value: summary.ctr ?? summary.clickThroughRate },
    { label: 'Unique Visitors', value: summary.uniqueViews ?? summary.uniqueVisitors },
  ].filter((s) => s.value !== undefined && s.value !== null);

  return (
    <div className="space-y-4 max-w-3xl">
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map(({ label, value }) => (
            <Card key={label} className="p-4 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <BarChart3 className="h-6 w-6 mx-auto mb-2 opacity-60" />
          Analytics connected, but no summary metrics were returned.
        </Card>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw analytics response</summary>
        <pre className="mt-2 p-3 rounded-lg bg-muted overflow-auto max-h-80">
          {JSON.stringify(analytics, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ── Connection Tab ────────────────────────────────────────────────────────────

function ConnectionTab({ onStatusChange }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, profile? }

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const profile = await ltGetProfile();
      setResult({ ok: true, message: 'Connected to the Linkie API.', profile });
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
          <CardTitle className="text-base">Linkie API Connection</CardTitle>
          <CardDescription>
            The LINKIE_API_KEY is stored in Google Secret Manager and used server-side by the
            linkieProxy Cloud Function - it is never sent to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleTest} disabled={testing} className="gap-2">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
              <div className="min-w-0">
                <p>{result.message}</p>
                {result.ok && result.profile && (
                  <pre className="mt-2 text-xs text-muted-foreground overflow-auto max-h-40">
                    {JSON.stringify(result.profile, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
          <a
            href="https://linkie.bio/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Manage your Linkie <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LinkiePage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'links';
  const [connected, setConnected] = useState('checking');

  const [recentContent, setRecentContent] = useState([]);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    getDocs(query(collection(db, 'content'), limit(500)))
      .then((snap) => {
        if (cancelled) return;
        const live = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(isLiveRecord)
          .filter((item) => getLiveUrl(item));
        setRecentContent(live.slice(0, 50));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  // Lightweight readiness probe — function resolves the secret server-side.
  useEffect(() => {
    if (!authReady) return;
    ltGetProfile()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, [authReady]);

  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Link2}
        title="Linkie Hub"
        service="Linkie"
        connected={connected}
        description="Manage your Linkie links, push published content, and review link analytics."
        accent="emerald"
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
        {activeTab === 'links' && <LinksTab recentContent={recentContent} />}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'connection' && <ConnectionTab onStatusChange={setConnected} />}
      </div>
    </div>
  );
}
