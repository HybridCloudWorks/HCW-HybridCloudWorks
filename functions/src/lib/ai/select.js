/**
 * select.js — the resolver (ADR 0034 §3, slice 3, #858): ONE pure function
 * from (task, selection document, model catalogue, availability) to the
 * ordered chain of candidates a call may use, each with the reason it is
 * there, beside every candidate that was considered and turned away, with
 * the reason it was. The router calls it and nothing else decides; the
 * Tasks tab (slice 4) shows its answer, so the page can never disagree
 * with production.
 *
 * PRECEDENCE, the first rule that yields a model wins:
 *
 *   1. An explicit model from the call site: every candidate carries it,
 *      and usage records the call as `explicit`.
 *   2. Task mode `recommended`: the registry's recommended model (tasks.js),
 *      if it is `live` in the catalogue, priced, its provider keyed and
 *      enabled, and it carries the task's `needs`. Otherwise it is skipped
 *      with a flag and the global list serves. When it is eligible the
 *      global list still follows it, so a task is never left with fewer
 *      options than the list (failover is unchanged).
 *   3. Task mode `custom`: the chain in order, then the global list if
 *      `thenGlobal`. A custom chain with no eligible entry and `thenGlobal`
 *      off is read as `global` and flagged (§6).
 *   4. Task mode `global`, the default: the Priority list, Priority 1 first.
 *   5. Always, for every candidate: the provider holds a key (or endpoint)
 *      and is enabled; it is not in the task's `exclude`; the model is not
 *      `retired` and carries `needs`; and the policy locks hold. A locked or
 *      ineligible candidate is in `rejected` with a sentence, never silently
 *      dropped.
 *
 * THE POLICY LOCKS ARE CODE, and no document lifts them:
 *   - a trial-tier provider (TRIAL_TIER_PROVIDERS) never serves a task with
 *     `public: true`, nor a call that names no task — an undeclared call is
 *     not one anybody chose to send to a trial tier;
 *   - a task whose `needs` include `grounding` is served by Gemini only
 *     (router.js header: the Interactions API is the one door to pages and
 *     YouTube).
 * `ai-config.test.js` tested the placement locks in both directions; the
 * tests here do the same for these.
 *
 * A MODEL THE CATALOGUE DOES NOT KNOW IS ALLOWED, WITH A FLAG. A pinned id
 * before the first refresh, a model listed as `unknown`, or no catalogue at
 * all (the loader could not read it): the candidate stays, judged on the
 * code enrichment table's capabilities, and the chain says so. A fresh
 * deployment never goes dark for want of a list. Only `retired` removes.
 *
 * A NULL MODEL IS THE PROVIDER'S DEFAULT FOR THE CALL'S PURPOSE. Today a
 * step with no model is served by DEFAULT_MODEL_TABLE (router.js) by the
 * call's purpose — mini for a draft, nano for a short answer on Foundry —
 * and the owner's 2026-10-04 decision ("GPT-5 mini for anything that reads a
 * whole draft") lives in that table and in each task's recommendation. ADR
 * 0034 §2 reads a null as the provider's recommended model for the task's
 * MODALITY (provider-recommendations.js); on a text task that is nano, so
 * applying it here would move every drafting task to nano the moment this
 * merged, before the Tasks tab exists to choose Recommended. So this slice
 * applies §2 to ELIGIBILITY — a null step is judged on the modality
 * recommendation, which is what keeps a vision task off a provider whose
 * text model cannot read images — and reports it as `modalityModel`, while
 * `model` stays null for the router's purpose table, exactly as before.
 * Slice 4 (#859) KEPT that meaning (ADR 0034, amendment of 2026-10-05): a
 * null is the provider's default per purpose, the Priority row's helper
 * text says what that resolves to, and the Tasks tab's Recommended mode is
 * how a task gets the registry's recommendation. The line marked NULL
 * MODEL below is where the other reading would go, should the owner ever
 * ask for it. The contract test (select.contract.test.js) holds the
 * resolver to the chains the pre-slice router produced.
 *
 * Free of I/O and of `ctx`: everything it reads is an argument.
 */
