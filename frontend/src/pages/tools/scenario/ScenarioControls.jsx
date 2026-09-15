/**
 * The controls of the scenario card (#613, Phase 2): which shape, how much of
 * each service, which extras, how much egress, and a button that copies the
 * URL all of that is encoded in.
 *
 * NATIVE CONTROLS THROUGHOUT, for the reason Phase 1 gave for its region
 * select: they work in the pre-rendered HTML before any script has run, need
 * no portal, and are what a phone already knows how to open. The extras
 * "pull-down" is a <details> element for the same reason — a disclosure the
 * browser owns, with real checkboxes and radios inside it.
 *
 * NOTHING HERE HOLDS STATE except a quantity row's draft while it is being
 * typed and the copy button's "Copied" flash. Everything else is read from
 * the URL and written back to it through useScenarioState.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Check, Link as LinkIcon, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  EGRESS_PRESETS,
  EXTRAS,
  SCENARIOS,
  SERVICES,
  effectiveQuantities,
  formatQuantity,
  groupChoice,
  scenarioById,
  scenarioQuantities,
  setExtra,
  setGroupChoice,
} from '@/lib/pricingScenarios';
import { NATIVE_INPUT_CLASS, NATIVE_SELECT_CLASS } from './styles';

const LABEL_CLASS = 'text-sm font-medium';
const HINT_CLASS = 'text-[11px] text-slate-600 dark:text-slate-400';

export function ScenarioSelect({ scenarioId, onChange }) {
  const scenario = scenarioById(scenarioId);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label htmlFor="scenario-shape" className={LABEL_CLASS}>
          Scenario
        </label>
        <select
          id="scenario-shape"
          value={scenario.id}
          onChange={(event) => onChange(event.target.value)}
          className={`${NATIVE_SELECT_CLASS} min-w-48`}
        >
          {SCENARIOS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className={HINT_CLASS}>{scenario.blurb}</p>
    </div>
  );
}

/**
 * One editable quantity. The draft is local so an emptied field does not
 * become 0 in the URL and snap back; a finite non-negative number commits on
 * every keystroke, and blur discards whatever did not parse. The draft
 * remembers which value it was typed against, so a Reset (or a scenario
 * change) that moves the value underneath it shows the new value rather than
 * the stale text.
 */
