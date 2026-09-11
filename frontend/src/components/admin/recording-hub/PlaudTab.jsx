/**
 * Recording Hub → Plaud tab (#442): the Plaud MCP Library and Connect
 * behaviour that lived on /admin/recordings, plus the direction that page
 * did not have — upload audio for Plaud Embedded to transcribe — and the
 * "Script this" action that turns any recording into a podcast draft
 * (#434 wiring).
 *
 * Plaud has a real MCP server at https://mcp.plaud.ai/mcp (Streamable HTTP,
 * OAuth). The Library connects live to your Plaud library via the AI
 * Engine's mcpProxy Azure Function — no manual exports needed.
 *
 * Three sub-tabs:
 *   1. Library       — live recordings from Plaud MCP: list_files → get_transcript,
 *                      with "Script this" per recording; stored recordings
 *                      (manual pastes and transcribed uploads) listed below it
 *   2. Upload        — audio for Plaud Embedded to transcribe (new), and the
 *                      manual transcript paste kept as a fallback sub-section
 *   3. Connect       — OAuth token setup for Plaud MCP
 *
 * Auth flow:
 *   • User runs `npx -y @plaud-ai/mcp@latest install` once, to set up a local
 *     AI client and authorize in the browser
 *   • Copies the resulting OAuth access token AND refresh token
 *     (~/.plaud/tokens-mcp.json holds both)
 *   • Pastes them in the Connect tab → stored in Cosmos DB (server-side only)
 *   • mcpProxy uses the access token; the refreshPlaudToken timer rotates the
 *     pair every 12 hours using the refresh token. Neither value reaches the
 *     browser after saving — reads carry hasOauthToken / hasOauthRefreshToken.
 *
 * BOTH tokens matter. An access token pasted alone lasts about a day and then
 * stops, because the timer has nothing to renew it with — the failure looks
 * like "it worked and then stopped", which is exactly what it is. A refresh
 * returns a NEW pair with a fresh week, so a stored pair renews indefinitely.
 *
 * When Plaud answers 401 / CLIENT_USER_AUTH_REVOKED, the authorization was
 * revoked server-side and the token's own expiry is irrelevant. Re-running the
 * installer does NOT fix it — measured 2026-09-08, twice: it reuses the same
 * client-user record and mints new tokens against the revoked link. The MCP's
 * `login` tool clears it in one call ("log me into Plaud" in any connected AI
 * client). Nothing in Plaud's docs connects that error to that remedy.
 *
 * These are the Plaud MCP tokens. Plaud Embedded's client id and API key
 * (docs.plaud.ai/plaud-embedded) are a different product — device SDK and
 * transcription API — and are what the Upload sub-tab's audio transcription
 * uses, server-side, from Key Vault (PLAUD-EMBEDDED-CLIENT-ID /
 * PLAUD-EMBEDDED-API-KEY). Both credentials are needed, one per direction:
 * the MCP reads what Plaud recorded; Embedded transcribes what you upload.
 *
 * Cosmos DB containers:
 *   recordings          — stored transcripts: manual pastes, Plaud MCP copies
 *                         routed into ContentForge, and Plaud Embedded results
 *   mcp_servers/plaud   — stores oauthToken + oauthRefreshToken (admin-write only)
 *   podcast_transcripts — where "Script this" lands (Podcast tab)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
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
  FileAudio,
} from 'lucide-react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import { aiEngine, setMcpOAuthToken } from '@/lib/aiEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'library', label: 'Library', icon: Radio },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'connect', label: 'Connect', icon: Link },
];

export const SCRIPT_QUEUED_TOAST = 'Queued. It appears on the Podcast tab when generated.';

/** Accepted by the upload route; mirrors ACCEPTED_AUDIO_EXTENSIONS server-side. */
export const AUDIO_ACCEPT = '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav';
export const MAX_AUDIO_UPLOAD_BYTES = 40 * 1024 * 1024;

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

/**
 * A moment, from either shape the Plaud document stores it in (#358).
 *
 * `lastTokenRefresh` is an ISO string and `oauthExpiresAt` is epoch
 * milliseconds, because the timer writes them from `now().toISOString()` and
 * `now().getTime() + expiresInSec * 1000` respectively. One formatter takes
 * both rather than making the caller remember which is which.
 *
 * Returns '' for anything unparseable, so a malformed field renders as absent
 * rather than as "Invalid Date" — a token page is the wrong place to make
 * someone wonder whether the date or the token is broken.
 */