import { DEFAULT_PROVIDER_ORDER } from './provider-order.js';
import { taskFor } from './tasks.js';
import { recommendedModelFor } from './provider-recommendations.js';
import { enrichmentFor } from './model-enrichment.js';

/** Providers on a trial tier: free, rate-limited, under trial terms (router.js header, #701). */
export const TRIAL_TIER_PROVIDERS = Object.freeze(['nvidia']);
/** The providers that can ground a generation on pages and YouTube (#433). */
export const GROUNDING_PROVIDERS = Object.freeze(['gemini']);

/** How a chain entry was chosen; the usage row carries it. */
export const SELECTION_SOURCES = Object.freeze(['explicit', 'recommended', 'custom', 'global']);

/**
 * What a call that names no task (or an unknown one) is judged as: a text
 * call, and public — the trial tier never serves it, as `placementFor`
 * answered 'off' for a call with no feature.
 */
export const UNDECLARED_TASK = Object.freeze({
  id: null,
  label: 'a call that names no task',
  modality: 'text',
  needs: Object.freeze(['text']),
  public: true,
  recommended: null,
});

/** The Priority list a document with none reads as: the default order, provider defaults. */
export const DEFAULT_PRIORITY = Object.freeze(
  DEFAULT_PROVIDER_ORDER.map((provider) => Object.freeze({ provider, model: null }))
);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The task definition for an id: the registry's, or UNDECLARED_TASK. */
function definitionOf(task) {
  if (isPlainObject(task) && Array.isArray(task.needs)) return task;
  const found = typeof task === 'string' ? taskFor(task) : undefined;
  return found ? { id: task, ...found } : UNDECLARED_TASK;
}

/** The task's entry in the document: `{ mode, chain?, thenGlobal?, exclude? }`, `global` when absent. */
function entryOf(selection, def) {
  const entry = def.id ? selection?.tasks?.[def.id] : null;
  return isPlainObject(entry) ? entry : { mode: 'global' };
}

/**
 * What the catalogue says about one model, or what the code says when the
 * catalogue does not list it: `listed` false, status `unknown`, the
 * enrichment table's capabilities, pricing unknown.
 */
function catalogEntry(catalog, provider, model) {
  const providerEntry = catalog?.providers?.[provider];
  const stored = providerEntry?.models?.[model];
  if (isPlainObject(stored)) {
    return {
      listed: true,
      status: stored.status || 'unknown',
      capabilities: Array.isArray(stored.capabilities) ? stored.capabilities : [],
      unpriced: stored.unpriced === true,
      stale: providerEntry.stale === true,
    };
  }
  return {
    listed: false,
    status: 'unknown',
    capabilities: enrichmentFor(model).capabilities,
    unpriced: null,
    stale: providerEntry?.stale === true,
  };
}

/** A turned-away candidate: where it came from (`selection`), the code a caller can key on, the sentence a page shows. */
const reject = (step, code, why) => ({
  provider: step.provider,
  model: step.model,
  selection: step.selection,
  code,
  why,
});

/**
 * Rule 5's provider half: keyed, enabled, not excluded, and the locks. A
 * rejection, or null when the provider may serve this task.
 */
function providerRejection(step, { def, availability, exclude }) {
  const facts = { provider: step.provider, def, availability, exclude };
  const failed = PROVIDER_CHECKS.find((check) => check.fails(facts));
  return failed ? reject(step, failed.code, failed.why(facts)) : null;
}

/**
 * Rule 5's provider checks, in the order they are asked; the first that
 * fails is the rejection. The two last are the policy locks (header).
 */
