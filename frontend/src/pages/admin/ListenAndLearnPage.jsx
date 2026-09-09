/**
 * Listen & Learn — generate study podcasts and approve them.
 *
 * The approval step is the point of this page. Episodes are AI-written
 * summaries of a paid exam's objectives, published under the site owner's
 * name, so generation only ever produces drafts and nothing reaches a visitor
 * until someone reads the transcript and approves it here.
 *
 * Generation is a job, not a request: one certification is five model calls,
 * five syntheses and five uploads, and episodes are saved as each area
 * completes. So the run reports progress and a run that times out still leaves
 * finished episodes behind — which is why the page reloads the set after
 * every run, whatever the outcome.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Headphones,
  Loader2,
  Play,
  VolumeX,
} from 'lucide-react';
import {
  GEMINI_TTS_MODEL_TIERS,
  SUPPORTED_PLATFORMS,
  fetchSetForReview,
  fetchSets,
  fetchSpeechSettings,
  generateEpisodes,
  reviewEpisode,
} from '@/lib/listenAndLearn';
import { resolveMediaUrl } from '@/lib/functionsBase';
import SourceGroundingPanel, { EpisodeSources } from './SourceGroundingPanel';

const STATUS_BADGE = {
  published: { variant: 'default', label: 'Published', icon: CheckCircle2 },
  draft: { variant: 'outline', label: 'Draft', icon: null },
  failed: { variant: 'destructive', label: 'Failed', icon: AlertTriangle },
};

const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const formatSize = (bytes) => (bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null);

/** Sub-cent runs are normal here, so two decimals would read as free. */
const formatCost = (usd) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/**
 * Listen & Learn is Gemini TTS with Azure AI Speech as the fallback, never
 * ElevenLabs (owner rule 2026-09-09, ADR 0029 §2b); the server enforces it
 * per product, so a 202 cannot name ElevenLabs here. Anything unlisted is
 * shown as sent.
 */
const PROVIDER_LABEL = { gemini: 'Gemini', azure: 'Azure AI Speech' };

/** "Best (gemini-3.1-flash-tts-preview)", or the bare id for a model not in the pair. */
const modelLabel = (model) =>
  GEMINI_TTS_MODEL_TIERS[model] ? `${GEMINI_TTS_MODEL_TIERS[model]} (${model})` : model;

/**
 * The progress line for a run that has just been accepted.
 *
 * The server's 202 says what the run is expected to spend on speech BEFORE it
 * starts (ADR 0029 §2a). It is a ceiling — every episode priced at
 * `MAX_SCRIPT_BYTES`, the most UTF-8 bytes a script may hold — so it reads
 * "up to", and it names the Gemini model the run will read with, because the
 * two on offer differ by a factor of two. No provider means the run will
 * publish transcripts with no audio; the server says which of the two causes
 * that is, because they call for different fixes — seeding a key, or
 * correcting `LISTEN_AND_LEARN_TTS_PROVIDER` — and a 202 from an older server
 * carries no reason, so the wording without one covers both.
 *
 * @param {{provider?: string|null, model?: string|null, reason?: string|null, estimatedCostUsd?: number|null, episodes?: number, perEpisodeUsd?: number|null}|null|undefined} speech
 */
export function queuedMessage(speech) {
  if (!speech) return 'Queued…';
  if (!speech.provider) {
    if (speech.reason === 'pin_unavailable')
      return 'Queued — the pinned speech provider (LISTEN_AND_LEARN_TTS_PROVIDER) is not configured, so the audio step will fail and episodes will have transcripts only';
    if (speech.reason === 'not_configured')
      return 'Queued — no speech provider is configured, so episodes will have transcripts only';
    return 'Queued — no usable speech provider (none configured, or the pinned one is not), so episodes will have transcripts only';
  }
  const name = PROVIDER_LABEL[speech.provider] || speech.provider;
  const voice = speech.model ? `${name} ${modelLabel(speech.model)}` : name;
  if (typeof speech.estimatedCostUsd !== 'number') return `Queued — speech by ${voice}`;
  const perEpisode =
    typeof speech.perEpisodeUsd === 'number' && speech.episodes
      ? ` (${speech.episodes} episodes × ${formatCost(speech.perEpisodeUsd)})`
      : '';
  return `Queued — speech by ${voice}, up to ${formatCost(speech.estimatedCostUsd)}${perEpisode}`;
}

