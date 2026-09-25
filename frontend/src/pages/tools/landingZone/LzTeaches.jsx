/**
 * The teaches panel of the Landing Zone Builder (#668): the hand-written
 * explanation of one component, the one the reader last ticked, clicked in
 * the diagram or asked to read about. It follows the focus, not the
 * selection, so a learner can read what the firewall is for before adding
 * it, and can still read about it after taking it out.
 *
 * Everything shown is catalogue text from lib/landingZone/components.js and
 * the module pins from avmVersions.js; nothing here is computed from a clock
 * or a network, so the pre-rendered panel and the hydrated one agree.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AVM_MODULES, OPTIONS, componentById, isSelected } from '@/lib/landingZone';
import { listNames } from './LzControls';

/** For a component with `avm: null`: whose module call it is configuration of. */
const CONFIGURED_IN = Object.freeze({
  policy:
    'Configuration of the avm-ptn-alz call that builds the management groups, not a module of its own: selecting it turns the architecture’s assignments from DoNotEnforce to Default.',
  firewall:
    'A block of the connectivity hub’s module call (avm-ptn-alz-connectivity-hub-and-spoke-vnet), not a module of its own.',
});

/** The pinned module record behind a component's `avm`, or null. */
function moduleFor(avm) {
  if (!avm) return null;
  return Object.values(AVM_MODULES).find((m) => m.source === avm.source) ?? null;
}

const DT_CLASS =
  'text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400';
const DD_CLASS = 'text-sm text-slate-700 dark:text-slate-300';

/**
 * @param {object} props
 * @param {object} props.state  the normalised build
 * @param {string} props.componentId  the focused component; an unknown id shows the first
 */
export function LzTeaches({ state, componentId }) {
  const component = componentById(componentId) ?? componentById('management-groups');
  const selected = isSelected(state, component.id);
  const mod = moduleFor(component.avm);
  const needs = component.dependsOn.map((id) => componentById(id).label);
  const knobs = component.options.map((id) => OPTIONS[id].label);

  return (
    <Card data-testid="lz-teaches" data-component={component.id}>
      <CardHeader>
        <CardDescription className="text-xs font-semibold uppercase tracking-wider">
          {component.group === 'platform' ? 'Platform component' : 'Application component'}
        </CardDescription>
        <CardTitle className="text-xl">{component.label}</CardTitle>
        <CardDescription>{component.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {component.teaches}
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_1fr]">
          <dt className={DT_CLASS}>In this build</dt>
          <dd className={DD_CLASS} data-testid="lz-teaches-selected">
            {selected
              ? 'Selected.'
              : 'Not selected. Tick it in the build panel to add it and whatever it needs.'}
          </dd>
          <dt className={DT_CLASS}>Needs</dt>
          <dd className={DD_CLASS}>
            {needs.length
              ? `${listNames(needs)}.`
              : 'Nothing: this is where a landing zone starts.'}
          </dd>
          <dt className={DT_CLASS}>Deployed by</dt>
          <dd className={DD_CLASS}>
            {mod ? (
              <>
                <a
                  href={mod.registry}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-primary underline decoration-dotted underline-offset-2"
                >
                  {mod.source}
                </a>{' '}
                version {mod.version}, the latest on the Terraform Registry when checked on{' '}
                {mod.verifiedOn}.
              </>
            ) : (
              (CONFIGURED_IN[component.id] ??
              'Configuration inside another component’s module call, not a module of its own.')
            )}
          </dd>
          <dt className={DT_CLASS}>Knobs</dt>
          <dd className={DD_CLASS}>{knobs.length ? `${listNames(knobs)}.` : 'None.'}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
