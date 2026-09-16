/**
 * Recordings — the Plaud library, stored recordings, and the two ways to add
 * audio by hand (#576).
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
 *
 * The card, the routing modal and the two upload forms live beside this file
 * (recordingCards.jsx, uploadForms.jsx): together they put one module at
 * Qlty's file-complexity limit.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Search, RefreshCw, Mic, Link } from 'lucide-react';
import { postJSON, getJSON } from '@/lib/api';
import { aiEngine } from '@/lib/aiEngine';
import { SCRIPT_QUEUED_TOAST, fmtDate, fmtDuration, sourceLabel } from './recordingView';
import { PlaudRecordingCard, RouteModal } from './recordingCards';

/**
 * `list_files` answers JSON text that is either the array itself or an object
 * wrapping it under one of four keys. A list rather than a chain of `||`
 * feeding a ternary, which is the one expression `qlty:boolean-logic` objects
 * to here; an unparseable body is an empty list, never a throw.
 */
const FILE_LIST_KEYS = ['data', 'files', 'recordings', 'items'];

function readFileList(result) {
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  const wrapped = FILE_LIST_KEYS.map((key) => parsed?.[key]).find(Array.isArray);
  return wrapped || [];
}
import { AudioUploadForm, ManualPaste } from './uploadForms';

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
  // No filter set, so a full page means there is probably a next one.
  const unfiltered = !search && !dateFrom && !dateTo;
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
        setRecordings(readFileList(res.result));
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
          {unfiltered && recordings.length === 20 && (
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