const PROVIDER_CHECKS = Object.freeze([
  {
    code: 'unknown',
    fails: ({ provider }) => !DEFAULT_PROVIDER_ORDER.includes(provider),
    why: ({ provider }) => `not available: ${provider} is not a provider the router implements`,
  },
  {
    code: 'no-key',
    fails: ({ provider, availability }) => !availability.keyed.includes(provider),
    why: ({ provider }) => `not available: ${provider} holds no key`,
  },
  {
    code: 'disabled',
    fails: ({ provider, availability }) => !availability.enabled.includes(provider),
    why: ({ provider }) => `not available: ${provider} is switched off in the admin portal`,
  },
  {
    code: 'excluded',
    fails: ({ provider, exclude }) => exclude.includes(provider),
    why: ({ provider }) => `not used: ${provider} is excluded for this task`,
  },
  {
    code: 'policy',
    fails: ({ provider, def }) => TRIAL_TIER_PROVIDERS.includes(provider) && def.public,
    why: () => 'not eligible: trial tier on a public route',
  },
  {
    code: 'policy',
    fails: ({ provider, def }) =>
      def.needs.includes('grounding') && !GROUNDING_PROVIDERS.includes(provider),
    why: () => 'not eligible: grounding is Gemini-only',
  },
]);

/**
 * Rule 5's model half for a named model: not retired, carries `needs`. A
 * rejection, or `{ note }` with the flag a not-yet-listed model earns.
 */
function modelVerdict(step, model, { def, catalog }) {
  const { provider } = step;
  const entry = catalogEntry(catalog, provider, model);
  // A rejection names the model it was judged on — for a null step, the
  // modality recommendation — and a capability rejection carries `missing`,
  // which the router's sentence names.
  const judged = { ...step, model };
  if (entry.status === 'retired') {
    return { rejection: reject(judged, 'retired', `not eligible: ${model} is retired on ${provider}`) };
  }
  const missing = def.needs.filter((need) => !entry.capabilities.includes(need));
  if (missing.length) {
    return {
      rejection: {
        ...reject(
          judged,
          'capability',
          `not eligible: ${model} on ${provider} does not carry ${missing.join(', ')}`
        ),
        missing,
      },
    };
  }
  let note = null;
  if (!entry.listed) note = `${model} on ${provider} is not in the catalogue yet; allowed until a refresh says otherwise`;
  else if (entry.status === 'unknown') note = `${model} on ${provider} has not been confirmed by a catalogue refresh yet`;
  return { entry, note };
}

/**
 * Rule 2's stricter model half: the recommendation must be `live` (a stale
 * provider's live model still counts, with a note) and priced.
 */
function recommendedVerdict(step, { def, catalog }) {
  const verdict = modelVerdict(step, step.model, { def, catalog });
  if (verdict.rejection) return verdict;
  const { entry } = verdict;
  if (entry.status !== 'live') {
    return {
      rejection: reject(
        step,
        entry.listed ? 'not-live' : 'not-listed',
        `not recommended: ${step.model} on ${step.provider} is ${entry.listed ? entry.status : 'not'} in the catalogue`
      ),
    };
  }
  if (entry.unpriced) {
    return {
      rejection: reject(step, 'unpriced', `not recommended: ${step.model} on ${step.provider} is unpriced`),
    };
  }
  return { entry, note: entry.stale ? `${step.provider}'s catalogue list is stale` : null };
}

/**
 * One candidate judged: `{ accepted }` or `{ rejection }`. The accepted
 * entry carries `model` (null for a provider default — header), the
 * `modalityModel` a null was judged on, `selection` and `why`.
 */
function judge(step, where, deps) {
  const rejection = providerRejection(step, deps);
  let verdict;
  if (rejection) verdict = { rejection };
  else if (deps.explicitModel) verdict = acceptExplicit(step, where, deps);
  else if (step.selection === 'recommended') verdict = judgeRecommended(step, deps);
  else verdict = judgeStep(step, where, deps);
  return verdict;
}

/**
 * Rule 1: the call site's model, on whatever provider the step names — and
 * rule 5 still: a retired model or one that does not carry the task's
 * needs is turned away like any other candidate; an unpriced one, or one
 * the catalogue has not listed, is allowed with the note.
 */