/**
 * The owner's button, per run: Best (3.1) or Economy (2.5), defaulting to
 * the stored choice on the Platform settings page. The labels and the
 * per-episode ceiling come from the server, which prices them from the same
 * table the 202 uses; if that load failed, the two ids are still offered by
 * their short names and a blank choice means "the stored default".
 */
export function VoiceModelField({ value, options, onChange, disabled }) {
  const choices = options?.length
    ? options
    : Object.entries(GEMINI_TTS_MODEL_TIERS).map(([id, tier]) => ({ id, label: tier }));
  return (
    <label className="text-xs font-medium space-y-1 block">
      <span>Voice model</span>
      <select
        aria-label="Voice model"
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">Stored default</option>}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
            {typeof choice.perEpisodeUsd === 'number'
              ? ` · up to ${formatCost(choice.perEpisodeUsd)} an episode`
              : ''}
          </option>
        ))}
      </select>
      <span className="block font-normal text-[11px] text-muted-foreground">
        Rule of thumb — newer certifications: Best; older ones: Economy. The default is set on
        Platform settings; this choice applies to this run only.
      </span>
    </label>
  );
}

function StatusBadge({ status }) {
  const spec = STATUS_BADGE[status] || STATUS_BADGE.draft;
  const Icon = spec.icon;
  return (
    <Badge variant={spec.variant} className="gap-1">
      {Icon && <Icon className="h-3 w-3" />}
      {spec.label}
    </Badge>
  );
}

/**
 * The player, or an honest explanation of why there isn't one.
 *
 * Its own component because a missing key is a normal state here rather than an
 * error, so both branches carry real content and inlining them pushed the card
 * past the complexity budget.
 */
function EpisodeAudio({ episode }) {
  if (!episode.audioUrl) {
    // Not a failure: the script generated and the transcript is reviewable.
    // Saying which setting is missing turns "no player" into a task.
    if (!episode.audioError) return null;
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <VolumeX className="h-3.5 w-3.5 shrink-0" />
        No audio — {episode.audioError}
      </p>
    );
  }

  // Which voice read it. Provenance for AI-generated study content, and the
  // only thing that answers "why does this one sound different" after a
  // provider or model change.
  const meta = [
    episode.speechModel || episode.speechProvider,
    formatDuration(episode.durationSeconds),
    formatSize(episode.audioBytes),
  ].filter(Boolean);

  return (
    <>
      <audio
        controls
        preload="none"
        src={resolveMediaUrl(episode.audioUrl)}
        className="w-full h-10"
        aria-label={`Preview: ${episode.title || episode.areaName}`}
      >
        <track kind="captions" />
      </audio>
      {meta.length > 0 && <p className="text-[11px] text-muted-foreground">{meta.join(' · ')}</p>}
    </>
  );
}