function QuantityRow({ service, value, defaultValue, note, onChange, onReset }) {
  const [draft, setDraft] = useState(null);
  const id = `qty-${service.id}`;
  const overridden = value !== defaultValue;
  const shown = draft && draft.against === value ? draft.text : String(value);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-slate-200 dark:border-slate-700 ${
        value === 0 && !overridden ? 'opacity-70' : ''
      }`}
      data-quantity={service.id}
      data-overridden={overridden ? 'true' : undefined}
    >
      <label htmlFor={id} className={`${LABEL_CLASS} w-40`}>
        {service.label}
      </label>
      <input
        id={id}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={shown}
        onChange={(event) => {
          const text = event.target.value;
          const n = Number(text);
          const valid = text !== '' && Number.isFinite(n) && n >= 0;
          // A committed number is the value from now on; the draft only has
          // to survive against it (so "14." keeps its dot) or, when nothing
          // committed, against the value that is still there.
          setDraft({ text, against: valid ? n : value });
          if (valid && n !== value) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        className={NATIVE_INPUT_CLASS}
      />
      <span className="text-sm text-slate-600 dark:text-slate-400">{service.unit}</span>
      {note ? <span className={HINT_CLASS}>{note}</span> : null}
      {overridden ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-7 px-2 text-xs"
          aria-label={`Reset ${service.label} to ${formatQuantity(defaultValue)}`}
        >
          <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> Reset
        </Button>
      ) : null}
    </div>
  );
}

export function QuantityEditor({ scenarioId, overrides, onChange }) {
  const scenario = scenarioById(scenarioId);
  const defaults = scenarioQuantities(scenario.id);
  const effective = effectiveQuantities(scenario.id, overrides);
  const summary = SERVICES.filter((service) => effective[service.id] > 0)
    .map(
      (service) => `${formatQuantity(effective[service.id])} ${service.shortUnit} ${service.label}`
    )
    .join(' · ');
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-sm">
        <span className="font-medium underline decoration-dotted underline-offset-2">
          Edit quantities
        </span>
        <span className="ml-2 text-slate-600 dark:text-slate-400">{summary || 'nothing yet'}</span>
      </summary>
      <div className="mt-2">
        {SERVICES.map((service) => (
          <QuantityRow
            key={service.id}
            service={service}
            value={effective[service.id]}
            defaultValue={defaults[service.id]}
            note={scenario.notes[service.id]}
            onChange={(n) => onChange({ ...overrides, [service.id]: n })}
            onReset={() => {
              const next = { ...overrides };
              delete next[service.id];
              onChange(next);
            }}
          />
        ))}
      </div>
    </details>
  );
}

const DR_LEVELS = EXTRAS.filter((extra) => extra.group === 'dr');
const COMMIT_TERMS = EXTRAS.filter((extra) => extra.group === 'commit');
const INDEPENDENT = EXTRAS.filter((extra) => extra.group === null);

function RadioGroup({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {legend}
      </legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          value=""
          checked={value === null}
          onChange={() => onChange(null)}
        />
        None
      </label>
      {options.map((extra) => (
        <label key={extra.id} className="flex items-center gap-2 text-sm" title={extra.blurb}>
          <input
            type="radio"
            name={name}
            value={extra.id}
            checked={value === extra.id}
            onChange={() => onChange(extra.id)}
          />
          {extra.label}
        </label>
      ))}
    </fieldset>
  );
}

/** The extras pull-down: two checkboxes, a DR radio group, a commitment radio group. */
export function ExtrasMenu({ extras, onChange }) {
  return (
    <details className="relative">
      <summary
        className={`${NATIVE_SELECT_CLASS} inline-flex cursor-pointer list-none items-center gap-2 select-none`}
        data-testid="extras-summary"
      >
        Extras
        <span className="rounded-full bg-slate-200 px-2 text-xs tabular-nums dark:bg-slate-700">
          {extras.length}
        </span>
      </summary>
      <div className="absolute left-0 z-20 mt-2 flex w-72 flex-col gap-4 rounded-md border border-slate-200 bg-background p-4 shadow-md dark:border-slate-700">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Protection
          </legend>
          {INDEPENDENT.map((extra) => (
            <label key={extra.id} className="flex items-center gap-2 text-sm" title={extra.blurb}>
              <input
                type="checkbox"
                checked={extras.includes(extra.id)}
                onChange={(event) => onChange(setExtra(extras, extra.id, event.target.checked))}
              />
              {extra.label}
            </label>
          ))}
        </fieldset>
        <RadioGroup
          legend="Disaster recovery"
          name="scenario-dr"
          options={DR_LEVELS}
          value={groupChoice(extras, 'dr')}
          onChange={(id) => onChange(setGroupChoice(extras, 'dr', id))}
        />
        <RadioGroup
          legend="Commitment"
          name="scenario-commit"
          options={COMMIT_TERMS}
          value={groupChoice(extras, 'commit')}
          onChange={(id) => onChange(setGroupChoice(extras, 'commit', id))}
        />
      </div>
    </details>
  );
}

export function EgressSelect({ egressGb, onChange }) {
  const custom = !EGRESS_PRESETS.includes(egressGb);
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="scenario-egress" className={LABEL_CLASS}>
        Egress
      </label>
      <select
        id="scenario-egress"
        value={String(egressGb)}
        onChange={(event) => onChange(Number(event.target.value))}
        className={NATIVE_SELECT_CLASS}
      >
        {custom ? (
          <option value={String(egressGb)}>{formatQuantity(egressGb)} GB (custom)</option>
        ) : null}
        {EGRESS_PRESETS.map((gb) => (
          <option key={gb} value={String(gb)}>
            {formatQuantity(gb)} GB / month
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Copies the page URL, which carries the whole scenario. When the clipboard
 * is unavailable (no permission, an insecure context) the link is shown in a
 * field instead, so the reader still leaves with it.
 */
export function CopyLinkButton() {
  const location = useLocation();
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const href = () =>
    `${typeof window === 'undefined' ? '' : window.location.origin}${location.pathname}${location.search}`;

  const copy = async () => {
    let next = 'failed';
    try {
      await navigator.clipboard.writeText(href());
      next = 'copied';
    } catch {
      next = 'failed';
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 4000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy} data-copy-state={state}>
        {state === 'copied' ? (
          <Check className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <LinkIcon className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        )}
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </Button>
      {state === 'failed' ? (
        <label className="flex items-center gap-2 text-xs">
          Copy this link by hand:
          <input
            readOnly
            value={href()}
            className={`${NATIVE_INPUT_CLASS} w-64`}
            onFocus={(e) => e.target.select()}
          />
        </label>
      ) : null}
    </div>
  );
}
