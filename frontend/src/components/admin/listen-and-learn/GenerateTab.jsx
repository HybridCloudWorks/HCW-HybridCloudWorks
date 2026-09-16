/**
 * Generate — pick a certification, ground it on owner-supplied pages or videos
 * (#433), and run. The form and the grounding panel are one duty: both describe
 * the run that is about to happen.
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
import { SUPPORTED_PLATFORMS } from '@/lib/listenAndLearn';
import SourceGroundingPanel from '@/pages/admin/SourceGroundingPanel';
import VoiceModelField from './VoiceModelField';

export default function GenerateTab({ hub }) {
  const { generating, progress, speechOptions, storedModel, loadSets, openSet, generate } = hub;
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

  const onSubmit = (event) => {
    event.preventDefault();
    generate({ ...form, ttsModel });
  };

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a set</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
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
              value={ttsModel}
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
    </div>
  );
}
