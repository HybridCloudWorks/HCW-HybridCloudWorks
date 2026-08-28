/**
 * forge-config-default.js — the ONE forge-config loader for the process.
 *
 * The loader caches for five minutes per instance, and the Function App runs
 * the HTTP routes and the queue worker in the same process — so Forge
 * Studio's updateForgeConfig can only make an edit take effect immediately
 * if it clears the SAME cache the forge worker reads. Two private instances
 * (which is what forge-jobs.js and forge-config-http.js briefly had) means
 * the Studio clears one cache while the worker keeps serving the other for
 * up to the TTL. Same singleton reasoning as `defaultRouter` in
 * lib/ai/router.js.
 *
 * Import this instance everywhere production code needs forge config; keep
 * `createForgeConfigLoader` for tests and for callers that genuinely want an
 * isolated cache.
 */
import { readDoc } from '../cosmos-client.js';
import { createForgeConfigLoader } from './forge-config.js';

export const defaultForgeConfig = createForgeConfigLoader({ store: { readDoc } });
