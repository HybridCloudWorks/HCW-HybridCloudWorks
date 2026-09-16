/**
 * One Plaud recording as a card, and the modal that routes it into the
 * ContentForge pipeline (#576 split this out of RecordingsTab, which Qlty put
 * at file-complexity 73 once Library and Upload became one file).
 *
 * The routing itself is unchanged: "Script this" queues a job whose transcript
 * appears on the Transcripts tab.
 */
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Sparkles, Clock, Zap, Mic, CalendarDays } from 'lucide-react';
import { postJSON } from '@/lib/api';
import { fmtDate, fmtDuration } from './recordingView';
import { ScriptThisButton, TranscriptToggleIcon } from './shared';

/**
 * The card's three reads, module-level over one state bag.
 *
 * Qlty counts a closure's branches into the function that holds it, so
 * defining these inside the component made them the component's complexity —
 * `PlaudRecordingCard` came back at 19. This is the shape `useCertifications`
 * documents and the fix #623 applied to ComposeTab for the same reason.
 */
async function loadTranscript(state, recording) {
  // Already fetched: the button is a toggle from then on.
  if (state.transcript) {
    state.setExpanded((p) => !p);
    return;
  }
  state.setLoadingTx(true);
  state.setExpanded(true);
  try {
    const res = await aiEngine.mcpTool('plaud', 'get_transcript', { file_id: recording.id });
    if (res.ok) state.setTranscript(res.result);
    else
      state.toast({
        title: 'Could not load transcript',
        description: res.error,
        variant: 'destructive',
      });
  } catch (err) {
    state.toast({ title: 'Error', description: err.message, variant: 'destructive' });
  } finally {
    state.setLoadingTx(false);
  }
}

async function loadNote(state, recording) {
  if (state.note) return;
  state.setLoadingNote(true);
  try {
    const res = await aiEngine.mcpTool('plaud', 'get_note', { file_id: recording.id });
    if (res.ok) state.setNote(res.result);
  } catch {
    /* silent: the note is an extra, and its absence is not an error */
  } finally {
    state.setLoadingNote(false);
  }
}

/** The transcript this recording will be routed with, fetching it if needed. */
async function ensureTranscript(state, recording) {
  if (state.transcript) return state.transcript;
  const res = await aiEngine.mcpTool('plaud', 'get_transcript', { file_id: recording.id });
  if (!res.ok) throw new Error(res.error);
  state.setTranscript(res.result);
  return res.result;
}

async function createContent(state, recording, onCreateContent) {
  state.setRouting(true);
  try {
    const tx = await ensureTranscript(state, recording);
    // Save to the recordings container then route to pipeline (the server
    // stamps createdAt).
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
    state.toast({ title: 'Error', description: err.message, variant: 'destructive' });
  } finally {
    state.setRouting(false);
  }
}

export function PlaudRecordingCard({ recording, onCreateContent, onScriptThis, scripting }) {
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [note, setNote] = useState(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);
  // The transcript panel only once the fetch has settled and a note has not
  // taken its place — named rather than inlined, so the condition reads.
  const showTranscript = expanded && transcript && !note && !loadingNote;
  const [routing, setRouting] = useState(false);
  const { toast } = useToast();

  const state = {
    transcript,
    note,
    setTranscript,
    setNote,
    setExpanded,
    setLoadingTx,
    setLoadingNote,
    setRouting,
    toast,
  };
  const fetchTranscript = () => loadTranscript(state, recording);
  const fetchNote = () => loadNote(state, recording);
  const handleCreateContent = () => createContent(state, recording, onCreateContent);

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
            <ScriptThisButton
              label={recording.name || recording.id}
              payload={{ recordingId: recording.id }}
              busyKey={`plaud:${recording.id}`}
              busy={busy}
              onScriptThis={onScriptThis}
            />
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
        {showTranscript && (
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

export function RouteModal({ recording, onClose, onRouted }) {
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