/** One episode row: what it says, whether it has audio, and the approval. */
function EpisodeCard({ episode, busy, onReview }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const transcript = Array.isArray(episode.transcript) ? episode.transcript : [];
  const published = episode.status === 'published';

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{episode.title || episode.areaName}</p>
          <p className="text-xs text-muted-foreground">
            {episode.areaName}
            {episode.weightLabel ? ` · ${episode.weightLabel} of exam` : ''}
          </p>
        </div>
        <StatusBadge status={episode.status} />
      </div>

      {episode.summary && <p className="text-xs text-muted-foreground">{episode.summary}</p>}

      <EpisodeSources episode={episode} />

      {episode.status === 'failed' && episode.error && (
        <p className="text-xs text-destructive">{episode.error}</p>
      )}

      <EpisodeAudio episode={episode} />

      {transcript.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((open) => !open)}
            aria-expanded={showTranscript}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showTranscript ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showTranscript ? 'Hide transcript' : `Read transcript (${transcript.length} turns)`}
          </button>
          {showTranscript && (
            <div className="mt-2 space-y-2 max-h-96 overflow-y-auto pr-2">
              {transcript.map((turn, i) => (
                <p key={`${turn.speaker}-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{turn.speaker}: </span>
                  {turn.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {episode.status !== 'failed' && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={published ? 'outline' : 'default'}
            disabled={busy}
            onClick={() => onReview(episode, published ? 'draft' : 'published')}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {published ? 'Withdraw to draft' : 'Approve and publish'}
          </Button>
          {published && episode.approvedAt && (
            <span className="text-[11px] text-muted-foreground">
              Approved {new Date(episode.approvedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ListenAndLearnPage() {
  // The hook returns `authReady`; destructuring `ready` left this undefined
  // and the initial load below never ran.
  const { authReady: ready } = useAuthReady();

  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState(null); // { platform, examCode }
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [reviewing, setReviewing] = useState(null); // areaSlug
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);

  const [form, setForm] = useState({
    platform: 'azure',
    examCode: '',
    studyGuideUrl: '',
    certTitle: '',
    ttsModel: '',
  });
  const [speechOptions, setSpeechOptions] = useState([]);

  // The stored model default and the priced choices, best effort: a failed
  // load leaves the field on "Stored default", which is what the server
  // applies to a run that names no model, so nothing is lost but the price.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    fetchSpeechSettings()
      .then(({ geminiModel, options }) => {
        if (cancelled) return;
        setSpeechOptions(options);
        setForm((f) => (f.ttsModel || !geminiModel ? f : { ...f, ttsModel: geminiModel }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const loadSets = useCallback(async () => {
    try {
      setSets(await fetchSets());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // The loader is redeclared inside the effect rather than calling loadSets:
  // a response that lands after this page unmounts (or after auth flips) must
  // not set state, and the effect is the only place that knows when that is.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const rows = await fetchSets();
        if (!cancelled) setSets(rows);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready]);

  const openSet = useCallback(async (platform, examCode) => {
    setSelected({ platform, examCode });
    setLoading(true);
    setError(null);
    try {
      const { episodes: rows } = await fetchSetForReview({ platform, examCode });
      setEpisodes(rows);
    } catch (err) {
      setError(err.message);
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReview = async (episode, status) => {
    setReviewing(episode.areaSlug);
    setError(null);
    try {
      await reviewEpisode({
        platform: selected.platform,
        examCode: selected.examCode,
        areaSlug: episode.areaSlug,
        status,
      });
      // Optimistic on the one field that changed, rather than refetching the
      // whole set: approving five episodes in a row should not cost five
      // round trips through a list that is not otherwise changing.
      setEpisodes((rows) =>
        rows.map((row) => (row.areaSlug === episode.areaSlug ? { ...row, status } : row))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(null);
    }
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    setGenerating(true);
    setError(null);
    setProgress('Queued…');
    try {
      const job = await generateEpisodes({
        ...form,
        // The expected speech spend arrives with the 202 and is shown then —
        // before the run starts is when it is worth knowing.
        onAccepted: (accepted) => setProgress(queuedMessage(accepted?.speech)),
        onUpdate: (j) => setProgress(`Job ${j.status}…`),
      });
      const report = job?.result;
      const withoutAudio = report?.withoutAudio ? `, ${report.withoutAudio} without audio` : '';
      // The run's own spend, summed from the rows written to ai_usage. Shown
      // here because this is the moment it is worth knowing; the same rows roll
      // up under "Breakdown by Feature" on the AI Engine usage tab.
      const cost = report?.costUsd ? ` · ${formatCost(report.costUsd)}` : '';
      setProgress(
        report
          ? `${report.generated} drafted, ${report.failed} failed${withoutAudio}${cost}`
          : `Job ${job?.status}`
      );
      await loadSets();
      await openSet(form.platform, form.examCode);
    } catch (err) {
      // Episodes save as they complete, so even a timeout leaves work behind —
      // reload rather than leaving the page showing a stale set.
      setError(err.message);
      setProgress(null);
      await loadSets();
      if (form.examCode) await openSet(form.platform, form.examCode);
    } finally {
      setGenerating(false);
    }
  };

  const counts = episodes.reduce(
    (acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }),
    {}
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Headphones className="h-6 w-6" />
          Listen &amp; Learn
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          One study podcast per scored area of a certification&apos;s official study guide. Every
          episode is generated as a draft — nothing reaches the site until it is approved here.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a set</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGenerate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium space-y-1">
                <span>Platform</span>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                >
                  {SUPPORTED_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium space-y-1">
                <span>Exam code</span>
                <Input
                  value={form.examCode}
                  onChange={(e) => setForm((f) => ({ ...f, examCode: e.target.value }))}
                  placeholder="AZ-104"
                  required
                />
              </label>
            </div>
            <label className="text-xs font-medium space-y-1 block">
              <span>Study guide URL</span>
              <Input
                type="url"
                value={form.studyGuideUrl}
                onChange={(e) => setForm((f) => ({ ...f, studyGuideUrl: e.target.value }))}
                placeholder="https://learn.microsoft.com/credentials/certifications/resources/study-guides/az-104"
                required
              />
            </label>
            <label className="text-xs font-medium space-y-1 block">
              <span>Certification title (optional)</span>
              <Input
                value={form.certTitle}
                onChange={(e) => setForm((f) => ({ ...f, certTitle: e.target.value }))}
                placeholder="Azure Administrator Associate"
              />
            </label>
            <VoiceModelField
              value={form.ttsModel}
              options={speechOptions}
              disabled={generating}
              onChange={(ttsModel) => setForm((f) => ({ ...f, ttsModel }))}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={generating}>
                {generating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Generate
              </Button>
              {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              A run takes several minutes and saves each episode as it completes, so a timeout still
              leaves finished episodes behind. Re-running an exam code replaces its episodes and
              clears their approval. Each run is read by Gemini TTS on the chosen voice model (never
              ElevenLabs, which is the podcast voice) and the expected spend is shown here as soon
              as the run is accepted; the actual spend is logged to the AI Engine usage tab.
            </p>
          </form>
        </CardContent>
      </Card>

      <SourceGroundingPanel
        platform={form.platform}
        examCode={form.examCode}
        certTitle={form.certTitle}
        onDone={async () => {
          await loadSets();
          if (form.examCode) await openSet(form.platform, form.examCode);
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generated sets</CardTitle>
        </CardHeader>
        <CardContent>
          {sets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing generated yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sets.map((set) => (
                <Button
                  key={set.id}
                  size="sm"
                  variant={
                    selected?.examCode === set.examCode && selected?.platform === set.provider
                      ? 'default'
                      : 'outline'
                  }
                  onClick={() => openSet(set.provider, set.examCode)}
                >
                  {set.examCode}
                  <span className="ml-1.5 text-[10px] opacity-70">{set.provider}</span>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {selected.examCode}
              <span className="text-xs font-normal text-muted-foreground">
                {counts.published || 0} published · {counts.draft || 0} draft · {counts.failed || 0}{' '}
                failed
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading episodes…
              </p>
            )}
            {!loading && episodes.length === 0 && (
              <p className="text-sm text-muted-foreground">No episodes in this set.</p>
            )}
            {!loading &&
              episodes.map((episode) => (
                <EpisodeCard
                  key={episode.areaSlug}
                  episode={episode}
                  busy={reviewing === episode.areaSlug}
                  onReview={handleReview}
                />
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
