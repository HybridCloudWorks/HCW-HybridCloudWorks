/**
 * A book's voice (ADR 0033 §4): which provider reads it, which Gemini model,
 * which voice per host and for a narrator, the language and the speaking
 * rate. Rendered inside the book dialog; the catalogue of voices, models and
 * providers comes from `GET cms/listen-and-learn/speech-options` so the
 * choices are the server's, not a list kept here.
 *
 * Native `<select>` and `<input>` elements with labels, so every control is
 * keyboard-operable and named without a component library in between.
 */
import React from 'react';
import { Input } from '@/components/ui/input';

const field = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const FALLBACK_RATE = { min: 0.5, max: 2, default: 1 };

/** The voices for a provider, as options; a current value not in the list is kept so a saved pick never vanishes. */
function VoiceSelect({ id, label, value, voices, onChange, allowAny }) {
  if (allowAny) {
    return (
      <label htmlFor={id} className="block space-y-1 text-xs font-medium">
        <span>{label}</span>
        <Input
          id={id}
          list={`${id}-list`}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="en-US-AvaNeural"
        />
        <datalist id={`${id}-list`}>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id} />
          ))}
        </datalist>
      </label>
    );
  }
  const known = voices.some((v) => v.id === value);
  return (
    <label htmlFor={id} className="block space-y-1 text-xs font-medium">
      <span>{label}</span>
      <select
        id={id}
        className={field}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {!known && value && <option value={value}>{value}</option>}
        {voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.id}
            {voice.descriptor ? ` — ${voice.descriptor}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProviderAndModel({ voice, catalog, idPrefix, set }) {
  const provider = voice.provider || 'auto';
  const azure = provider === 'azure';
  const models = catalog?.models || [];
  const providers = (catalog?.speech?.providers || []).filter((p) => p.allowed);
  const wouldRun = catalog?.speech?.wouldRun;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${idPrefix}-provider`} className="block space-y-1 text-xs font-medium">
        <span>Provider</span>
        <select
          id={`${idPrefix}-provider`}
          className={field}
          value={provider}
          onChange={(e) => set({ provider: e.target.value })}
        >
          <option value="auto">Automatic{wouldRun ? ` (today: ${wouldRun})` : ''}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
              {p.configured ? '' : ' — not configured'}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-model`} className="block space-y-1 text-xs font-medium">
        <span>Gemini model</span>
        <select
          id={`${idPrefix}-model`}
          className={field}
          value={voice.model || ''}
          disabled={azure}
          onChange={(e) => set({ model: e.target.value || null })}
        >
          <option value="">
            Stored default{catalog?.effectiveModel ? ` (${catalog.effectiveModel})` : ''}
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.isDefault ? ' · default' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LanguageAndRate({ voice, catalog, idPrefix, set }) {
  const azure = (voice.provider || 'auto') === 'azure';
  const rate = catalog?.speakingRate || FALLBACK_RATE;
  const current = voice.speakingRate ?? rate.default;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${idPrefix}-language`} className="block space-y-1 text-xs font-medium">
        <span>Language (BCP 47)</span>
        <Input
          id={`${idPrefix}-language`}
          value={voice.language || ''}
          onChange={(e) => set({ language: e.target.value })}
          placeholder="en-US"
        />
      </label>
      <label htmlFor={`${idPrefix}-rate`} className="block space-y-1 text-xs font-medium">
        <span>
          Speaking rate ({current}×)
          {azure ? '' : ' — Gemini reads at its own pace; Azure honours this'}
        </span>
        <input
          id={`${idPrefix}-rate`}
          type="range"
          min={rate.min}
          max={rate.max}
          step="0.05"
          value={current}
          onChange={(e) => set({ speakingRate: Number(e.target.value) })}
          className="w-full"
        />
      </label>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.value the voice settings object
 * @param {(next: object) => void} props.onChange
 * @param {object|null} props.catalog the speech-options response
 * @param {string} [props.idPrefix]
 */
export default function VoiceSettingsFields({ value, onChange, catalog, idPrefix = 'voice' }) {
  const voice = value || {};
  const azure = (voice.provider || 'auto') === 'azure';
  const voices = azure ? catalog?.voices?.azure || [] : catalog?.voices?.gemini || [];
  const set = (patch) => onChange({ ...voice, ...patch });
  const speakers = voice.speakers || {};

  return (
    <div className="space-y-3">
      <ProviderAndModel voice={voice} catalog={catalog} idPrefix={idPrefix} set={set} />
      <div className="grid gap-3 sm:grid-cols-3">
        <VoiceSelect
          id={`${idPrefix}-maya`}
          label="Host Maya"
          value={speakers.Maya}
          voices={voices}
          allowAny={azure}
          onChange={(v) => set({ speakers: { ...speakers, Maya: v } })}
        />
        <VoiceSelect
          id={`${idPrefix}-elena`}
          label="Host Elena"
          value={speakers.Elena}
          voices={voices}
          allowAny={azure}
          onChange={(v) => set({ speakers: { ...speakers, Elena: v } })}
        />
        <VoiceSelect
          id={`${idPrefix}-narrator`}
          label="Narrator (text chapters)"
          value={voice.narrator}
          voices={voices}
          allowAny={azure}
          onChange={(v) => set({ narrator: v })}
        />
      </div>
      <LanguageAndRate voice={voice} catalog={catalog} idPrefix={idPrefix} set={set} />
    </div>
  );
}
