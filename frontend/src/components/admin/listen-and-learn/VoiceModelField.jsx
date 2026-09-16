/**
 * The owner's button, per run: Best (3.1) or Economy (2.5), defaulting to
 * the stored choice on the Platform settings page. The labels and the
 * per-episode ceiling come from the server, which prices them from the same
 * table the 202 uses; if that load failed, the two ids are still offered by
 * their short names. "Stored default" is always on the list — it means
 * "send no model, let the stored default read" — so a per-run override can
 * be undone without a reload (Copilot on #462).
 *
 * Moved out of ListenAndLearnPage by #574 unchanged: the Generate tab renders
 * it per run, and the Settings tab links to where the default is set.
 */
import React from 'react';
import { GEMINI_TTS_MODEL_TIERS } from '@/lib/listenAndLearn';
import { formatCost } from './episodeView';

export default function VoiceModelField({ value, options, onChange, disabled }) {
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
        <option value="">Stored default (set on Platform settings)</option>
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
