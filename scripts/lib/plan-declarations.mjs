/**
 * How a `DECLARED` entry in assert-expected-plan.mjs matches a plan, and how
 * it is printed.
 *
 * The policy (which changes are expected, which are declared) stays in
 * assert-expected-plan.mjs; this is the mechanics, split out alongside
 * plan-actions, plan-diff and plan-report when #816 added declarations by
 * action.
 *
 * Two shapes:
 *   `{ address, path, before, after, reason }`  one attribute of an update,
 *                                               with exactly those values (#719)
 *   `{ address, action, reason }`               a create or a delete, by exact
 *                                               address, for_each key included
 *                                               (#816); there are no values
 */
import { isDeepStrictEqual } from 'node:util';

import { render } from './plan-report.mjs';

/** One `DECLARED` entry, for the report. */
export function describeDeclaration({ address, action, path, before, after, reason }) {
  const change = action ? action : `${path}: ${render(before)} -> ${render(after)}`;
  return `${address} ${change}${reason ? ` (${reason})` : ''}`;
}

/**
 * The report lines about declarations, shared by both entry points. DECLARED
 * names what the plan matched; NOTE names what it did not. Neither fails the
 * check: a declaration the plan lacks has usually applied already.
 */
export function declarationLines({ declared = [], unused = [] }) {
  return [
    ...declared.map((d) => `DECLARED    ${describeDeclaration(d)}`),
    ...unused.map(
      (d) =>
        `NOTE        declared, not in this plan: ${describeDeclaration(d)}. Once it has ` +
        'applied, delete it from DECLARED in scripts/assert-expected-plan.mjs.'
    ),
  ];
}

/**
 * Whether one declaration covers one difference in an update. A sensitive or
 * unknown difference never matches: declaring it would mean writing its value
 * in a public file.
 */
export function matchesDeclaration(declaration, address, difference) {
  if (difference.sensitive || difference.unknown) return false;
  if (declaration?.address !== address || declaration.path !== difference.path) return false;
  const sameBefore = isDeepStrictEqual(declaration.before, difference.before);
  return sameBefore && isDeepStrictEqual(declaration.after, difference.after);
}

/** The declaration for a create or delete at exactly this address, if any. */
export function findDeclaredAction(declared, address, action) {
  if (action !== 'create' && action !== 'delete') return undefined;
  return declared.find((d) => d.action === action && d.address === address);
}
