/**
 * The Advanced view's editor for one task (ADR 0033 §4; split out of
 * RoutingTab.jsx in PR #841): a primary provider, the model it should use,
 * and a fallback chain. Every change is reported upward as a `{ type, ... }`
 * spec that `updateRoute` understands; nothing is saved here.
 */
import React from 'react';
import { ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AUTO_MODEL_VALUE,
  DEFAULT_ORDER_VALUE,
  providerLabel,
  providerUnavailable,
} from './routingModel';

const SELECT_CLASS = 'h-7 min-w-38 rounded-md border border-border bg-transparent px-2 text-xs';

/** Options for a provider select: each name, with a note when the card cannot serve. */
function ProviderOptions({ ids, providers }) {
  return ids.map((id) => (
    <option key={id} value={id}>
      {providerLabel(id, providers)}
      {providerUnavailable(id, providers) ? ' (off or no key)' : ''}
    </option>
  ));
}

function ModelSelect({ id, label, provider, value, providers, disabled, onChange }) {
  const models = providers.find((p) => p.id === provider)?.models || [];
  const unlisted = Boolean(value) && !models.includes(value);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value || AUTO_MODEL_VALUE}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={AUTO_MODEL_VALUE}>Auto (purpose table or card pin)</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {unlisted && <option value={value}>{value}</option>}
      </select>
    </div>
  );
}

/** One fallback step: its provider (only ones not already in the chain), its model, and Remove. */
function FallbackRow({ feature, entry, index, fallback, choices, providers, busy, onChange }) {
  const selectId = `route-${feature}-fallback-${index}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <label htmlFor={selectId} className="text-xs text-muted-foreground">
        Fallback {index + 1}
      </label>
      <select
        id={selectId}
        className={SELECT_CLASS}
        value={fallback.provider}
        disabled={busy}
        onChange={(e) => onChange({ type: 'fallbackProvider', index, provider: e.target.value })}
      >
        <ProviderOptions ids={choices} providers={providers} />
      </select>
      <ModelSelect
        id={`${selectId}-model`}
        label="Model"
        provider={fallback.provider}
        value={fallback.model}
        providers={providers}
        disabled={busy}
        onChange={(model) => onChange({ type: 'fallbackModel', index, model })}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={busy}
        aria-label={`Remove fallback ${index + 1} for ${entry.label}`}
        onClick={() => onChange({ type: 'removeFallback', index })}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

/** The fallback chain and, while there is room and a provider left, Add fallback. */
function FallbackChain({ feature, entry, route, providers, maxFallbacks, busy, onChange }) {
  const providerIds = providers.map((p) => p.id);
  const used = new Set([route.provider, ...(route.fallbacks || []).map((f) => f.provider)]);
  const fallbacks = route.fallbacks || [];
  const unused = providerIds.filter((id) => !used.has(id));
  const hasRoom = fallbacks.length < maxFallbacks;
  const canAdd = hasRoom && unused.length > 0;
  return (
    <div className="space-y-1.5 pl-2">
      {fallbacks.map((fallback, index) => (
        <FallbackRow
          key={`${fallback.provider}-${index}`}
          feature={feature}
          entry={entry}
          index={index}
          fallback={fallback}
          choices={providerIds.filter((id) => id === fallback.provider || !used.has(id))}
          providers={providers}
          busy={busy}
          onChange={onChange}
        />
      ))}
      {canAdd && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={() => onChange({ type: 'addFallback', provider: unused[0] })}
        >
          <Plus className="h-3 w-3" /> Add fallback
        </Button>
      )}
    </div>
  );
}

export default function RouteEditor({
  feature,
  entry,
  route,
  providers,
  maxFallbacks,
  busy,
  onChange,
}) {
  const primaryId = `route-${feature}-primary`;
  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={primaryId} className="text-xs text-muted-foreground">
          Primary
        </label>
        <select
          id={primaryId}
          className={SELECT_CLASS}
          value={route?.provider || DEFAULT_ORDER_VALUE}
          disabled={busy}
          onChange={(e) => onChange({ type: 'primary', provider: e.target.value })}
        >
          <option value={DEFAULT_ORDER_VALUE}>Use default order</option>
          <ProviderOptions ids={providers.map((p) => p.id)} providers={providers} />
        </select>
        {route && (
          <ModelSelect
            id={`route-${feature}-model`}
            label="Model"
            provider={route.provider}
            value={route.model}
            providers={providers}
            disabled={busy}
            onChange={(model) => onChange({ type: 'model', model })}
          />
        )}
        {busy && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />
        )}
      </div>
      {route && (
        <FallbackChain
          feature={feature}
          entry={entry}
          route={route}
          providers={providers}
          maxFallbacks={maxFallbacks}
          busy={busy}
          onChange={onChange}
        />
      )}
    </div>
  );
}