function fmtWhen(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A File as the base64 the upload route reads, without the data-URL prefix. */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function TranscriptToggleIcon({ loading, expanded }) {
  if (loading) return <Loader2 className="h-3 w-3 animate-spin" />;
  if (expanded) return <ChevronDown className="h-3 w-3" />;
  return <ChevronRight className="h-3 w-3" />;
}

/**
 * "Script this" — enqueue the podcast transcript job for one recording. The
 * API refuses at the door (409 with the Connect-tab sentence, 404 for a
 * stored recording that is gone) and that sentence is shown verbatim,
 * because it names the fix.
 */
function useScriptThis() {
  const [scripting, setScripting] = useState('');
  const { toast } = useToast();
  const scriptThis = async (payload, key) => {
    setScripting(key);
    try {
      await postJSON('cms/podcast/transcripts/generate-from-recording', payload);
      toast({ title: 'Podcast script queued', description: SCRIPT_QUEUED_TOAST });
    } catch (err) {
      toast({ title: 'Not queued', description: err.message, variant: 'destructive' });
    } finally {
      setScripting('');
    }
  };
  return { scripting, scriptThis };
}

// ─── Recording Card ───────────────────────────────────────────────────────────

function PlaudRecordingCard({ recording, onCreateContent, onScriptThis, scripting }) {
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

  const busy = scripting === `plaud:${recording.id}`;

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
          <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
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
              variant="outline"
              className="h-7 text-xs px-2 border-violet-300 text-violet-700 dark:text-violet-300"
              onClick={() => onScriptThis({ recordingId: recording.id }, `plaud:${recording.id}`)}
              disabled={busy}
              aria-label={`Script this: ${recording.name || recording.id}`}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Mic className="h-3 w-3 mr-1" />
              )}
              Script this
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

// ─── Stored recordings (the `recordings` container) ──────────────────────────

function sourceLabel(source) {
  if (source === 'plaud-embedded') return 'Plaud Embedded';
  if (source === 'plaud_mcp') return 'Plaud copy';
  if (source === 'manual_upload') return 'Pasted';
  return source || 'stored';
}

