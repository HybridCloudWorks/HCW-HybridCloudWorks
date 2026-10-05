/**
 * The Custom mode's chain editor for one task (ADR 0034 §4, slice 4, #859):
 * up to four (provider → model) rows, the model select filtered by the
 * task's `needs` through the catalogue's capabilities, and the "then the
 * Priority list" switch. Every change is reported upward as a `{ type, … }`
 * change `updateChain` understands; nothing is saved here.
 */
import React from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { selectableModelsFor } from '@/lib/aiEngine/catalog';
import { MAX_CHAIN, PROVIDER_DEFAULT, providerLabel } from './selectionModel';

const SELECT_CLASS = 'h-7 min-w-36 rounded-md border border-border bg-transparent px-2 text-xs';

function ChainRow({ task, label, index, step, choices, models, providers, disabled, onChange }) {
  const providerId = `chain-${task}-${index}-provider`;
  const modelId = `chain-${task}-${index}-model`;
  const unlisted = Boolean(step.model) && !models.includes(step.model);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <label htmlFor={providerId} className="text-xs text-muted-foreground">
        Step {index + 1}
      </label>
      <select
        id={providerId}
        className={SELECT_CLASS}
        value={step.provider}
        disabled={disabled}
        onChange={(e) => onChange({ type: 'provider', index, provider: e.target.value })}
      >
        {choices.map((id) => (
          <option key={id} value={id}>
            {providerLabel(id, providers)}
          </option>
        ))}
      </select>
      <label htmlFor={modelId} className="text-xs text-muted-foreground">
        Model
      </label>
      <select
        id={modelId}
        className={SELECT_CLASS}
        value={step.model || PROVIDER_DEFAULT}
        disabled={disabled}
        onChange={(e) => onChange({ type: 'model', index, model: e.target.value })}
      >
        <option value={PROVIDER_DEFAULT}>Provider default</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {unlisted && <option value={step.model}>{step.model} (not listed)</option>}
      </select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={disabled}
        aria-label={`Remove step ${index + 1} for ${label}`}
        onClick={() => onChange({ type: 'remove', index })}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

/**
 * @param {{
 *   task: string, label: string, needs: string[],
 *   chain: Array<{provider: string, model: string|null}>, thenGlobal: boolean,
 *   providers: Array<{id: string, name?: string}>, catalog: object|null,
 *   disabled?: boolean,
 *   onChain: (change: object) => void, onThenGlobal: (value: boolean) => void,
 * }} props
 */
export default function TaskChainEditor({
  task,
  label,
  needs,
  chain,
  thenGlobal,
  providers,
  catalog,
  disabled = false,
  onChain,
  onThenGlobal,
}) {
  const ids = providers.map((p) => p.id);
  const used = new Set(chain.map((s) => s.provider));
  const unused = ids.filter((id) => !used.has(id));
  return (
    <div className="space-y-2 pl-2" data-testid={`chain-editor-${task}`}>
      {chain.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No step yet. Add one, or the task falls to the Priority list.
        </p>
      )}
      {chain.map((step, index) => (
        <ChainRow
          key={`${step.provider}-${index}`}
          task={task}
          label={label}
          index={index}
          step={step}
          choices={ids.filter((id) => id === step.provider || !used.has(id))}
          models={selectableModelsFor(catalog, step.provider, needs)}
          providers={providers}
          disabled={disabled}
          onChange={onChain}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {chain.length < MAX_CHAIN && unused.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={disabled}
            onClick={() => onChain({ type: 'add', provider: unused[0] })}
          >
            <Plus className="h-3 w-3" /> Add step
          </Button>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={thenGlobal}
            disabled={disabled}
            onCheckedChange={onThenGlobal}
            aria-label={`Then the Priority list for ${label}`}
          />
          <span aria-hidden="true">then the Priority list</span>
        </div>
      </div>
    </div>
  );
}
