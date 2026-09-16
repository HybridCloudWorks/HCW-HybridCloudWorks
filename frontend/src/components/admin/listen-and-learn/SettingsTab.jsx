/**
 * Settings — the things set once, not per run.
 *
 * The voice default is stored on Platform settings (`admin_config/
 * listen_and_learn_speech`) and is edited there, so this tab links to it rather
 * than offering a second place to change the same document — two editors over
 * one setting is how they drift. What belongs here is the explanation an
 * operator needs before following the link.
 */
import React from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { GEMINI_TTS_MODEL_TIERS } from '@/lib/listenAndLearn';
import { formatCost } from './episodeView';

export default function SettingsTab({ hub }) {
  const { speechOptions, storedModel } = hub;
  const priced = speechOptions?.length
    ? speechOptions
    : Object.entries(GEMINI_TTS_MODEL_TIERS).map(([id, label]) => ({ id, label }));

  return (
    <div className="space-y-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Listen &amp; Learn is read by <strong>Gemini TTS</strong>, with Azure AI Speech as the
            fallback — never ElevenLabs, which is the podcast voice (owner rule 2026-09-09, ADR 0029
            §2b). The server enforces that per product, so it cannot be changed here by accident.
          </p>
          <p className="text-muted-foreground">
            The stored default model is{' '}
            {storedModel ? (
              <code className="text-foreground">{storedModel}</code>
            ) : (
              <span className="text-foreground">not loaded</span>
            )}
            . It applies to any run that names no model; the Generate tab can override it for one
            run without changing it.
          </p>
          <ul className="space-y-1 text-muted-foreground">
            {priced.map((choice) => (
              <li key={choice.id}>
                <span className="text-foreground">{choice.label}</span> — <code>{choice.id}</code>
                {typeof choice.perEpisodeUsd === 'number'
                  ? ` · up to ${formatCost(choice.perEpisodeUsd)} an episode`
                  : ''}
              </li>
            ))}
          </ul>
          <p>
            <Link
              to="/admin/platform-settings?tab=ai"
              className="text-primary underline underline-offset-4"
            >
              Change the default on Platform settings
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grounding sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Certification episodes are grounded on the exam&apos;s official study guide and nothing
            else. That is deliberate: a single outdated video demonstrating a retired portal flow
            would otherwise be laundered into an episode that sounds authoritative, and exam prep is
            exactly the context where confidently wrong is worse than absent.
          </p>
          <p>
            Owner-supplied pages and videos (#433) are added per set on the{' '}
            <strong>Generate</strong> tab, where the run they affect is in view.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
