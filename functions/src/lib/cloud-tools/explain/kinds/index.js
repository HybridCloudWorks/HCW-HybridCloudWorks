/**
 * The kinds of POST public/cloud-tools/explain (#669): one anonymous AI
 * route, one cache, one pair of counters — and a `kind` discriminator in the
 * body that picks which validator, prompt and feature toggle serve the
 * request. `pricing` is the default and the original; `landing-zone` is the
 * Landing Zone Builder's "Explain this component". The shape a kind has is
 * documented on PRICING_KIND in pricing.js.
 */

import { LANDING_ZONE_KIND } from './landingZone.js';
import { PRICING_KIND, PRICING_KIND_ID } from './pricing.js';

export const DEFAULT_EXPLAIN_KIND = PRICING_KIND_ID;

/** Every kind, by the `kind` value the request carries. */
export const EXPLAIN_KINDS = Object.freeze({
  [PRICING_KIND.id]: PRICING_KIND,
  [LANDING_ZONE_KIND.id]: LANDING_ZONE_KIND,
});

export const EXPLAIN_KIND_IDS = Object.freeze(Object.keys(EXPLAIN_KINDS));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Which kind a parsed body asks for, and the body with `kind` taken out for
 * that kind's validator. No `kind` (or a body that is not an object, which
 * the default validator refuses with its own sentence) is the default kind;
 * a `kind` that is not a known one is a 400 naming the field, never the
 * value.
 *
 * @returns {{ kind: object, body: unknown } | { error: string }}
 */
export function selectExplainKind(raw) {
  if (!isPlainObject(raw) || raw.kind === undefined) {
    return { kind: EXPLAIN_KINDS[DEFAULT_EXPLAIN_KIND], body: raw };
  }
  if (typeof raw.kind !== 'string' || !Object.hasOwn(EXPLAIN_KINDS, raw.kind)) {
    return { error: 'kind is not a known explanation kind' };
  }
  const { kind, ...body } = raw;
  return { kind: EXPLAIN_KINDS[kind], body };
}
