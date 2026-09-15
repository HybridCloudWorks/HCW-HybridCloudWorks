/**
 * Scenarios and extras for the cloud pricing comparison (#613, Phase 2) — the
 * arithmetic behind "what does *my* shape cost on each cloud, and what do
 * backup, DR, zone redundancy and a commitment add or take off".
 *
 * ONE SET OF METERS. Every line, base or extra, is priced off the same eight
 * per-service rates the Phase 1 table shows, and every multiplier that turns
 * one meter into an extra is a row of `ASSUMPTIONS`, with the page the figure
 * came from. That table is what the page renders under "How this is
 * calculated": a reader should be able to redo any total by hand.
 *
 * PURE. No React, no DOM, no clock, no locale beyond the fixed en-US money
 * format. The inputs are the `pricing` object `fetchCloudPricing` returns and
 * a scenario state `{ scenarioId, quantities, extras }`; the outputs are
 * plain objects.
 *
 * One module per concern, this file the public surface:
 *   services.js     the eight meters, providers, the billing month
 *   scenarios.js    the five shapes and their quantities
 *   assumptions.js  every factor, with its source
 *   extras.js       the rules that turn quantities into line items
 *   compute.js      pricing a scenario on every provider
 *   share.js        the scenario as a query string
 *   compare.js      the same scenario in a second region (Phase 3)
 *   format.js       fixed en-US formatting
 */
export { HOURS_PER_MONTH, PROVIDER_IDS, SERVICES, SERVICE_IDS, serviceMeta } from './services';
export {
  SCENARIOS,
  DEFAULT_SCENARIO_ID,
  EGRESS_PRESETS,
  scenarioById,
  scenarioQuantities,
  effectiveQuantities,
} from './scenarios';
export {
  ASSUMPTIONS,
  BACKUP_TIER_FACTOR,
  BACKUP_DB_SIZE_GB,
  BACKUP_DB_CHANGE_SHARE,
  BACKUP_RETENTION_DAYS,
  DR_REPLICATION_EGRESS_SHARE,
  DR_WARM_STANDBY_SHARE,
  DR_ACTIVE_ACTIVE_EGRESS_SHARE,
  ZONE_FACTOR,
  COMMIT_DISCOUNT,
} from './assumptions';
export {
  EXTRAS,
  EXTRA_IDS,
  extraById,
  normalizeExtras,
  setExtra,
  setGroupChoice,
  groupChoice,
} from './extras';
export { priceTable, computeScenario } from './compute';
export { isScenarioParam, isRegionId, encodeScenario, decodeScenario } from './share';
export { compareRegions } from './compare';
export {
  formatCost,
  formatDelta,
  formatSignedDelta,
  formatAssumption,
  formatQuantity,
} from './format';
