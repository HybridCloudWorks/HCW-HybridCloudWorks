/**
 * Generate — pick a certification, ground it on owner-supplied pages or videos
 * (#433), and run. The form and the grounding panel are one duty: both describe
 * the run that is about to happen. The result is a COURSE in the Library
 * (ADR 0033 §4): one lesson per scored area, drafts until approved.
 *
 * The form lives here rather than in the hook because nothing else reads it.
 * The run itself does not: `hub.generate` owns `generating` and `progress`, so
 * a run keeps reporting while the operator is on another tab.
 */
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Play } from 'lucide-react';
import { GENERATE_PLATFORMS, GITHUB_GENERATE_NOTE } from '@/lib/listenAndLearn';
import SourceGroundingPanel from '@/pages/admin/SourceGroundingPanel';
import VoiceModelField from './VoiceModelField';
import { formatCost } from './episodeView';

export default function GenerateTab({ hub }) {
  const { generating, progress, speechOptions, storedModel, catalog, loadSets, openSet, generate } =
    hub;
  const [form, setForm] = useState({
    platform: 'azure',
    examCode: '',
    studyGuideUrl: '',
    certTitle: '',
    ttsModel: null,
  });

  // `null` is "not chosen yet", so the stored default shows once it loads;
  // `''` is the operator choosing "Stored default" on purpose. Both send no
  // model, and keeping them distinct is what lets a late settings response
  // fill an untouched field without overriding a choice already made —
  // derived rather than written back into state by an effect, which would be
  // a second source of truth for the same value.
  const ttsModel = form.ttsModel === null ? storedModel : form.ttsModel;

  // What one lesson is expected to cost with the model that will run: the
  // chosen one, else the stored default, else the server's default (Economy).
  const effective = ttsModel || catalog?.effectiveModel || null;
  const perEpisode = (speechOptions || []).find((o) => o.id === effective)?.perEpisodeUsd;

  const onSubmit = (event) => {
    event.preventDefault();
    generate({ ...form, ttsModel });
  };

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a course from a study guide</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="generate-platform" className="space-y-1 text-xs font-medium">
                <span>Platform</span>
                <select
                  id="generate-platform"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                >
                  {GENERATE_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="generate-exam" className="space-y-1 text-xs font-medium">
                <span>Exam code</span>
                <Input
                  id="generate-exam"
                  value={form.examCode}
                  onChange={(e) => setForm((f) => ({ ...f, examCode: e.target.value }))}
                  placeholder="AZ-104"
                  required
                />
              </label>
            </div>
            <label htmlFor="generate-guide" className="block space-y-1 text-xs font-medium">
              <span>Study guide URL</span>
              <Input
                id="generate-guide"
                type="url"
                value={form.studyGuideUrl}
                onChange={(e) => setForm((f) => ({ ...f, studyGuideUrl: e.target.value }))}
                placeholder="https://learn.microsoft.com/credentials/certifications/resources/study-guides/az-104"
                required
              />
            </label>
            <label htmlFor="generate-title" className="block space-y-1 text-xs font-medium">
              <span>Certification title (optional)</span>
              <Input
                id="generate-title"
                value={form.certTitle}
                onChange={(e) => setForm((f) => ({ ...f, certTitle: e.target.value }))}
                placeholder="Azure Administrator Associate"
              />
            </label>
            <VoiceModelField
              value={ttsModel}
              options={speechOptions}
              defaultModel={catalog?.defaultModel}
              disabled={generating}
              onChange={(ttsModel) => setForm((f) => ({ ...f, ttsModel }))}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={generating}>
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Generate
              </Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {progress ||
                  (typeof perEpisode === 'number'
                    ? `Up to ${formatCost(perEpisode)} per lesson with ${effective}; a guide has at most eight.`
                    : null)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A run takes several minutes and saves each lesson as it completes, so a timeout still
              leaves finished lessons behind. Re-running an exam code adds a new take to each lesson
              and keeps its approval and your renames; a lesson the new guide no longer lists is
              marked &ldquo;Not in current guide&rdquo; in the Library rather than removed. Each run
              is read by Gemini TTS on the chosen voice model (never ElevenLabs, which is the
              podcast voice) and the expected spend is shown here as soon as the run is accepted;
              the actual spend is logged to the AI Engine usage tab.
            </p>
            <p className="text-[11px] text-muted-foreground">{GITHUB_GENERATE_NOTE}</p>
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
    </div>
  );
}
