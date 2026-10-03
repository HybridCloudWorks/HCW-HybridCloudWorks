/**
 * Settings — the things set once, not per run (ADR 0033 §4).
 *
 * The voice default is stored on Platform settings (`admin_config/
 * listen_and_learn_speech`) and is edited there, so this tab links to it rather
 * than offering a second place to change the same document — two editors over
 * one setting is how they drift. What belongs here is what the server says
 * about speech today: which model reads when nothing is chosen and what it
 * costs, which voices a book may pick, which providers are configured and
 * which would run, and the fallback rules — read from
 * `GET cms/listen-and-learn/speech-options`, never described from memory.
 */
import React, { useState } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { GEMINI_TTS_MODEL_TIERS } from '@/lib/listenAndLearn';
import { formatCost } from './episodeView';

/** One line per provider: its state in the shared vocabulary, and why. */
function providerState(provider) {
  if (!provider.allowed) {
    return { system: 'unknown', note: `not for Listen & Learn — ${provider.reason}` };
  }
  if (provider.configured) return { system: 'healthy', note: 'configured' };
  return { system: 'misconfigured', note: `not configured — needs ${provider.requirement}` };
}

function ProviderRow({ provider, wouldRun }) {
  const { system, note } = providerState(provider);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <code className="text-foreground">{provider.id}</code>
      <StatusBadge system={system} size="xs" />
      {provider.id === wouldRun && (
        <Badge variant="default" className="text-[10px]">
          runs today
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">{note}</span>
    </li>
  );
}

/**
 * The models to list: the catalogue's (which mark the default), else the
 * Platform settings route's, else the two ids by their short names.
 */
function pricedModels(catalog, speechOptions) {
  if (catalog?.models?.length) return catalog.models;
  if (speechOptions?.length) return speechOptions;
  return Object.entries(GEMINI_TTS_MODEL_TIERS).map(([id, label]) => ({ id, label }));
}

/** Which model reads when nothing chooses one, where that comes from, and what it costs. */
function DefaultModelLine({ catalog, effective, option }) {
  if (catalog?.error) return <>Speech options could not be read: {catalog.error}</>;
  if (!effective) return <>Loading the speech options…</>;
  const origin = catalog?.storedModel
    ? ' (stored on Platform settings)'
    : ' — the cheapest sensible voice, the default when nothing is stored';
  const price =
    typeof option?.perEpisodeUsd === 'number'
      ? `, at up to ${formatCost(option.perEpisodeUsd)} an episode`
      : '';
  return (
    <>
      When nothing chooses a model, <code className="text-foreground">{effective}</code> reads
      {origin}
      {price}. A run can override it for itself on the Generate tab; a book can override it for
      itself in its voice settings.
    </>
  );
}

export default function SettingsTab({ hub }) {
  const { speechOptions, storedModel, catalog } = hub;
  const [advanced, setAdvanced] = useState(false);
  const priced = pricedModels(catalog, speechOptions);
  const effective = catalog?.effectiveModel || storedModel || null;
  const effectiveOption = priced.find((m) => m.id === effective);
  const speech = catalog?.speech;

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice and cost</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Listen &amp; Learn is read by <strong>Gemini TTS</strong>, with Azure AI Speech as the
            fallback — never ElevenLabs, which is the podcast voice (owner rule 2026-09-09, ADR 0029
            §2b). The server enforces that per product, so it cannot be changed here by accident.
          </p>
          <p className="text-muted-foreground">
            <DefaultModelLine catalog={catalog} effective={effective} option={effectiveOption} />
          </p>
          <ul className="space-y-1 text-muted-foreground">
            {priced.map((choice) => (
              <li key={choice.id}>
                <span className="text-foreground">{choice.label}</span> — <code>{choice.id}</code>
                {typeof choice.perEpisodeUsd === 'number'
                  ? ` · up to ${formatCost(choice.perEpisodeUsd)} an episode`
                  : ''}
                {choice.isDefault ? ' · the default' : ''}
              </li>
            ))}
          </ul>
          <p>
            <Link
              to="/admin/platform?tab=audio"
              className="text-primary underline underline-offset-4"
            >
              Change the stored default on Platform settings
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Each book chooses its voices in its own settings (Library → Edit book → Voice): one per
            host for a dialogue, one narrator for a chapter read from text, a language, and a
            speaking rate. Gemini offers the voices below; Azure takes any of its neural voice
            names. Speaking rate applies on Azure; Gemini reads at its own pace.
          </p>
          {catalog?.voices?.gemini?.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Gemini voices">
              {catalog.voices.gemini.map((voice) => (
                <li key={voice.id}>
                  <Badge variant="outline" className="text-[10px]" title={voice.descriptor}>
                    {voice.id}
                    {voice.descriptor ? ` · ${voice.descriptor}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where audio lives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every take is its own file, stamped with the time it was made, so regenerating never
            overwrites the one before it and a listener&apos;s cache cannot hold a stale take. Older
            files without a stamp are served with a five-minute cache instead.
          </p>
          <p>
            Audio files are served anonymously by path, drafts included: the review gate is on the
            chapter document, which is what the site lists, not on the bytes. Do not read anything
            into a chapter you would not want reachable by someone who guesses its address.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              aria-controls="speech-advanced"
              className="flex items-center gap-2"
            >
              {advanced ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
              Advanced — providers and fallback
            </button>
          </CardTitle>
        </CardHeader>
        {advanced && (
          <CardContent id="speech-advanced" className="space-y-3 text-sm text-muted-foreground">
            {speech ? (
              <>
                <p>
                  Order for Listen &amp; Learn: <code>{speech.order.join(' → ')}</code>. The first
                  configured one runs unless <code>{speech.pin.setting}</code> pins one
                  {speech.pin.value ? (
                    <>
                      {' '}
                      (pinned to <code>{speech.pin.value}</code>)
                    </>
                  ) : (
                    ' (not pinned)'
                  )}
                  ; a pin that is not configured fails rather than falling through, and a
                  book&apos;s own provider choice outranks the pin under the same rule. Nothing
                  falls back to ElevenLabs.
                </p>
                {speech.pinError && (
                  <p role="alert" className="text-destructive">
                    {speech.pinError}
                  </p>
                )}
                <ul className="space-y-1.5">
                  {speech.providers.map((provider) => (
                    <ProviderRow key={provider.id} provider={provider} wouldRun={speech.wouldRun} />
                  ))}
                </ul>
                {!speech.wouldRun && !speech.pinError && (
                  <p>
                    No provider is configured: runs save transcripts with no audio until a key
                    lands.
                  </p>
                )}
              </>
            ) : (
              <p>
                {catalog?.error ? `Could not read the providers: ${catalog.error}` : 'Loading…'}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grounding sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Certification lessons are grounded on the exam&apos;s official study guide and nothing
            else. That is deliberate: a single outdated video demonstrating a retired portal flow
            would otherwise be laundered into an episode that sounds authoritative, and exam prep is
            exactly the context where confidently wrong is worse than absent.
          </p>
          <p>
            Owner-supplied pages and videos (#433) are added per course on the{' '}
            <strong>Generate</strong> tab, where the run they affect is in view. A book&apos;s
            chapters are your own text, read as written.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
