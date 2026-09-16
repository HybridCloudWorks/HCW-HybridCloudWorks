/**
 * Recordings — the Plaud library, stored recordings, and audio upload (#576).
 *
 * The Plaud tab's Library and Upload sub-tabs were two halves of one duty:
 * getting a recording into the hub so it can be transcribed and scripted.
 * Sub-tabs inside a tab are a second navigation to learn, so they are sections
 * of this one instead — the live library first, then what is stored, then the
 * two ways to add something.
 *
 * "Script this" queues a ContentForge job; the transcript it produces appears
 * on the Transcripts tab. That routing is unchanged.
 *
 * The live library needs a connected Plaud MCP token. When there is none this
 * tab still lists the stored recordings and says where to connect, rather than
 * rendering empty — connecting is a Settings job now.
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
  Upload,
  Sparkles,
  Loader2,
  CheckCircle,
  Search,
  Clock,
  Zap,
  RefreshCw,
  Mic,
  AlertCircle,
  Link,
  CalendarDays,
  FileAudio,
} from 'lucide-react';
import { postJSON, getJSON, sendJSON } from '@/lib/api';
import { aiEngine } from '@/lib/aiEngine';
import {
  AUDIO_ACCEPT,
  MAX_AUDIO_UPLOAD_BYTES,
  SCRIPT_QUEUED_TOAST,
  fmtDate,
  fmtDuration,
  readFileAsBase64,
  sourceLabel,
} from './recordingView';
import { TranscriptToggleIcon } from './shared';

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
          description: 'Add your Plaud OAuth token on the Settings tab.',
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
            Go to the <strong>Settings</strong> tab and paste your OAuth token.
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
          connected Plaud on the Settings tab, the live library above has all your recordings
          instead.
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

/**
 * Library and Upload were two halves of one duty, so they are sections here
 * rather than sub-tabs. `reloadKey` is bumped by an upload so the stored list
 * below the library picks it up without a second read being wired between two
 * components that no longer need to know about each other.
 */
export default function RecordingsTab({ hub }) {
  const [reloadKey, setReloadKey] = useState(0);
  const onStored = () => setReloadKey((k) => k + 1);

  return (
    <div className="space-y-8">
      <LibraryTab isConnected={hub.connection === 'connected'} reloadKey={reloadKey} />
      <hr className="border-slate-200 dark:border-slate-700" />
      <AudioUploadForm onQueued={onStored} />
      <hr className="border-slate-200 dark:border-slate-700" />
      <ManualPaste onSaved={onStored} />
    </div>
  );
}