export function StoredRecordings({ onScriptThis, scripting, reloadKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // No setLoading(true) here: the initial state is loading, and a reload
    // keeps the stale list on screen rather than flashing empty.
    (async () => {
      try {
        const res = await getJSON('cms/recordings?limit=50');
        if (!cancelled) setItems(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm">Stored recordings</h3>
      <p className="text-xs text-slate-500">
        Transcripts kept in this site&apos;s own store: pasted ones, copies made by Create Content,
        and uploads Plaud Embedded transcribed. Each can be scripted the same way.
      </p>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      {!loading && items.length === 0 && (
        <p className="text-xs text-slate-400">Nothing stored yet.</p>
      )}
      <div className="space-y-2">
        {items.map((rec) => {
          const busy = scripting === `stored:${rec.id}`;
          return (
            <Card key={rec.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{rec.title || rec.id}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge variant="secondary">{sourceLabel(rec.source)}</Badge>
                    {rec.status && <span>{rec.status}</span>}
                    {(rec.durationMs || rec.duration) > 0 && (
                      <span>{fmtDuration(rec.durationMs || rec.duration)}</span>
                    )}
                    <span>{fmtDate(rec.createdAt)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-2 border-violet-300 text-violet-700 dark:text-violet-300 shrink-0"
                  onClick={() => onScriptThis({ storedRecordingId: rec.id }, `stored:${rec.id}`)}
                  disabled={busy}
                  aria-label={`Script this: ${rec.title || rec.id}`}
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Mic className="h-3 w-3 mr-1" />
                  )}
                  Script this
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Library sub-tab (Live Plaud MCP) ────────────────────────────────────────

function LibraryTab({ isConnected, reloadKey }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [routingRec, setRoutingRec] = useState(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { scripting, scriptThis } = useScriptThis();

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

  return (
    <div className="space-y-6">
      {!isConnected ? (
        <div className="text-center py-10 space-y-3">
          <Link className="h-10 w-10 text-slate-300 mx-auto" />
          <p className="text-sm text-slate-500">Connect your Plaud account first.</p>
          <p className="text-xs text-slate-400">
            Go to the <strong>Connect</strong> tab and paste your OAuth token.
          </p>
        </div>
      ) : (
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
              aria-label="Refresh recordings"
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
                  onScriptThis={scriptThis}
                  scripting={scripting}
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
      )}

      <StoredRecordings onScriptThis={scriptThis} scripting={scripting} reloadKey={reloadKey} />
    </div>
  );
}

// ─── Upload sub-tab: audio for transcription, and the manual paste ───────────

export function AudioUploadForm({ onQueued }) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [queued, setQueued] = useState(null);
  const fileRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    if (picked) setTitle((t) => t || picked.name.replace(/\.(mp3|m4a|wav)$/i, ''));
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast({ title: 'Title and an audio file are required', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      toast({
        title: 'File too large',
        description: 'The upload limit is 40 MB — about an hour at 64 kbps.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await readFileAsBase64(file);
      const res = await postJSON('cms/podcast/recordings/upload', {
        title: title.trim(),
        fileName: file.name,
        contentType: file.type || 'audio/mpeg',
        dataBase64,
      });
      setQueued({ jobId: res.jobId, title: title.trim(), fileName: file.name });
      setTitle('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      toast({
        title: 'Transcription queued',
        description: 'Plaud is transcribing it; the result appears under Stored recordings.',
      });
      onQueued?.(res);
    } catch (err) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <FileAudio className="h-4 w-4" /> Upload audio for transcription
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Plaud Embedded transcribes the file with speaker labels and the transcript is stored here;
          the audio is kept only so Plaud can fetch it. MP3, M4A or WAV, up to 40 MB.
        </p>
      </div>
      <div>
        <Label htmlFor="audio-upload-title" className="text-xs">
          Title
        </Label>
        <Input
          id="audio-upload-title"
          className="mt-1 h-9"
          placeholder="Architecture review — Sept 8"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="audio-upload-file" className="text-xs">
          Audio file
        </Label>
        <input
          id="audio-upload-file"
          ref={fileRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="mt-1 block w-full text-xs"
          onChange={handleFileChange}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Upload & transcribe
        </Button>
        {queued && (
          <span className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
            Queued: {queued.title} ({queued.fileName}) — job {queued.jobId}
          </span>
        )}
      </div>
    </div>
  );
}

function ManualPaste({ onSaved }) {
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
      toast({ title: 'Recording saved ✓', description: 'Find it under Stored recordings.' });
      onSaved?.();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast({ title: 'Error saving', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold text-sm">Paste a transcript</h3>
        <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />A manual fallback. If you&apos;ve
          connected Plaud via the Connect tab, use the Library tab for live access to all your
          recordings instead.
        </div>
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

function UploadTab({ onStored }) {
  return (
    <div className="space-y-8">
      <AudioUploadForm onQueued={onStored} />
      <hr className="border-slate-200 dark:border-slate-700" />
      <ManualPaste onSaved={onStored} />
    </div>
  );
}

// ─── Connect sub-tab (OAuth setup) ───────────────────────────────────────────

function ConnectTab({ isConnected, hasRefreshToken, refreshState, onConnected }) {
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!token.trim()) return;
    const refreshSupplied = Boolean(refreshToken.trim());
    setSaving(true);
    try {
      await setMcpOAuthToken('plaud', token.trim(), refreshToken);
      toast({ title: 'Token saved ✓', description: 'Testing connection…' });
      setToken('');
      setRefreshToken('');
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
        onConnected({ refreshSupplied });
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
      onConnected({ refreshSupplied: false });
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
              <strong>Connected</strong> — your Plaud recordings are live in the Library tab.{' '}
              {hasRefreshToken
                ? 'Auto-refresh is armed: a refresh token is stored.'
                : 'No refresh token stored, so the access token expires on its own (about a day); paste both to keep it alive.'}
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

      {/* What the 12-hour timer has actually done (#358).

          The rotation had NO witness before this. It writes `lastTokenRefresh`
          to the document and logs its success at Information, and T-719 cut
          host verbosity to Warning — so the trace is not ingested and the
          document was never rendered. "The timer is armed" and "the timer has
          run" looked identical from every surface a person can reach, which is
          the T-766 defect in a different timer.

          Rendered only when the read has answered. `null` means not yet known,
          and printing "never" for that would be a claim rather than a
          measurement. */}
      {refreshState && (
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <p>
            Auto-refresh last ran:{' '}
            <strong>
              {refreshState.lastTokenRefresh
                ? fmtWhen(refreshState.lastTokenRefresh)
                : 'not since this token was stored'}
            </strong>
          </p>
          {refreshState.expiresAt ? (
            <p>
              Access token expires: <strong>{fmtWhen(refreshState.expiresAt)}</strong>
            </p>
          ) : null}
          {refreshState.error ? (
            <p className="text-amber-700 dark:text-amber-400">
              Last refresh failed: {refreshState.error}
            </p>
          ) : null}
        </div>
      )}

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
              note: 'Requires Node.js ≥ 20. Detects local AI clients and writes MCP config automatically. First-time setup only — re-running this does NOT repair a rejected token; see "If the Library stops working" below.',
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
              title: 'Copy your access token and refresh token',
              body: (
                <>
                  <p className="text-xs text-slate-500 mt-1">
                    Your tokens are saved to{' '}
                    <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
                      ~/.plaud/tokens-mcp.json
                    </code>
                    . Copy the <code>access_token</code> and the <code>refresh_token</code>. Paste
                    both the first time — the access token connects the Library and lasts about a
                    day; the refresh token is what lets the site rotate the pair every 12 hours. An
                    access token stored on its own works until it expires and then stops, with
                    nothing able to renew it. Reconnecting later, you may leave the refresh field
                    blank to keep the one already stored; fill it whenever you have just
                    re-authorized, because that issues a new refresh token and the stored one stops
                    working.
                    <br />
                    <br />
                    To print them, in PowerShell:
                  </p>
                  <div className="mt-1 font-mono text-xs bg-slate-900 text-slate-100 rounded p-2 select-all break-all">
                    Get-Content &quot;$env:USERPROFILE\.plaud\tokens-mcp.json&quot;
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    <code>expires_at</code> in that file is in <strong>milliseconds</strong>. A
                    converter that assumes seconds returns a date tens of thousands of years out,
                    which is easily misread as the token being unusable when it has a day left.
                  </p>
                </>
              ),
            },
            {
              n: 4,
              title: 'Paste your tokens below',
              body: (
                <div className="mt-2 space-y-2">
                  <Input
                    type="password"
                    className="h-9 text-xs font-mono"
                    placeholder="access_token — eyJ…"
                    aria-label="Plaud access token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      className="h-9 text-xs font-mono flex-1"
                      placeholder="refresh_token — eyJ… (required to stay connected)"
                      aria-label="Plaud refresh token"
                      value={refreshToken}
                      onChange={(e) => setRefreshToken(e.target.value)}
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
                    Both values are stored server-side in Cosmos DB and never sent back to the
                    browser after saving. Leaving the refresh field blank keeps the token already
                    stored — right when you are only replacing an expired access token, wrong after
                    re-authorizing, because that issued a new refresh token and retired the stored
                    one.
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
          <strong>Auth:</strong> OAuth — the access token lasts about a day, the refresh token about
          a week, and each refresh returns a new pair with a fresh week. With both stored, the
          12-hour <code>refreshPlaudToken</code> timer keeps the connection alive indefinitely.
          Plaud Embedded&apos;s client id and API key are a different product: they transcribe the
          audio you upload on the Upload tab and are seeded in Key Vault, not pasted here.
        </p>
        <a
          href="https://docs.plaud.ai/plaud-mcp-cli/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          Full Plaud MCP docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/*
        Measured on 2026-09-08. Two full re-installs and a fresh browser
        authorization all produced tokens that Plaud rejected with
        CLIENT_USER_AUTH_REVOKED, because the installer reuses the existing
        client-user record rather than creating one. The MCP's own `login` tool
        cleared it in a single call. Nothing in Plaud's documentation connects
        that error to that remedy, which is why it is written down here.
      */}
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-800 dark:text-amber-300 space-y-1">
        <p className="font-semibold">If the Library stops working</p>
        <p>
          A 401, or <code>CLIENT_USER_AUTH_REVOKED</code> from Plaud, means the authorization was
          revoked on Plaud&apos;s side — not that the token expired. Re-running the installer does
          NOT fix it: it mints new tokens against the same revoked record.
        </p>
        <p>
          The fix is the MCP&apos;s own login tool. In an AI client that has Plaud connected (Claude
          Code, Claude Desktop, Cursor), ask it to <strong>log you into Plaud</strong>. That calls{' '}
          <code>login</code>, clears the revocation, and rewrites{' '}
          <code>~/.plaud/tokens-mcp.json</code>. Then copy both values back into the fields above.
        </p>
        <p>
          You do not need to revoke the app in Plaud&apos;s Authorized apps panel, and the grant
          staying listed there does not mean the connection works — the two are tracked separately.
        </p>
      </div>
    </div>
  );
}

// ─── The tab ──────────────────────────────────────────────────────────────────

export default function PlaudTab({
  isConnected,
  hasRefreshToken,
  refreshState,
  checkingConn,
  onConnected,
}) {
  const [subTab, setSubTab] = useState('library');
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist">
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={subTab === id}
            onClick={() => setSubTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              subTab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === 'connect' && !isConnected && !checkingConn && (
              <span className="w-2 h-2 rounded-full bg-amber-400 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {subTab === 'library' && <LibraryTab isConnected={isConnected} reloadKey={reloadKey} />}
      {subTab === 'upload' && <UploadTab onStored={() => setReloadKey((k) => k + 1)} />}
      {subTab === 'connect' && (
        <ConnectTab
          isConnected={isConnected}
          hasRefreshToken={hasRefreshToken}
          refreshState={refreshState}
          onConnected={(info) => {
            onConnected(info);
            setSubTab('library');
          }}
        />
      )}
    </div>
  );
}
