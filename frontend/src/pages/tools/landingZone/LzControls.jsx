/**
 * The build panel of the Landing Zone Builder (#668): a checkbox per
 * component, grouped platform and application, a count for each kind of
 * application landing zone, and one knob per option. Every change is a state
 * function from lib/landingZone (addComponent, removeWithDependents,
 * setOption) written back to the URL, so the panel never holds the build.
 *
 * DEPENDENCIES IN WORDS. A component says what it needs before it is ticked
 * ("Ticking it also adds Connectivity hub") and what it drags out after
 * ("Unticking it also removes Azure Firewall"), because the rule is enforced
 * silently by the state module and a learner should see it coming rather
 * than watch boxes change on their own. Warnings the state raises, such as
 * a spoke range moved off the hub, are printed as a sentence, not a colour.
 *
 * NATIVE CONTROLS, for the reason the pricing pages give: they work in the
 * pre-rendered HTML before any script has run and need no portal. The only
 * local state is a text knob's draft while it is being typed, so an invalid
 * or half-typed CIDR neither snaps back nor reaches the URL, and the notice
 * from the last write, kept so a range the state moved can be explained
 * after the URL has settled on the moved value.
 */
import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  APPLICATION_IDS,
  COMPONENTS,
  DEFAULT_STATE,
  HUB_PREFIX_RANGE,
  MAX_LANDING_ZONES,
  OPTIONS,
  OPTION_CHOICES,
  OPTION_IDS,
  PLATFORM_IDS,
  SPOKE_PREFIX_RANGE,
  addComponent,
  componentById,
  countOptionFor,
  dependentsOf,
  encodeLz,
  isSelected,
  removeWithDependents,
  setOption,
} from '@/lib/landingZone';
import { CopyLinkButton } from '../scenario/ScenarioControls';
import { HINT_CLASS, LABEL_CLASS, NATIVE_INPUT_CLASS, NATIVE_SELECT_CLASS } from './styles';

/** "A", "A and B", "A, B and C". */
export function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const labelOf = (id) => componentById(id).label;

/** What a text knob refuses, in the words of its validator. */
const INVALID_TEXT = Object.freeze({
  location: 'A region id is lowercase letters and digits, such as centralus or westeurope.',
  rootParentId:
    'A management group id is letters, digits, hyphen, underscore, period or parentheses, up to 90 characters, starting with a letter or digit. Empty means the tenant root group.',
  hubCidr: `An address space is an IPv4 range in CIDR form with a prefix from /${HUB_PREFIX_RANGE[0]} to /${HUB_PREFIX_RANGE[1]}, such as 10.0.0.0/16.`,
  spokeCidr: `A spoke range is an IPv4 range in CIDR form with a prefix from /${SPOKE_PREFIX_RANGE[0]} to /${SPOKE_PREFIX_RANGE[1]}, such as 10.1.0.0/16.`,
});

/** Each warning code the state module raises, as a sentence. */
const WARNING_TEXT = Object.freeze({
  'spoke-cidr-overlap': (w) =>
    `The spoke range ${w.from} overlaps the hub address space, so this build carves its spokes from ${w.to} instead. Change the hub or the spoke range to end the overlap.`,
});

export function warningText(warning) {
  const render = WARNING_TEXT[warning.code];
  return render ? render(warning) : `The build was adjusted (${warning.code}).`;
}

const ROW_CLASS = 'flex flex-col gap-1 border-t border-slate-200 py-3 dark:border-slate-700';

