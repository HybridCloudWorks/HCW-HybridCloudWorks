/**
 * Recordings — Plaud MCP Integration
 *
 * Plaud now has a real MCP server at https://mcp.plaud.ai/mcp (Streamable HTTP, OAuth).
 * This page connects live to your Plaud library via the AI Engine's mcpProxy
 * Azure Function — no manual exports needed.
 *
 * Three tabs:
 *   1. Library       — live recordings from Plaud MCP: list_files → get_transcript
 *   2. Upload        — manual transcript paste/upload as fallback
 *   3. Connect       — OAuth token setup for Plaud MCP
 *
 * Auth flow:
 *   • User runs `npx -y @plaud-ai/mcp@latest install` or connects via Claude Web
 *   • Copies the resulting OAuth access token
 *   • Pastes it in the Connect tab → stored in Cosmos DB (server-side only)
 *   • mcpProxy uses the token; it never reaches the browser after saving
 *
 * Cosmos DB containers:
 *   recordings  — local copies routed into ContentForge pipeline
 *   mcp_servers/plaud — stores oauthToken (admin-write only)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import {
  Radio,
  Upload,
  Sparkles,
  Loader2,
  CheckCircle,
  ExternalLink,
  Search,
  Clock,
  Zap,
  RefreshCw,
  Mic,
  AlertCircle,
  Link,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  CalendarDays,
} from 'lucide-react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import { aiEngine, setMcpOAuthToken } from '@/lib/aiEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'library', label: 'Library', icon: Radio },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'connect', label: 'Connect', icon: Link },
];

function fmtDuration(ms) {
  if (!ms) return '';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function fmtDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TranscriptToggleIcon({ loading, expanded }) {
  if (loading) return <Loader2 className="h-3 w-3 animate-spin" />;
  if (expanded) return <ChevronDown className="h-3 w-3" />;
  return <ChevronRight className="h-3 w-3" />;
}

// ─── Recording Card ───────────────────────────────────────────────────────────

function PlaudRecordingCard({ recording, onCreateContent }) {
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [note, setNote] = useState(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);
  const [routing, setRouting] = useState(false);
  const { toast } = useToast();

  const fetchTranscript = async () => {
    if (transcript) {
      setExpanded((p) => !p);
      return;
    }
    setLoadingTx(true);
    setExpanded(true);
    try {
      const res = await aiEngine.mcpTool('plaud', 'get_transcript', { file_id: recording.id });
      if (res.ok) {
        setTranscript(res.result);
      } else {
        toast({
          title: 'Could not load transcript',
          description: res.error,
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingTx(false);
    }
  };

  const fetchNote = async () => {
    if (note) return;
    setLoadingNote(true);
    try {
      const res = await aiEngine.mcpTool('plaud', 'get_note', { file_id: recording.id });
      if (res.ok) setNote(res.result);
    } catch {
      /* silent */
    } finally {
      setLoadingNote(false);
    }
  };

  const handleCreateContent = async () => {
    setRouting(true);
    try {
      // Ensure we have the transcript first
      let tx = transcript;
      if (!tx) {
        const res = await aiEngine.mcpTool('plaud', 'get_transcript', { file_id: recording.id });
        if (!res.ok) throw new Error(res.error);
        tx = res.result;
        setTranscript(tx);
      }
      // Save to the recordings container then route to pipeline
      // (the server stamps createdAt).
      const created = await postJSON('cms/recordings', {
        title: recording.name,
        transcript: tx,
        duration: recording.duration,
        recordedAt: recording.start_at || recording.created_at,
        source: 'plaud_mcp',
        plaudId: recording.id,
        status: 'new',
      });
      onCreateContent({ id: created.id, title: recording.name, transcript: tx });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setRouting(false);
    }
  };

  return (
    <Card className="transition-all hover:shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 p-2 mt-0.5 shrink-0">
            <Mic className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {recording.name || 'Untitled Recording'}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {recording.start_at && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <CalendarDays className="h-3 w-3" />
                  {fmtDate(recording.start_at || recording.created_at)}
                </span>
              )}
              {recording.duration > 0 && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="h-3 w-3" />
                  {fmtDuration(recording.duration)}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2"
              onClick={fetchTranscript}
              disabled={loadingTx}
            >
              <TranscriptToggleIcon loading={loadingTx} expanded={expanded} />
              Transcript
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs px-2 bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleCreateContent}
              disabled={routing}
            >
              {routing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Zap className="h-3 w-3 mr-1" />
              )}
              Create Content
            </Button>
          </div>
        </div>

        {/* AI Note preview (loads in background) */}
        {expanded && !note && !loadingNote && transcript && (
          <button className="text-xs text-indigo-500 mt-2 hover:underline" onClick={fetchNote}>
            Load AI summary & action items →
          </button>
        )}
        {loadingNote && <p className="text-xs text-slate-400 mt-2">Loading AI notes…</p>}
        {note && (
          <div className="mt-3 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded text-xs leading-relaxed text-slate-700 dark:text-slate-300 max-h-36 overflow-y-auto">
            <strong className="block text-indigo-700 dark:text-indigo-400 mb-1">AI Notes</strong>
            <pre className="whitespace-pre-wrap font-sans">{note}</pre>
          </div>
        )}

        {/* Transcript */}
        {expanded && (
          <div className="mt-3">
            {loadingTx && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading transcript…
              </div>
            )}
            {transcript && (
              <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-mono border">
                {transcript}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Route to Pipeline Modal ──────────────────────────────────────────────────

function RouteModal({ recording, onClose, onRouted }) {
  const [contentType, setContentType] = useState('blog_post');
  const [routing, setRouting] = useState(false);
  const { toast } = useToast();

  const CONTENT_TYPES = [
    { value: 'blog_post', label: 'Blog Post' },
    { value: 'technical_guide', label: 'Technical Guide' },
    { value: 'linkedin_post', label: 'LinkedIn Post' },
    { value: 'podcast_notes', label: 'Podcast Show Notes' },
    { value: 'meeting_summary', label: 'Meeting Summary' },
  ];

  const handleRoute = async () => {
    setRouting(true);
    try {
      const result = await postJSON('createContentFromRecording', {
        recordingId: recording.id,
        transcript: recording.transcript,
        title: recording.title,
        contentType,
        provider: 'gemini',
      });
      if (result?.contentId) {
        await sendJSON(`cms/recordings/${recording.id}`, 'PATCH', {
          status: 'routed',
          contentId: result.contentId,
        });
        toast({ title: 'Sent to pipeline ✓', description: `Content ID: ${result.contentId}` });
        onRouted(result.contentId);
      } else {
        throw new Error(result?.error || 'No contentId returned');
      }
    } catch (err) {
      toast({ title: 'Error routing recording', description: err.message, variant: 'destructive' });
    } finally {
      setRouting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose();
      }}
      aria-label="Close route modal"
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-base">Route to ContentForge Pipeline</CardTitle>
          <CardDescription className="text-xs">
            {recording.title ? `“${recording.title}”` : 'Untitled recording'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Content Type</Label>
            <select
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">
            Gemini (Google AI) will summarize and structure the transcript into a new draft.
            You&apos;ll review it in the Editor.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleRoute} disabled={routing}>
              {routing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Sparkles className="h-4 w-4 mr-2" />
              Create Draft
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Library Tab (Live Plaud MCP) ─────────────────────────────────────────────

function LibraryTab({ isConnected }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [routingRec, setRoutingRec] = useState(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const args = {};
      if (search) args.query = search;
      if (dateFrom) args.date_from = dateFrom;
      if (dateTo) args.date_to = dateTo;
      if (!search && !dateFrom && !dateTo) {
        args.page = page;
        args.page_size = 20;
      }

      const res = await aiEngine.mcpTool('plaud', 'list_files', args);
      if (res.ok) {
        // list_files returns JSON text; parse it
        let files = [];
        try {
          const parsed = JSON.parse(res.result);
          files = Array.isArray(parsed)
            ? parsed
            : parsed?.data || parsed?.files || parsed?.recordings || parsed?.items || [];
        } catch {
          files = [];
        }
        setRecordings(files);
      } else if (res.code === 'UNAUTHENTICATED') {
        toast({
          title: 'Not connected',
          description: 'Add your Plaud OAuth token in the Connect tab.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Could not load recordings',
          description: res.error,
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [search, dateFrom, dateTo, page, toast]);

  useEffect(() => {
    if (!isConnected) return undefined;
    const timer = setTimeout(() => {
      fetchRecordings();
    }, 0);
    return () => clearTimeout(timer);
  }, [isConnected, fetchRecordings]);

  if (!isConnected) {
    return (
      <div className="text-center py-16 space-y-3">
        <Link className="h-10 w-10 text-slate-300 mx-auto" />
        <p className="text-sm text-slate-500">Connect your Plaud account first.</p>
        <p className="text-xs text-slate-400">
          Go to the <strong>Connect</strong> tab and paste your OAuth token.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-40">
          <Label className="text-xs">Search recordings</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Keyword…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-8 text-xs mt-1 w-36"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="h-8 text-xs mt-1 w-36"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={fetchRecordings}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && recordings.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-400">
          No recordings found. Try adjusting your filters or check your Plaud app.
        </div>
      )}

      {!loading && recordings.length > 0 && (
        <div className="space-y-2">
          {recordings.map((r) => (
            <PlaudRecordingCard
              key={r.id}
              recording={r}
              onCreateContent={(rec) => setRoutingRec(rec)}
            />
          ))}
        </div>
      )}

      {/* Pagination — only when no filters */}
      {!search && !dateFrom && !dateTo && recordings.length === 20 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs self-center text-slate-500">Page {page}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {routingRec && (
        <RouteModal
          recording={routingRec}
          onClose={() => setRoutingRec(null)}
          onRouted={(contentId) => {
            setRoutingRec(null);
            navigate(`/admin/editor?id=${contentId}`);
          }}
        />
      )}
    </div>
  );
}

// ─── Upload Tab (manual fallback) ────────────────────────────────────────────

function UploadTab() {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTitle((t) => t || file.name.replace(/\.(txt|md)$/i, ''));
    const reader = new FileReader();
    reader.onload = (evt) => setTranscript(evt.target.result || '');
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!title || !transcript) {
      toast({ title: 'Title and transcript are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await postJSON('cms/recordings', {
        title,
        transcript,
        source: 'manual_upload',
        status: 'new',
      });
      setSaved(true);
      setTitle('');
      setTranscript('');
      toast({ title: 'Recording saved ✓', description: 'Find it in the Library tab.' });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast({ title: 'Error saving', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300 flex gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        This tab is a manual fallback. If you&apos;ve connected Plaud via the Connect tab, use the
        Library tab for live access to all your recordings instead.
      </div>

      <div>
        <Label className="text-xs">Recording Title</Label>
        <Input
          className="mt-1 h-9"
          placeholder="Weekly Team Standup — May 25"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs">Transcript</Label>
        <div className="mt-1 flex gap-2">
          <Textarea
            className="text-xs font-mono leading-relaxed"
            rows={12}
            placeholder="Paste your transcript here, or use the button to upload a .txt / .md file…"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" /> Upload .txt / .md
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button onClick={handleSave} disabled={saving || saved}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          {saved ? 'Saved!' : 'Save Recording'}
        </Button>
      </div>
    </div>
  );
}

// ─── Connect Tab (OAuth setup) ────────────────────────────────────────────────

function ConnectTab({ isConnected, onConnected }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!token.trim()) return;
    setSaving(true);
    try {
      await setMcpOAuthToken('plaud', token.trim());
      toast({ title: 'Token saved ✓', description: 'Testing connection…' });
      setToken('');
      // Test immediately
      setTesting(true);
      await aiEngine.testProvider('plaud').catch(() => null);
      // testProvider works for AI providers; for MCP, use syncMcpTools
      const sync = await aiEngine.syncMcpTools('plaud');
      if (sync.ok) {
        toast({
          title: 'Connected to Plaud ✓',
          description: `${sync.tools?.length || 0} tools available`,
        });
        onConnected();
      } else {
        toast({
          title: 'Token saved but test failed',
          description: sync.error,
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const handleRetest = async () => {
    setTesting(true);
    const sync = await aiEngine.syncMcpTools('plaud');
    if (sync.ok) {
      toast({ title: 'Still connected ✓', description: `${sync.tools?.length || 0} tools` });
      onConnected();
    } else {
      toast({ title: 'Connection failed', description: sync.error, variant: 'destructive' });
    }
    setTesting(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Status banner */}
      <div
        className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
          isConnected
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
            : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'
        }`}
      >
        {isConnected ? (
          <>
            <CheckCircle className="h-5 w-5 shrink-0" />{' '}
            <span>
              <strong>Connected</strong> — your Plaud recordings are live in the Library tab.
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-5 w-5 shrink-0" />{' '}
            <span>
              <strong>Not connected</strong> — follow the steps below to authorize.
            </span>
          </>
        )}
        {isConnected && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs"
            onClick={handleRetest}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>

      {/* Step-by-step setup */}
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">How to connect</h3>

        <div className="space-y-3 text-sm">
          {[
            {
              n: 1,
              title: 'Install the Plaud MCP CLI',
              body: (
                <div className="mt-1 font-mono text-xs bg-slate-900 text-slate-100 rounded p-2 select-all">
                  npx -y @plaud-ai/mcp@latest install
                </div>
              ),
              note: 'Requires Node.js ≥ 20. Detects local AI clients and writes MCP config automatically.',
            },
            {
              n: 2,
              title: 'Authorize in your browser',
              body: (
                <p className="text-xs text-slate-500 mt-1">
                  The installer opens a browser tab. Click <strong>Authorize</strong> to grant
                  access to your Plaud library.
                </p>
              ),
            },
            {
              n: 3,
              title: 'Copy your access token',
              body: (
                <p className="text-xs text-slate-500 mt-1">
                  Your token is saved to{' '}
                  <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
                    ~/.plaud/tokens-mcp.json
                  </code>
                  . Open that file and copy the <code>access_token</code> value.
                  <br />
                  <br />
                  Alternatively, use <strong>Claude Web</strong>: open the Plaud connector at{' '}
                  <a
                    href="https://claude.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 underline"
                  >
                    claude.ai
                  </a>{' '}
                  → Settings → Connectors → Add custom connector → URL:{' '}
                  <code>https://mcp.plaud.ai/mcp</code>. After authorizing, Claude stores the token;
                  you can find it in your Claude settings.
                </p>
              ),
            },
            {
              n: 4,
              title: 'Paste your token below',
              body: (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      className="h-9 text-xs font-mono flex-1"
                      placeholder="eyJ…"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <Button onClick={handleSave} disabled={saving || !token.trim()} className="h-9">
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mr-1" />
                      )}
                      Save & Test
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Token is stored server-side in Cosmos DB and never sent back to the browser
                    after saving.
                  </p>
                </div>
              ),
            },
          ].map(({ n, title, body, note }) => (
            <div key={n} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {n}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{title}</p>
                {body}
                {note && <p className="text-xs text-slate-400 mt-1">{note}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MCP server info */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300 space-y-1">
        <p>
          <strong>MCP server:</strong> <code>https://mcp.plaud.ai/mcp</code> (Streamable HTTP)
        </p>
        <p>
          <strong>Available tools:</strong> list_files · get_file · get_note · get_transcript ·
          get_current_user
        </p>
        <p>
          <strong>Auth:</strong> OAuth — token is rotated by Plaud; if the Library stops working,
          refresh your token here.
        </p>
        <a
          href="https://docs.plaud.ai/documentation/plaud_app/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          Full Plaud MCP docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RecordingsPage() {
  useAuthReady();
  const [activeTab, setActiveTab] = useState('library');
  const [isConnected, setIsConnected] = useState(false);
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
      } catch {
        setIsConnected(false);
      } finally {
        setCheckingConn(false);
      }
    };
    checkConnection();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <ServicePageHeader
        icon={Radio}
        title="Recordings Hub"
        service="Plaud"
        connected={checkingConn ? 'checking' : isConnected}
        description="Browse your Plaud audio recordings, pull AI summaries and timestamped transcripts, and route them into the Content Pipeline."
        accent="violet"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === 'connect' && !isConnected && !checkingConn && (
              <span className="w-2 h-2 rounded-full bg-amber-400 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'library' && <LibraryTab isConnected={isConnected} />}
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'connect' && (
        <ConnectTab
          isConnected={isConnected}
          onConnected={() => {
            setIsConnected(true);
            setActiveTab('library');
          }}
        />
      )}
    </div>
  );
}
