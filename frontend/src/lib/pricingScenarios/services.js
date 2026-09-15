/**
 * The vocabulary the scenario modules share (#613, Phase 2): the eight service
 * meters, the three providers, the billing month, and the two shapes every
 * rule speaks in — a quantity and a line item.
 */

/** Billing hours in a month, the convention all three price calculators use. */
export const HOURS_PER_MONTH = 730;

export const PROVIDER_IDS = Object.freeze(['aws', 'azure', 'gcp']);

const meter = (id, label, unit, shortUnit) => Object.freeze({ id, label, unit, shortUnit });

/**
 * The eight service meters, in table order, with the unit each is priced in.
 * Mirrors functions/src/lib/cloud-tools/pricing/baseline.js and the labels the
 * refresh writes; kept here so the quantity editor can render its rows before
 * any data has arrived (the pre-rendered page has none).
 */
export const SERVICES = Object.freeze([
  meter('compute-vm', 'Virtual machine', 'hour', 'h'),
  meter('compute-serverless', 'Serverless functions', 'normalized request workload', 'workloads'),
  meter('storage-object', 'Object storage', 'GB-month', 'GB'),
  meter('database-relational', 'Relational database', 'hour', 'h'),
  meter('database-nosql', 'NoSQL database', 'million operations', 'M ops'),
  meter('containers-kubernetes', 'Kubernetes', 'hour', 'h'),
  meter('integration-messaging', 'Messaging', 'million operations', 'M ops'),
  meter('edge-cdn', 'CDN egress', 'GB egress', 'GB'),
]);

export const SERVICE_IDS = Object.freeze(SERVICES.map((service) => service.id));

const SERVICE_BY_ID = new Map(SERVICES.map((service) => [service.id, service]));

export function serviceMeta(serviceId) {
  return SERVICE_BY_ID.get(serviceId) ?? meter(serviceId, serviceId, '', '');
}

/** A finite, non-negative number (or numeric string); never null or ''. */
export function isQuantity(value) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= 0;
}

/** A line item: `quantity × factor × unit price of serviceId`. */
export const line = (serviceId, quantity, factor, label) => ({
  serviceId,
  quantity,
  factor,
  label,
});
