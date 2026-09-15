/**
 * The scenario shapes (#613, Phase 2): bills of quantities, monthly, in each
 * service's unit. A note per quantity says where the number came from ("2
 * instances × 730 h"), because a bare 1460 in a box is not reviewable.
 * Services absent from `quantities` are 0.
 */
import { HOURS_PER_MONTH, SERVICE_IDS, isQuantity } from './services';

export const SCENARIOS = Object.freeze([
  {
    id: 'static-site-api',
    label: 'Static site + API',
    blurb: 'A CDN-fronted site with a serverless API and a document store behind it.',
    quantities: {
      'compute-serverless': 5,
      'storage-object': 50,
      'database-nosql': 10,
      'edge-cdn': 500,
    },
    notes: {
      'compute-serverless': '5 workloads of 1M requests + 400k GB-s',
      'storage-object': '50 GB of site assets and uploads',
      'database-nosql': '10 million reads and writes',
      'edge-cdn': '500 GB served from the edge',
    },
  },
  {
    id: 'three-tier-web',
    label: 'Three-tier web app',
    blurb: 'Two application servers, one managed relational database, object storage and a CDN.',
    quantities: {
      'compute-vm': 2 * HOURS_PER_MONTH,
      'database-relational': HOURS_PER_MONTH,
      'storage-object': 200,
      'edge-cdn': 500,
    },
    notes: {
      'compute-vm': '2 instances × 730 h',
      'database-relational': '1 instance × 730 h',
      'storage-object': '200 GB of assets and uploads',
      'edge-cdn': '500 GB served from the edge',
    },
  },
  {
    id: 'event-driven',
    label: 'Event-driven backend',
    blurb: 'Queues and functions doing the work, a NoSQL store keeping the state, no servers.',
    quantities: {
      'compute-serverless': 20,
      'integration-messaging': 50,
      'database-nosql': 100,
      'storage-object': 100,
      'edge-cdn': 100,
    },
    notes: {
      'compute-serverless': '20 workloads of 1M requests + 400k GB-s',
      'integration-messaging': '50 million queue operations',
      'database-nosql': '100 million reads and writes',
      'storage-object': '100 GB of event payloads',
      'edge-cdn': '100 GB of API responses',
    },
  },
  {
    id: 'data-platform',
    label: 'Data platform',
    blurb: 'A four-node processing cluster, two databases, a 5 TB lake and a message bus.',
    quantities: {
      'compute-vm': 4 * HOURS_PER_MONTH,
      'database-relational': 2 * HOURS_PER_MONTH,
      'storage-object': 5000,
      'integration-messaging': 20,
      'edge-cdn': 200,
    },
    notes: {
      'compute-vm': '4 instances × 730 h',
      'database-relational': '2 instances × 730 h',
      'storage-object': '5,000 GB in the lake',
      'integration-messaging': '20 million bus operations',
      'edge-cdn': '200 GB of exports and dashboards',
    },
  },
  {
    id: 'kubernetes-platform',
    label: 'Kubernetes platform',
    blurb: 'A managed cluster with its baseline nodes, a relational database, storage and a CDN.',
    quantities: {
      'containers-kubernetes': HOURS_PER_MONTH,
      'database-relational': HOURS_PER_MONTH,
      'storage-object': 500,
      'integration-messaging': 10,
      'edge-cdn': 1000,
    },
    notes: {
      'containers-kubernetes': '1 cluster (control plane + baseline nodes) × 730 h',
      'database-relational': '1 instance × 730 h',
      'storage-object': '500 GB of images and volumes',
      'integration-messaging': '10 million queue operations',
      'edge-cdn': '1,000 GB served from the edge',
    },
  },
]);

export const DEFAULT_SCENARIO_ID = 'three-tier-web';

const SCENARIO_BY_ID = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function scenarioById(scenarioId) {
  return SCENARIO_BY_ID.get(scenarioId) ?? SCENARIO_BY_ID.get(DEFAULT_SCENARIO_ID);
}

export function isScenarioId(scenarioId) {
  return SCENARIO_BY_ID.has(scenarioId);
}

/** The scenario's own quantities, every service present, zeros filled in. */
export function scenarioQuantities(scenarioId) {
  const scenario = scenarioById(scenarioId);
  const out = {};
  for (const id of SERVICE_IDS) out[id] = scenario.quantities[id] ?? 0;
  return out;
}

/**
 * The scenario's quantities with the reader's overrides on top. An override
 * that is not a finite non-negative number is ignored rather than applied.
 */
export function effectiveQuantities(scenarioId, overrides = {}, egressGb = null) {
  const out = scenarioQuantities(scenarioId);
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (isQuantity(value) && id in out) out[id] = Number(value);
  }
  if (isQuantity(egressGb)) out['edge-cdn'] = Number(egressGb);
  return out;
}

/** Egress volumes the slider offers; "where the three clouds differ most". */
export const EGRESS_PRESETS = Object.freeze([100, 500, 1000, 5000, 20000]);