function acceptExplicit(step, where, { explicitModel, def, catalog }) {
  const named = { ...step, model: explicitModel };
  const verdict = modelVerdict(named, explicitModel, { def, catalog });
  if (verdict.rejection) return verdict;
  return {
    accepted: {
      provider: step.provider,
      model: explicitModel,
      modalityModel: null,
      selection: 'explicit',
      why: [`explicit model from the call site; ${where}`, verdict.note].filter(Boolean).join(' · '),
    },
  };
}

/** Rule 2: the task's recommendation, under the stricter verdict. */
function judgeRecommended(step, deps) {
  const verdict = recommendedVerdict(step, deps);
  if (verdict.rejection) return verdict;
  return {
    accepted: {
      provider: step.provider,
      model: step.model,
      modalityModel: step.model,
      selection: 'recommended',
      why: [`recommended for this task: ${deps.def.recommended?.reason || ''}`.trim(), verdict.note]
        .filter(Boolean)
        .join(' · '),
    },
  };
}

/**
 * Rules 3 and 4: a chain or list step, with its named model or — for a
 * null — the provider's modality recommendation to judge it on.
 */
function judgeStep(step, where, { def, catalog }) {
  const named = step.model;
  const modality = named ? null : recommendedModelFor(step.provider, def.modality);
  if (!named && !modality) {
    return {
      rejection: reject(
        step,
        'no-model',
        `no model: ${step.provider} has no recommended model for ${def.modality}`
      ),
    };
  }
  const judged = named || modality.model;
  const verdict = modelVerdict(step, judged, { def, catalog });
  if (verdict.rejection) return verdict;
  return {
    accepted: {
      provider: step.provider,
      // NULL MODEL (header): `judged` here would make a null step the
      // modality recommendation; the 2026-10-05 amendment keeps it null.
      model: named,
      modalityModel: judged,
      selection: step.selection,
      why: [
        where,
        named ? `model ${named}` : `model: the provider's default for the call's purpose (${judged} for ${def.modality})`,
        verdict.note,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  };
}

/** The Priority list's steps, labelled `global`, with the fallback for an empty list. */
function globalSteps(selection, flags) {
  const priority = selection?.global?.priority;
  if (Array.isArray(priority) && priority.length) {
    return priority.map((step, index) => ({
      ...step,
      selection: 'global',
      where: `Priority ${index + 1}`,
    }));
  }
  if (selection) flags.push('the Priority list is empty; using the default provider order');
  return DEFAULT_PRIORITY.map((step, index) => ({
    ...step,
    selection: 'global',
    where: `Priority ${index + 1} (default order)`,
  }));
}

/** Rejection codes that hold for the provider whatever model a later step names. */
const PROVIDER_LEVEL = Object.freeze(['unknown', 'no-key', 'disabled', 'excluded', 'policy']);

/**
 * Walk the steps in order, one entry per provider, collecting rejections. A
 * provider accepted once is not judged again; one turned away for its own
 * sake (no key, switched off, excluded, locked) is not judged again either,
 * so the page sees one sentence per provider; a model-level rejection (a
 * retired or unable model) leaves a later step naming another model its
 * chance — unless the call site named the model, which every step of that
 * provider would be judged on alike.
 */
function walk(steps, deps, rejected) {
  const chain = [];
  const settled = new Set();
  for (const step of steps) {
    if (settled.has(step.provider)) continue;
    const { accepted, rejection } = judge(step, step.where, deps);
    if (accepted) {
      chain.push(accepted);
      settled.add(step.provider);
    } else {
      rejected.push(rejection);
      if (deps.explicitModel || PROVIDER_LEVEL.includes(rejection.code)) settled.add(step.provider);
    }
  }
  return chain;
}

/**
 * The chain for one call.
 *
 * @param {object} params
 * @param {string|object|null} params.task  A task id (tasks.js), the task
 *   object, or null for a call that names none.
 * @param {object|null} params.selection  The v2 document as normalizeSelection
 *   returns it; null reads as the default order and every task `global`.
 * @param {object|null} params.catalog  As readModelCatalog returns it; null
 *   when it could not be read (every model then judged by the code table).
 * @param {{ keyed: string[], enabled: string[] }} params.availability
 *   Providers holding a key, and those not switched off.
 * @param {string|null} [params.explicitModel]  A model the call site named.
 * @returns {{ mode: string, chain: Array<{ provider: string, model: string|null,
 *   modalityModel: string|null, selection: string, why: string }>,
 *   rejected: Array<{ provider: string, model: string|null, code: string, why: string }>,
 *   flags: string[] }}
 */
export function selectChain({ task, selection = null, catalog = null, availability, explicitModel = null }) {
  const def = definitionOf(task);
  const entry = entryOf(selection, def);
  const deps = {
    def,
    catalog,
    exclude: Array.isArray(entry.exclude) ? entry.exclude : [],
    explicitModel: typeof explicitModel === 'string' && explicitModel.trim() ? explicitModel.trim() : null,
    availability: {
      keyed: Array.isArray(availability?.keyed) ? availability.keyed : [],
      enabled: Array.isArray(availability?.enabled) ? availability.enabled : [],
    },
  };
  const flags = [];
  const rejected = [];
  const plan = planFor(entry, { def, deps, global: globalSteps(selection, flags), flags });
  const chain = walk(plan.steps, deps, rejected);
  const outcome = settle(plan, chain, { deps, rejected, flags });
  return { mode: outcome.mode, chain: outcome.chain, rejected, flags };
}

/**
 * The steps the task's mode puts before the walk, and the mode it reads
 * as: `{ mode, steps, lead?, thenGlobal?, global? }`. The recommendation,
 * when the mode asks for it and the call site named no model, is `lead`.
 */
function planFor(entry, { def, deps, global, flags }) {
  if (entry.mode === 'recommended') return recommendedPlan(def, deps, global, flags);
  if (entry.mode === 'custom') return customPlan(entry, global);
  return { mode: 'global', steps: global };
}

/** Rule 2's plan: the recommendation then the list, or the list alone, flagged, when the task has none. */
function recommendedPlan(def, deps, global, flags) {
  if (!def.recommended) {
    flags.push(`${def.label} has no recommended model; using the Priority list`);
    return { mode: 'global', steps: global };
  }
  const lead = deps.explicitModel
    ? null
    : { ...def.recommended, selection: 'recommended', where: 'recommended' };
  return { mode: 'recommended', steps: lead ? [lead, ...global] : global, lead };
}

/** Rule 3's plan: the chain, then the list if `thenGlobal`. */
function customPlan(entry, global) {
  const custom = (Array.isArray(entry.chain) ? entry.chain : []).map((step, index) => ({
    ...step,
    selection: 'custom',
    where: `custom chain, step ${index + 1}`,
  }));
  const thenGlobal = entry.thenGlobal !== false;
  return { mode: 'custom', steps: thenGlobal ? [...custom, ...global] : custom, thenGlobal, global };
}

/**
 * What the walk came to, and the flag it earns: a recommendation that did
 * not lead reads as `global`; a custom chain with nothing eligible and no
 * list behind it reads as `global` and the list is walked (§6).
 */
function settle(plan, chain, { deps, rejected, flags }) {
  if (plan.mode === 'recommended' && plan.lead && chain[0]?.selection !== 'recommended') {
    const why = rejected.find((r) => r.provider === plan.lead.provider && r.model === plan.lead.model);
    flags.push(`the recommended model is not eligible (${why?.why || 'see rejected'}); using the Priority list`);
    return { mode: 'global', chain };
  }
  if (plan.mode === 'custom' && !chain.length && !plan.thenGlobal) {
    flags.push('no entry of the custom chain is eligible and the Priority list does not follow it; using the Priority list');
    return { mode: 'global', chain: walk(plan.global, deps, rejected) };
  }
  return { mode: plan.mode, chain };
}
