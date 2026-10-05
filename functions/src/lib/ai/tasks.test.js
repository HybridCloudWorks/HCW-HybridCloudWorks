/**
 * The AI task registry (ADR 0034 slice 1, #856): every feature is a task,
 * every task says what kind of answer it needs, and every recommendation
 * names a priced model with a reason and a date.
 */
import { describe, it, expect } from 'vitest';
import { AI_TASKS, CAPABILITIES, MODALITIES, PUBLIC_TASKS, TASK_NAMES, taskFor } from './tasks.js';
import { AI_FEATURES, FEATURE_NAMES, PROVIDER_PLACEMENT_DEFAULTS } from './features-catalogue.js';
import { COST_TABLE, PROVIDERS, isPriced } from './router.js';
import { RECOMMENDED_BY_MODALITY, recommendedModelFor } from './provider-recommendations.js';

describe('the registry and the feature catalogue are one list', () => {
  it('has exactly the feature names, in the same order', () => {
    expect(TASK_NAMES).toEqual(FEATURE_NAMES);
  });

  it('a feature is its task\'s label, description and route, and nothing else', () => {
    for (const id of TASK_NAMES) {
      expect(AI_FEATURES[id]).toEqual({
        label: AI_TASKS[id].label,
        description: AI_TASKS[id].description,
        route: AI_TASKS[id].route,
      });
    }
  });

  it('taskFor reads own properties only', () => {
    expect(taskFor('inspector')).toBe(AI_TASKS.inspector);
    expect(taskFor('constructor')).toBeUndefined();
    expect(taskFor('nope')).toBeUndefined();
  });
});

describe('every task says what it needs', () => {
  it('has a known modality and needs drawn from the capability vocabulary', () => {
    for (const [id, task] of Object.entries(AI_TASKS)) {
      expect(MODALITIES, id).toContain(task.modality);
      expect(task.needs.length, id).toBeGreaterThan(0);
      for (const need of task.needs) expect(CAPABILITIES, `${id} needs ${need}`).toContain(need);
      expect(typeof task.public, id).toBe('boolean');
    }
  });

  it('the public tasks are the two anonymous explain routes, where the trial tier is locked off', () => {
    expect(PUBLIC_TASKS).toEqual(['pricingExplain', 'landingZoneExplain']);
    for (const id of PUBLIC_TASKS) {
      expect(PROVIDER_PLACEMENT_DEFAULTS.nvidia[id], id).toBe('off');
    }
  });

  it('grounding is a need only the grounded task has, and only Gemini can meet', () => {
    const grounded = TASK_NAMES.filter((id) => AI_TASKS[id].needs.includes('grounding'));
    expect(grounded).toEqual(['sourceGrounding']);
    expect(AI_TASKS.sourceGrounding.recommended.provider).toBe('gemini');
    expect(Object.keys(RECOMMENDED_BY_MODALITY).filter((p) => RECOMMENDED_BY_MODALITY[p].grounding)).toEqual([
      'gemini',
    ]);
  });
});

describe('recommendations are claims with a date, naming a priced model', () => {
  it('every task recommends a provider the router implements and a model the cost table prices', () => {
    for (const [id, task] of Object.entries(AI_TASKS)) {
      const { provider, model, reason, asOf } = task.recommended;
      expect(PROVIDERS, id).toContain(provider);
      expect(Object.hasOwn(COST_TABLE[provider], model), `${id}: ${provider}/${model} has no cost row`).toBe(true);
      expect(isPriced(provider, model), `${id}: ${provider}/${model} is unpriced`).toBe(true);
      expect(reason.length, id).toBeGreaterThan(20);
      expect(asOf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no public task recommends a trial-tier provider', () => {
    for (const id of PUBLIC_TASKS) expect(AI_TASKS[id].recommended.provider, id).not.toBe('nvidia');
  });

  it('every provider recommends a priced text model, and a vision model only where it reads images', () => {
    for (const provider of PROVIDERS) {
      const table = RECOMMENDED_BY_MODALITY[provider];
      expect(table, provider).toBeDefined();
      expect(table.text, `${provider} has no text recommendation`).toBeDefined();
      for (const [modality, entry] of Object.entries(table)) {
        expect([...MODALITIES, 'grounding'], `${provider}/${modality}`).toContain(modality);
        expect(isPriced(provider, entry.model), `${provider}/${modality}: ${entry.model}`).toBe(true);
        expect(Object.hasOwn(COST_TABLE[provider], entry.model), `${provider}/${modality}: ${entry.model} row`).toBe(true);
        expect(entry.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    expect(recommendedModelFor('nvidia', 'vision')).toBeUndefined();
    expect(recommendedModelFor('foundry', 'json').model).toBe('gpt-5-mini');
  });
});