function CountSelect({ component, value, onChange }) {
  const id = `lz-count-${component.id}`;
  return (
    <label htmlFor={id} className="ml-auto flex items-center gap-2 text-xs">
      Count
      <select
        id={id}
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`${NATIVE_SELECT_CLASS} h-8 py-0`}
        aria-label={`Number of ${component.label.toLowerCase()}s`}
      >
        {Array.from({ length: MAX_LANDING_ZONES + 1 }, (_, n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComponentRow({ component, state, focused, onToggle, onFocus, onCount }) {
  const selected = isSelected(state, component.id);
  const needs = component.dependsOn.map(labelOf);
  const pulls = component.dependsOn.filter((id) => !isSelected(state, id)).map(labelOf);
  const drags = dependentsOf(component.id)
    .filter((id) => isSelected(state, id))
    .map(labelOf);
  const countId = countOptionFor(component.id);
  const inputId = `lz-component-${component.id}`;

  let dependencyNote = null;
  if (needs.length) {
    dependencyNote = `Needs ${listNames(needs)}.`;
    if (!selected && pulls.length) dependencyNote += ` Ticking it also adds ${listNames(pulls)}.`;
  }

  return (
    <div
      className={ROW_CLASS}
      data-component={component.id}
      data-selected={selected ? 'true' : 'false'}
      data-focused={focused ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(component.id, event.target.checked)}
        />
        <label htmlFor={inputId} className={LABEL_CLASS}>
          {component.label}
        </label>
        {countId ? (
          <CountSelect
            component={component}
            value={state.options[countId]}
            onChange={(n) => onCount(countId, n)}
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-7 px-2 text-xs ${countId ? '' : 'ml-auto'}`}
          aria-pressed={focused}
          onClick={() => onFocus(component.id)}
        >
          Read about
        </Button>
      </div>
      <p className={HINT_CLASS}>{component.summary}</p>
      {dependencyNote ? <p className={HINT_CLASS}>{dependencyNote}</p> : null}
      {selected && drags.length ? (
        <p className={HINT_CLASS}>Unticking it also removes {listNames(drags)}.</p>
      ) : null}
    </div>
  );
}

/**
 * A free-text knob. The draft is local so a half-typed range does not reach
 * the URL; a value that passes the validator commits on every keystroke and
 * an invalid one is explained in words beneath the field, then discarded on
 * blur. `onCommit` returns the value the state settled on, which may differ
 * from the text (a spoke range that overlapped the hub is moved), so the
 * draft is tracked against that and the moved value shows once typing ends.
 */
function TextKnob({ id, spec, value, disabled, inputId, helpId, onCommit }) {
  const [draft, setDraft] = useState(null);
  const live = draft !== null && draft.against === value;
  const shown = live ? draft.text : value;
  const invalid = live && !spec.validate(draft.text);
  return (
    <>
      <input
        id={inputId}
        type="text"
        value={shown}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={helpId}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const text = event.target.value;
          if (spec.validate(text)) setDraft({ text, against: onCommit(text) });
          else setDraft({ text, against: value });
        }}
        onBlur={() => setDraft(null)}
        className={`${NATIVE_INPUT_CLASS} w-56`}
      />
      {invalid ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Not applied. {INVALID_TEXT[id]}
        </p>
      ) : null}
    </>
  );
}

function OptionKnob({ id, state, commit }) {
  const spec = OPTIONS[id];
  const owners = COMPONENTS.filter((c) => c.options.includes(id));
  const active = owners.some((c) => isSelected(state, c.id));
  const value = state.options[id];
  const inputId = `lz-option-${id}`;
  const helpId = `${inputId}-help`;
  const ownerNames = listNames(owners.map((c) => c.label));
  const ownerNote = active
    ? `Used by ${ownerNames}.`
    : `Used by ${ownerNames}, none of which is in this build, so it has no effect until one is.`;

  let control;
  if (spec.kind === 'choice') {
    control = (
      <select
        id={inputId}
        value={value}
        disabled={!active}
        aria-describedby={helpId}
        onChange={(event) => commit(setOption(state, id, event.target.value))}
        className={NATIVE_SELECT_CLASS}
      >
        {OPTION_CHOICES[id].map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  } else if (spec.kind === 'boolean') {
    control = (
      <input
        id={inputId}
        type="checkbox"
        checked={value}
        disabled={!active}
        aria-describedby={helpId}
        onChange={(event) => commit(setOption(state, id, event.target.checked))}
      />
    );
  } else {
    control = (
      <TextKnob
        id={id}
        spec={spec}
        value={value}
        disabled={!active}
        inputId={inputId}
        helpId={helpId}
        onCommit={(text) => {
          const next = setOption(state, id, text);
          commit(next, { replace: true });
          return next.options[id];
        }}
      />
    );
  }

  return (
    <div className={ROW_CLASS} data-option={id} data-active={active ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`${LABEL_CLASS} w-44`}>
          {spec.label}
        </label>
        {control}
      </div>
      <p id={helpId} className={HINT_CLASS}>
        {spec.help}
      </p>
      <p className={HINT_CLASS}>{ownerNote}</p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.state  the normalised build, from useLzState
 * @param {(next: object, options?: { replace?: boolean }) => void} props.write
 * @param {string} props.focusedId  the component the teaches panel shows
 * @param {(id: string) => void} props.onFocus
 */
export function LzControls({ state, write, focusedId, onFocus }) {
  // The warnings of the last write, so a spoke range the state moved is
  // still explained once the URL carries only the moved value.
  const [notice, setNotice] = useState([]);
  const commit = (next, options) => {
    setNotice(next.warnings ?? []);
    write(next, options);
  };
  const warnings = state.warnings.length ? state.warnings : notice;
  const isDefault = Object.keys(encodeLz(state)).length === 0;

  const toggle = (id, on) => {
    commit(on ? addComponent(state, id) : removeWithDependents(state, id));
    onFocus(id);
  };

  const row = (id) => (
    <ComponentRow
      key={id}
      component={componentById(id)}
      state={state}
      focused={focusedId === id}
      onToggle={toggle}
      onFocus={onFocus}
      onCount={(optionId, n) => commit(setOption(state, optionId, n))}
    />
  );

  return (
    <Card data-testid="lz-controls">
      <CardHeader>
        <CardTitle className="text-xl">Build</CardTitle>
        <CardDescription>
          Tick a component to add it and whatever it needs; untick one and everything that needs it
          leaves with it. The build is in this page&rsquo;s address, so the link is the landing
          zone.
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <CopyLinkButton />
          {isDefault ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => commit(DEFAULT_STATE)}
              data-testid="lz-reset"
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Reset to the full
              landing zone
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {warnings.length ? (
          <div role="status" data-testid="lz-warnings" className="flex flex-col gap-1">
            {warnings.map((w) => (
              <p
                key={`${w.code}:${w.from}:${w.to}`}
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                Note: {warningText(w)}
              </p>
            ))}
          </div>
        ) : null}

        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Platform, built once
          </legend>
          {PLATFORM_IDS.map(row)}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Application landing zones, one per team
          </legend>
          {APPLICATION_IDS.map(row)}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Options
          </legend>
          {OPTION_IDS.filter((id) => OPTIONS[id].kind !== 'count').map((id) => (
            <OptionKnob key={id} id={id} state={state} commit={commit} />
          ))}
        </fieldset>
      </CardContent>
    </Card>
  );
}
