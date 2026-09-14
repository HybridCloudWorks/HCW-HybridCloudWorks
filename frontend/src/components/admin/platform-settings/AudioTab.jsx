/**
 * Audio — the shows the site ingests and the voice that reads study episodes.
 *
 *   Podcast feeds          admin_config/podcast_feeds           read by timers/podcasts.js
 *   Listen & Learn voice   admin_config/listen_and_learn_speech read by listen-and-learn-jobs.js
 *
 * Each card loads on its own, so one failing never hides the other.
 */

import React, { useMemo } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Headphones, Podcast } from 'lucide-react';
import {
  PODCAST_PROVIDERS,
  SETTING_LABELS,
  SaveRow,
  SettingSection,
  StoredState,
  useSetting,
} from './settingShared';

export function PodcastFeedsCard({ value, onChange, onSave, saving, meta }) {
  const feeds = useMemo(() => value?.feeds ?? [], [value]);
  // The fixed rows first, then any provider the document carries beyond them.
  const providers = useMemo(() => {
    const extra = feeds
      .map((row) => row.provider)
      .filter((provider) => provider && !PODCAST_PROVIDERS.includes(provider));
    return [...PODCAST_PROVIDERS, ...new Set(extra)];
  }, [feeds]);
  // Spread the current value rather than rebuilding it: the main feed and the
  // provider rows are edited by different controls and neither may drop the
  // other's field on the way to the save.
  const update = (patch) => onChange({ ...(value ?? {}), ...patch });
  const urlFor = (provider) => feeds.find((row) => row.provider === provider)?.url ?? '';
  const setUrl = (provider, url) => {
    const present = feeds.some((row) => row.provider === provider);
    update({
      feeds: present
        ? feeds.map((row) => (row.provider === provider ? { provider, url } : row))
        : [...feeds, { provider, url }],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Podcast className="h-5 w-5" /> Podcast feeds
        </CardTitle>
        <CardDescription>
          The main feed is the site&apos;s own show. Its episodes appear on every provider&apos;s
          audio page, at the top, and its RSS button is what a reader gets on a provider with no
          feed of its own. The per-provider feeds below are optional extras for a show that belongs
          to one provider. All are fetched every two hours, all must be https; blank means no feed.
          A feed that answers 410 Gone is reported in Ops Health and should be replaced or blanked
          here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <Label htmlFor="feed-main" className="text-sm font-semibold">
              Main feed
            </Label>
            <Input
              id="feed-main"
              type="text"
              inputMode="url"
              value={value?.mainFeedUrl ?? ''}
              disabled={saving}
              spellCheck={false}
              placeholder="https://media.rss.com/…/feed.xml"
              onChange={(event) => update({ mainFeedUrl: event.target.value })}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              The site&apos;s show — not any one provider&apos;s.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Per-provider feeds (optional)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => (
                <div key={provider} className="space-y-1">
                  <Label htmlFor={`feed-${provider}`}>{provider}</Label>
                  <Input
                    id={`feed-${provider}`}
                    type="text"
                    inputMode="url"
                    value={urlFor(provider)}
                    disabled={saving}
                    spellCheck={false}
                    placeholder="https://…/feed.xml"
                    onChange={(event) => setUrl(provider, event.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <SaveRow saving={saving} />
        </form>
      </CardContent>
    </Card>
  );
}

/** Sub-cent figures are not what these are; two decimals read right. */
const formatUsd = (usd) => (typeof usd === 'number' ? `$${usd.toFixed(2)}` : null);

/**
 * The owner's button: which Gemini TTS model reads a Listen & Learn episode
 * by default. Two choices, priced by the server from the same table the
 * generation 202 uses; the generation form can override per run. The rule of
 * thumb is guidance for the person choosing, not automation.
 */
export function ListenAndLearnSpeechCard({ value, options, onChange, onSave, saving, meta }) {
  const chosen = value?.geminiModel ?? '';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Headphones className="h-5 w-5" /> Listen &amp; Learn voice
        </CardTitle>
        <CardDescription>
          The Gemini TTS model that reads a study episode unless a run chooses otherwise. Listen
          &amp; Learn is always Gemini (Azure AI Speech as the fallback); ElevenLabs is the podcast
          voice and is never used here. Each figure is the most one episode can cost at the script
          ceiling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <fieldset className="space-y-2" disabled={saving}>
            <legend className="text-sm font-medium">Voice model</legend>
            {(options ?? []).map((option) => (
              <label
                key={option.id}
                htmlFor={`tts-${option.tier}`}
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border border-input px-3 py-2 text-sm"
              >
                <input
                  id={`tts-${option.tier}`}
                  type="radio"
                  name="geminiModel"
                  value={option.id}
                  checked={chosen === option.id}
                  onChange={() => onChange({ geminiModel: option.id })}
                  className="row-span-2 mt-1"
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  <code>{option.id}</code>
                  {formatUsd(option.perEpisodeUsd)
                    ? ` · up to ${formatUsd(option.perEpisodeUsd)} an episode`
                    : ''}
                </span>
              </label>
            ))}
            {(options ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                The server offered no choices; the stored value is <code>{chosen || 'unset'}</code>.
              </p>
            ) : null}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Rule of thumb — newer certifications: Best; older ones: Economy. Applied by the person
            generating, not by the certification&apos;s age.
          </p>
          <SaveRow saving={saving} />
        </form>
      </CardContent>
    </Card>
  );
}

export default function AudioTab() {
  const { authReady } = useAuthReady();
  const podcasts = useSetting('podcast-feeds', authReady);
  const speech = useSetting('listen-and-learn-speech', authReady);

  return (
    <div className="space-y-6">
      <SettingSection
        setting={podcasts}
        label={SETTING_LABELS['podcast-feeds']}
        render={(s) => (
          <PodcastFeedsCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />
      <SettingSection
        setting={speech}
        label={SETTING_LABELS['listen-and-learn-speech']}
        render={(s) => (
          <ListenAndLearnSpeechCard
            value={s.value}
            options={s.options}
            meta={s.meta}
            saving={s.saving}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />
    </div>
  );
}
