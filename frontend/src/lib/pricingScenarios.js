/**
 * Scenarios and extras for the cloud pricing comparison (#613, Phase 2) — the
 * arithmetic behind "what does *my* shape cost on each cloud, and what do
 * backup, DR, zone redundancy and a commitment add or take off".
 *
 * ONE SET OF METERS. Every line here, base or extra, is priced off the same
 * eight per-service rates the Phase 1 table shows: a backup is object-storage
 * GB-months at a cheaper tier, a DR replica is relational-database hours, a
 * cross-region copy is CDN-rate egress. Nothing is priced from a number that
 * did not come from the provider's price list (or the site's catalogue when
 * the list could not be read), and every multiplier that turns one meter into
 * an extra is a row of `ASSUMPTIONS`, with the page the figure came from. That
 * table is what the page renders under "How this is calculated": a reader
 * should be able to redo any total by hand.
 *
 * PURE. No React, no DOM, no clock, no locale beyond the fixed en-US money
 * format (`formatCost`, for the same hydration reason as `formatPrice`). The
 * inputs are the `pricing` object `fetchCloudPricing` returns and a scenario
 * state `{ scenarioId, quantities, extras }`; the outputs are plain objects.
 *
 * NEVER SILENTLY ZERO. A service the scenario needs that has no price for a
 * provider makes that provider's total `null` and names the service under
 * `unavailable`. A zero would read as "free" and make the provider cheapest
 * for lacking a number, which is the opposite of what happened.
 */

/** Billing hours in a month, the convention all three price calculators use. */
export const HOURS_PER_MONTH = 730;

export const PROVIDER_IDS = Object.freeze(['aws', 'azure', 'gcp']);

/**
 * The eight service meters, in table order, with the unit each is priced in.
 * Mirrors functions/src/lib/cloud-tools/pricing/baseline.js and the labels the
 * refresh writes; kept here so the quantity editor can render its rows before
 * any data has arrived (the pre-rendered page has none).
 */
export const SERVICES = Object.freeze([
  { id: 'compute-vm', label: 'Virtual machine', unit: 'hour', shortUnit: 'h' },
  {
    id: 'compute-serverless',
    label: 'Serverless functions',
    unit: 'normalized request workload',
    shortUnit: 'workloads',
  },
  { id: 'storage-object', label: 'Object storage', unit: 'GB-month', shortUnit: 'GB' },
  { id: 'database-relational', label: 'Relational database', unit: 'hour', shortUnit: 'h' },
  { id: 'database-nosql', label: 'NoSQL database', unit: 'million operations', shortUnit: 'M ops' },
  { id: 'containers-kubernetes', label: 'Kubernetes', unit: 'hour', shortUnit: 'h' },
  {
    id: 'integration-messaging',
    label: 'Messaging',
    unit: 'million operations',
    shortUnit: 'M ops',
  },
  { id: 'edge-cdn', label: 'CDN egress', unit: 'GB egress', shortUnit: 'GB' },
]);

export const SERVICE_IDS = Object.freeze(SERVICES.map((service) => service.id));

const SERVICE_BY_ID = new Map(SERVICES.map((service) => [service.id, service]));

export function serviceMeta(serviceId) {
  return (
    SERVICE_BY_ID.get(serviceId) ?? { id: serviceId, label: serviceId, unit: '', shortUnit: '' }
  );
}

/* ------------------------------------------------------------------------ */
/* Scenarios                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Bills of quantities, monthly, in each service's unit. A note per quantity
 * says where the number came from ("2 instances × 730 h"), because a bare
 * 1460 in a box is not reviewable. Services absent from `quantities` are 0.
 */
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

/* ------------------------------------------------------------------------ */
/* Assumptions — every multiplier, with its source                          */
/* ------------------------------------------------------------------------ */

/**
 * Backup copies are billed at a snapshot or cool-tier rate, not the hot
 * object-storage rate the table shows. The factor is that rate as a share of
 * the hot rate: AWS EBS snapshots at $0.05/GB-month against S3 Standard's
 * $0.023 is not a discount, but AWS Backup's cold storage and S3 Glacier
 * Instant Retrieval sit well under it, so 0.6 is the blended, deliberately
 * conservative figure; Azure Backup vault LRS and GCP archive snapshots come in
 * around half the hot rate.
 */
export const BACKUP_TIER_FACTOR = Object.freeze({ aws: 0.6, azure: 0.5, gcp: 0.5 });
export const BACKUP_DB_SIZE_GB = 100;
export const BACKUP_DB_CHANGE_SHARE = 0.2;
export const BACKUP_RETENTION_DAYS = 30;

/** Replication egress for a pilot-light copy, as a share of the storage GB per month. */
export const DR_REPLICATION_EGRESS_SHARE = 0.1;
/** Warm standby keeps compute and Kubernetes running at half the primary's hours. */
export const DR_WARM_STANDBY_SHARE = 0.5;
/** Active-active adds cross-region traffic on top of the doubled CDN egress. */
export const DR_ACTIVE_ACTIVE_EGRESS_SHARE = 0.25;

/**
 * Zone redundancy as an uplift on the base line: 0 means the table's price
 * already includes it, 1.0 means it doubles the line. S3 Standard and Cloud
 * Storage regional buckets are multi-zone by default; Azure ZRS lists about
 * 25% over LRS. A Multi-AZ RDS instance, a zone-redundant Azure SQL database
 * and a Cloud SQL HA instance all bill a second (standby) instance.
 */
export const ZONE_FACTOR = Object.freeze({
  aws: Object.freeze({ storage: 0, db: 1.0 }),
  azure: Object.freeze({ storage: 0.25, db: 1.0 }),
  gcp: Object.freeze({ storage: 0, db: 1.0 }),
});

/**
 * Commitment discounts as the share taken off compute, Kubernetes nodes and
 * the relational database. Round figures from each provider's own headline:
 * AWS Compute Savings Plans "up to 66%" over three years with one-year
 * general-purpose plans near 28%; Azure reservations "up to 72%" for three
 * years, 35–40% for one; GCP committed-use "up to 57%" for three years and
 * 37% for one. Each is set at the general-purpose figure, not the headline.
 */
export const COMMIT_DISCOUNT = Object.freeze({
  aws: Object.freeze({ '1y': 0.28, '3y': 0.5 }),
  azure: Object.freeze({ '1y': 0.35, '3y': 0.6 }),
  gcp: Object.freeze({ '1y': 0.37, '3y': 0.55 }),
});

const COMMIT_SERVICES = Object.freeze([
  'compute-vm',
  'containers-kubernetes',
  'database-relational',
]);

const same = (value) => Object.freeze({ aws: value, azure: value, gcp: value });

const SRC = Object.freeze({
  awsEbsSnapshots: {
    label: 'AWS EBS snapshot pricing',
    url: 'https://aws.amazon.com/ebs/pricing/',
  },
  awsBackup: { label: 'AWS Backup pricing', url: 'https://aws.amazon.com/backup/pricing/' },
  azureBackup: {
    label: 'Azure Backup pricing',
    url: 'https://azure.microsoft.com/pricing/details/backup/',
  },
  azureDisks: {
    label: 'Azure managed disk snapshot pricing',
    url: 'https://azure.microsoft.com/pricing/details/managed-disks/',
  },
  gcpSnapshots: {
    label: 'Google Cloud disk and snapshot pricing',
    url: 'https://cloud.google.com/compute/disks-image-pricing',
  },
  awsDr: {
    label: 'AWS: disaster recovery options in the cloud',
    url: 'https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html',
  },
  azureDr: {
    label: 'Azure: disaster recovery overview',
    url: 'https://learn.microsoft.com/azure/reliability/disaster-recovery-overview',
  },
  gcpDr: {
    label: 'Google Cloud: DR planning guide',
    url: 'https://cloud.google.com/architecture/dr-scenarios-planning-guide',
  },
  awsS3: { label: 'Amazon S3 pricing', url: 'https://aws.amazon.com/s3/pricing/' },
  awsS3Durability: {
    label: 'Amazon S3 data durability (stored across at least three AZs)',
    url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html',
  },
  azureBlob: {
    label: 'Azure Blob Storage pricing (LRS vs ZRS)',
    url: 'https://azure.microsoft.com/pricing/details/storage/blobs/',
  },
  azureRedundancy: {
    label: 'Azure Storage redundancy',
    url: 'https://learn.microsoft.com/azure/storage/common/storage-redundancy',
  },
  gcpStorage: { label: 'Cloud Storage pricing', url: 'https://cloud.google.com/storage/pricing' },
  gcpLocations: {
    label: 'Cloud Storage bucket locations (regional is multi-zone)',
    url: 'https://cloud.google.com/storage/docs/locations',
  },
  awsRds: { label: 'Amazon RDS pricing (Multi-AZ)', url: 'https://aws.amazon.com/rds/pricing/' },
  azureSqlZr: {
    label: 'Azure SQL Database zone redundancy',
    url: 'https://learn.microsoft.com/azure/azure-sql/database/high-availability-sla-local-zone-redundancy',
  },
  gcpSqlHa: {
    label: 'Cloud SQL high availability (standby billed)',
    url: 'https://cloud.google.com/sql/docs/mysql/high-availability',
  },
  gcpSqlPricing: { label: 'Cloud SQL pricing', url: 'https://cloud.google.com/sql/pricing' },
  awsSavingsPlans: {
    label: 'AWS Savings Plans pricing',
    url: 'https://aws.amazon.com/savingsplans/pricing/',
  },
  awsRdsRi: {
    label: 'Amazon RDS reserved instances',
    url: 'https://aws.amazon.com/rds/reserved-instances/',
  },
  azureReservations: {
    label: 'Azure reservations',
    url: 'https://azure.microsoft.com/pricing/reservations/',
  },
  azureReservationsDoc: {
    label: 'Azure: save costs with reservations',
    url: 'https://learn.microsoft.com/azure/cost-management-billing/reservations/save-compute-costs-reservations',
  },
  gcpCud: {
    label: 'Google Cloud committed-use discounts',
    url: 'https://cloud.google.com/compute/docs/instances/committed-use-discounts-overview',
  },
  gcpSqlCud: {
    label: 'Cloud SQL committed-use discounts',
    url: 'https://cloud.google.com/sql/docs/mysql/cud',
  },
});

/**
 * Every factor the rules use, one row each, with the page it was read from.
 * The page renders this table verbatim; a factor that is not in it is a
 * factor a reader cannot check, so the rules read their numbers from the same
 * constants these rows cite.
 */
export const ASSUMPTIONS = Object.freeze([
  {
    id: 'hours-per-month',
    label: 'Hours in a billing month',
    values: same(HOURS_PER_MONTH),
    format: 'number',
    sources: [SRC.awsSavingsPlans, SRC.azureReservationsDoc, SRC.gcpCud],
  },
  {
    id: 'backup-tier-factor',
    label: 'Backup storage rate, as a share of the hot object-storage rate',
    values: BACKUP_TIER_FACTOR,
    format: 'factor',
    sources: [
      SRC.awsEbsSnapshots,
      SRC.awsBackup,
      SRC.azureBackup,
      SRC.azureDisks,
      SRC.gcpSnapshots,
    ],
  },
  {
    id: 'backup-db-size',
    label: 'Relational database size assumed for backups (GB)',
    values: same(BACKUP_DB_SIZE_GB),
    format: 'number',
    sources: [SRC.awsBackup, SRC.azureBackup, SRC.gcpSnapshots],
  },
  {
    id: 'backup-db-change-share',
    label: 'Share of the database captured per backup cycle',
    values: same(BACKUP_DB_CHANGE_SHARE),
    format: 'factor',
    sources: [SRC.awsBackup, SRC.azureBackup, SRC.gcpSnapshots],
  },
  {
    id: 'backup-retention-days',
    label: 'Backup retention (days)',
    values: same(BACKUP_RETENTION_DAYS),
    format: 'number',
    sources: [SRC.awsBackup, SRC.azureBackup, SRC.gcpSnapshots],
  },
  {
    id: 'dr-replication-egress',
    label: 'Pilot light: monthly replication egress, as a share of storage GB',
    values: same(DR_REPLICATION_EGRESS_SHARE),
    format: 'factor',
    sources: [SRC.awsDr, SRC.azureDr, SRC.gcpDr],
  },
  {
    id: 'dr-warm-standby-share',
    label: 'Warm standby: compute and Kubernetes hours in the second region',
    values: same(DR_WARM_STANDBY_SHARE),
    format: 'factor',
    sources: [SRC.awsDr, SRC.azureDr, SRC.gcpDr],
  },
  {
    id: 'dr-active-active-egress',
    label: 'Active-active: cross-region egress, as a share of CDN egress',
    values: same(DR_ACTIVE_ACTIVE_EGRESS_SHARE),
    format: 'factor',
    sources: [SRC.awsDr, SRC.azureDr, SRC.gcpDr],
  },
  {
    id: 'zone-storage-uplift',
    label: 'Zone redundancy: uplift on object storage',
    values: {
      aws: ZONE_FACTOR.aws.storage,
      azure: ZONE_FACTOR.azure.storage,
      gcp: ZONE_FACTOR.gcp.storage,
    },
    format: 'factor',
    sources: [
      SRC.awsS3Durability,
      SRC.awsS3,
      SRC.azureBlob,
      SRC.azureRedundancy,
      SRC.gcpLocations,
      SRC.gcpStorage,
    ],
  },
  {
    id: 'zone-db-uplift',
    label: 'Zone redundancy: uplift on the relational database',
    values: { aws: ZONE_FACTOR.aws.db, azure: ZONE_FACTOR.azure.db, gcp: ZONE_FACTOR.gcp.db },
    format: 'factor',
    sources: [SRC.awsRds, SRC.azureSqlZr, SRC.gcpSqlHa, SRC.gcpSqlPricing],
  },
  {
    id: 'commit-1y',
    label: '1-year commitment: discount on compute, Kubernetes and the database',
    values: {
      aws: COMMIT_DISCOUNT.aws['1y'],
      azure: COMMIT_DISCOUNT.azure['1y'],
      gcp: COMMIT_DISCOUNT.gcp['1y'],
    },
    format: 'percent',
    sources: [SRC.awsSavingsPlans, SRC.awsRdsRi, SRC.azureReservations, SRC.gcpCud, SRC.gcpSqlCud],
  },
  {
    id: 'commit-3y',
    label: '3-year commitment: discount on compute, Kubernetes and the database',
    values: {
      aws: COMMIT_DISCOUNT.aws['3y'],
      azure: COMMIT_DISCOUNT.azure['3y'],
      gcp: COMMIT_DISCOUNT.gcp['3y'],
    },
    format: 'percent',
    sources: [SRC.awsSavingsPlans, SRC.awsRdsRi, SRC.azureReservations, SRC.gcpCud, SRC.gcpSqlCud],
  },
]);

/* ------------------------------------------------------------------------ */
/* Extras                                                                   */
/* ------------------------------------------------------------------------ */

const fmtInt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const pct = (factor) => `${Math.round(factor * 100)}%`;

/** A line item: `quantity × factor × unit price of serviceId`. */
const line = (serviceId, quantity, factor, label) => ({ serviceId, quantity, factor, label });

function backupRule({ quantities, provider }) {
  const storageGb = quantities['storage-object'];
  const dbGb =
    quantities['database-relational'] > 0 ? BACKUP_DB_SIZE_GB * BACKUP_DB_CHANGE_SHARE : 0;
  const snapshotGb = storageGb + dbGb;
  if (snapshotGb <= 0) return [];
  const retention = BACKUP_RETENTION_DAYS / 30;
  const parts = [];
  if (storageGb > 0) parts.push(`${fmtInt(storageGb)} GB of object storage`);
  if (dbGb > 0) {
    parts.push(
      `${fmtInt(dbGb)} GB (${pct(BACKUP_DB_CHANGE_SHARE)} of a ${BACKUP_DB_SIZE_GB} GB database)`
    );
  }
  return [
    line(
      'storage-object',
      snapshotGb * retention,
      BACKUP_TIER_FACTOR[provider],
      `Snapshot copies of ${parts.join(' + ')}, ${BACKUP_RETENTION_DAYS}-day retention, at ${pct(
        BACKUP_TIER_FACTOR[provider]
      )} of the hot rate`
    ),
  ];
}

function pilotLightLines({ quantities }) {
  const out = [];
  if (quantities['storage-object'] > 0) {
    out.push(
      line(
        'storage-object',
        quantities['storage-object'],
        1,
        'Second-region copy of object storage'
      )
    );
    out.push(
      line(
        'edge-cdn',
        quantities['storage-object'] * DR_REPLICATION_EGRESS_SHARE,
        1,
        `Replication egress: ${pct(DR_REPLICATION_EGRESS_SHARE)} of storage GB per month at the CDN rate`
      )
    );
  }
  if (quantities['database-relational'] > 0) {
    out.push(
      line(
        'database-relational',
        quantities['database-relational'],
        1,
        'Relational database replica in the second region'
      )
    );
  }
  return out;
}

function warmStandbyLines(ctx) {
  const out = pilotLightLines(ctx);
  const share = pct(DR_WARM_STANDBY_SHARE);
  if (ctx.quantities['compute-vm'] > 0) {
    out.push(
      line(
        'compute-vm',
        ctx.quantities['compute-vm'],
        DR_WARM_STANDBY_SHARE,
        `Standby compute at ${share} of the primary's hours`
      )
    );
  }
  if (ctx.quantities['containers-kubernetes'] > 0) {
    out.push(
      line(
        'containers-kubernetes',
        ctx.quantities['containers-kubernetes'],
        DR_WARM_STANDBY_SHARE,
        `Standby Kubernetes at ${share} of the primary's hours`
      )
    );
  }
  return out;
}

function activeActiveLines({ quantities }) {
  const out = [];
  for (const id of SERVICE_IDS) {
    if (quantities[id] > 0)
      out.push(line(id, quantities[id], 1, `Second region: ${serviceMeta(id).label} ×1 again`));
  }
  if (quantities['edge-cdn'] > 0) {
    out.push(
      line(
        'edge-cdn',
        quantities['edge-cdn'] * DR_ACTIVE_ACTIVE_EGRESS_SHARE,
        1,
        `Cross-region egress: ${pct(DR_ACTIVE_ACTIVE_EGRESS_SHARE)} of CDN egress`
      )
    );
  }
  return out;
}

function zoneRedundancyLines({ quantities, provider }) {
  const factors = ZONE_FACTOR[provider];
  const out = [];
  if (quantities['storage-object'] > 0) {
    out.push(
      line(
        'storage-object',
        quantities['storage-object'],
        factors.storage,
        factors.storage === 0
          ? 'Object storage: already zone-redundant at the listed price (×0)'
          : `Object storage: zone-redundant tier at +${pct(factors.storage)}`
      )
    );
  }
  if (quantities['database-relational'] > 0) {
    out.push(
      line(
        'database-relational',
        quantities['database-relational'],
        factors.db,
        `Relational database: standby instance in a second zone at +${pct(factors.db)}`
      )
    );
  }
  return out;
}

const commitmentRule =
  (term) =>
  ({ quantities, provider }) => {
    const discount = COMMIT_DISCOUNT[provider][term];
    const out = [];
    for (const id of COMMIT_SERVICES) {
      if (quantities[id] > 0) {
        out.push(
          line(
            id,
            quantities[id],
            -discount,
            `${serviceMeta(id).label}: ${pct(discount)} off for the term`
          )
        );
      }
    }
    return out;
  };

/**
 * The extras a reader can add. `group` is the mutual-exclusion group: two
 * extras in the same non-null group cannot both be on (one DR level, one
 * commitment term). `rule(ctx)` returns the line items for one provider, with
 * `ctx = { quantities, prices, provider }`; `ruleText` is the same rule in a
 * sentence for the "How this is calculated" section.
 */
export const EXTRAS = Object.freeze([
  {
    id: 'backup',
    label: 'Backup',
    blurb: 'Snapshot copies of storage and the database, kept for 30 days.',
    group: null,
    ruleText:
      'Object-storage GB-months equal to 100% of the object storage plus 20% of a 100 GB relational database (when the scenario has one), for 30 days of retention, priced at the provider’s backup-tier share of the hot object-storage rate.',
    rule: backupRule,
  },
  {
    id: 'dr-pilot-light',
    label: 'DR: pilot light',
    blurb: 'Data replicated to a second region, nothing running there until needed.',
    group: 'dr',
    ruleText:
      'A second-region copy of object storage (×1), a relational database replica (×1 of its hours) and replication egress of 10% of the storage GB per month at the CDN egress rate.',
    rule: pilotLightLines,
  },
  {
    id: 'dr-warm-standby',
    label: 'DR: warm standby',
    blurb: 'Pilot light plus a scaled-down copy of the application running in the second region.',
    group: 'dr',
    ruleText:
      'Pilot light, plus virtual-machine and Kubernetes hours at 50% of the scenario’s hours in the second region.',
    rule: warmStandbyLines,
  },
  {
    id: 'dr-active-active',
    label: 'DR: active-active',
    blurb: 'Everything running in two regions, traffic served from both.',
    group: 'dr',
    ruleText:
      'Every service ×1 again in the second region, plus cross-region egress of 25% of the CDN egress quantity at the CDN rate.',
    rule: activeActiveLines,
  },
  {
    id: 'zone-redundancy',
    label: 'Zone redundancy',
    blurb: 'Storage and the database spread across availability zones in the region.',
    group: null,
    ruleText:
      'An uplift on object storage and the relational database: ×0 where the listed price is already zone-redundant (S3 Standard, Cloud Storage regional), +25% for Azure ZRS over LRS, and +100% on the database for a standby instance (RDS Multi-AZ, Azure SQL zone redundancy, Cloud SQL HA).',
    rule: zoneRedundancyLines,
  },
  {
    id: 'commit-1y',
    label: '1-year commitment',
    blurb: 'A one-year savings plan, reservation or committed-use discount.',
    group: 'commit',
    ruleText:
      'A discount taken off virtual-machine, Kubernetes and relational-database lines: 28% on AWS (Compute Savings Plans, RDS reserved), 35% on Azure (reservations), 37% on Google Cloud (committed-use).',
    rule: commitmentRule('1y'),
  },
  {
    id: 'commit-3y',
    label: '3-year commitment',
    blurb: 'A three-year savings plan, reservation or committed-use discount.',
    group: 'commit',
    ruleText:
      'A discount taken off virtual-machine, Kubernetes and relational-database lines: 50% on AWS, 60% on Azure, 55% on Google Cloud.',
    rule: commitmentRule('3y'),
  },
]);

export const EXTRA_IDS = Object.freeze(EXTRAS.map((extra) => extra.id));

const EXTRA_BY_ID = new Map(EXTRAS.map((extra) => [extra.id, extra]));

export function extraById(extraId) {
  return EXTRA_BY_ID.get(extraId) ?? null;
}

/**
 * Unknown ids dropped, duplicates dropped, and within a mutual-exclusion group
 * the LAST one named wins — so a list built by appending the reader's latest
 * choice resolves in their favour. Returned in `EXTRAS` order, which is the
 * order the segments stack in.
 */
export function normalizeExtras(ids) {
  const chosen = new Map();
  for (const id of Array.isArray(ids) ? ids : []) {
    const extra = EXTRA_BY_ID.get(id);
    if (!extra) continue;
    if (extra.group) {
      for (const [otherId, other] of chosen)
        if (other.group === extra.group) chosen.delete(otherId);
    }
    chosen.set(id, extra);
  }
  return EXTRA_IDS.filter((id) => chosen.has(id));
}

/** The extras list with `extraId` switched on or off; exclusion applied. */
export function setExtra(ids, extraId, on) {
  const rest = (Array.isArray(ids) ? ids : []).filter((id) => id !== extraId);
  return normalizeExtras(on ? [...rest, extraId] : rest);
}

/**
 * The extras list with one group's choice replaced — `extraId` from that
 * group, or null for "none". What a radio group writes.
 */
export function setGroupChoice(ids, group, extraId) {
  const rest = (Array.isArray(ids) ? ids : []).filter((id) => EXTRA_BY_ID.get(id)?.group !== group);
  return normalizeExtras(extraId ? [...rest, extraId] : rest);
}

/** The chosen extra in a mutual-exclusion group, or null. */
export function groupChoice(ids, group) {
  return (Array.isArray(ids) ? ids : []).find((id) => EXTRA_BY_ID.get(id)?.group === group) ?? null;
}

/* ------------------------------------------------------------------------ */
/* Computation                                                              */
/* ------------------------------------------------------------------------ */

function isQuantity(value) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= 0;
}

/**
 * `{ [serviceId]: { [provider]: { unitPrice, source } } }` from the payload's
 * services. A provider absent from a service's rows is absent here too.
 */
export function priceTable(pricing) {
  const table = {};
  for (const service of Array.isArray(pricing?.services) ? pricing.services : []) {
    const byProvider = {};
    for (const row of Array.isArray(service?.rows) ? service.rows : []) {
      const unitPrice = Number(row?.pricePerUnit);
      if (
        row?.provider &&
        Number.isFinite(unitPrice) &&
        unitPrice >= 0 &&
        !byProvider[row.provider]
      ) {
        byProvider[row.provider] = {
          unitPrice,
          source: row.source === 'baseline' ? 'baseline' : 'live',
        };
      }
    }
    if (service?.serviceId) table[service.serviceId] = byProvider;
  }
  return table;
}

/**
 * Price one provider's lines. A line that needs a price the provider lacks
 * lands in `unavailable`; one priced from the catalogue lands in `catalogue`.
 * A line whose quantity × factor is zero costs nothing and needs no price.
 */
function priceLines(lines, prices, provider, unavailable, catalogue) {
  const priced = [];
  for (const item of lines) {
    const cell = prices[item.serviceId]?.[provider] ?? null;
    const multiplier = item.quantity * item.factor;
    if (!cell && multiplier !== 0) {
      unavailable.add(item.serviceId);
      priced.push({ ...item, unitPrice: null, cost: null, source: 'unavailable' });
      continue;
    }
    if (cell?.source === 'baseline' && multiplier !== 0) catalogue.add(item.serviceId);
    priced.push({
      ...item,
      unitPrice: cell ? cell.unitPrice : null,
      cost: cell ? multiplier * cell.unitPrice : 0,
      source: cell ? cell.source : 'unpriced',
    });
  }
  return priced;
}

const sumCosts = (lines) => lines.reduce((sum, item) => sum + (item.cost ?? 0), 0);

function computeProvider({ provider, quantities, prices, extras }) {
  const unavailable = new Set();
  const catalogue = new Set();
  const baseLines = SERVICE_IDS.filter((id) => quantities[id] > 0).map((id) =>
    line(id, quantities[id], 1, serviceMeta(id).label)
  );
  const base = priceLines(baseLines, prices, provider, unavailable, catalogue);
  const segments = extras.map((extraId) => {
    const extra = EXTRA_BY_ID.get(extraId);
    const lines = priceLines(
      extra.rule({ quantities, prices, provider }),
      prices,
      provider,
      unavailable,
      catalogue
    );
    return { extraId, label: extra.label, lines, cost: unavailable.size ? null : sumCosts(lines) };
  });
  const available = unavailable.size === 0;
  const total = available ? sumCosts(base) + segments.reduce((sum, s) => sum + s.cost, 0) : null;
  return {
    provider,
    base: { total: available ? sumCosts(base) : null, lines: base },
    segments: available ? segments : segments.map((s) => ({ ...s, cost: null })),
    total,
    monthly: total,
    yearly: total === null ? null : total * 12,
    unavailable: SERVICE_IDS.filter((id) => unavailable.has(id)),
    catalogue: SERVICE_IDS.filter((id) => catalogue.has(id)),
    deltaFromCheapest: null,
  };
}

/**
 * The scenario priced on every provider.
 *
 * @param {object} args
 * @param {object|null} args.pricing  the `pricing` object from the API
 * @param {string} [args.scenarioId]
 * @param {Record<string, number>} [args.quantities]  overrides on the scenario
 * @param {string[]} [args.extras]
 * @param {number|null} [args.egressGb]  overrides the CDN egress quantity
 * @returns {{ scenarioId: string, quantities: Record<string, number>, extras: string[],
 *   providers: object[], cheapest: string[] }}
 */
export function computeScenario({ pricing, scenarioId, quantities, extras, egressGb = null }) {
  const scenario = scenarioById(scenarioId);
  const effective = effectiveQuantities(scenario.id, quantities, egressGb);
  const chosen = normalizeExtras(extras);
  const prices = priceTable(pricing);
  const providers = PROVIDER_IDS.map((provider) =>
    computeProvider({ provider, quantities: effective, prices, extras: chosen })
  );
  const priced = providers.filter((p) => p.total !== null);
  const lowest = priced.length ? Math.min(...priced.map((p) => p.total)) : null;
  for (const p of providers) {
    if (p.total === null || lowest === null) continue;
    p.deltaFromCheapest = lowest > 0 ? (p.total - lowest) / lowest : 0;
  }
  return {
    scenarioId: scenario.id,
    quantities: effective,
    extras: chosen,
    providers,
    cheapest: providers
      .filter((p) => p.total !== null && p.total === lowest)
      .map((p) => p.provider),
  };
}

/* ------------------------------------------------------------------------ */
/* Shareable URL                                                            */
/* ------------------------------------------------------------------------ */

const QUANTITY_PREFIX = 'q.';

/** The query keys this module owns; `?region=` is the page's, not ours. */
export function isScenarioParam(key) {
  return (
    key === 'scenario' || key === 'extras' || key === 'egress' || key.startsWith(QUANTITY_PREFIX)
  );
}

/**
 * Scenario state as query entries, defaults left out so the canonical URL for
 * the default scenario is bare: `scenario=` only when not the default,
 * `extras=` only when any, `egress=` for a CDN override and `q.<service>=` for
 * any other quantity that differs from the scenario's own.
 *
 * @returns {Record<string, string>}
 */
export function encodeScenario(state) {
  const scenario = scenarioById(state?.scenarioId);
  const defaults = scenarioQuantities(scenario.id);
  const out = {};
  if (scenario.id !== DEFAULT_SCENARIO_ID) out.scenario = scenario.id;
  const extras = normalizeExtras(state?.extras);
  if (extras.length) out.extras = extras.join(',');
  for (const id of SERVICE_IDS) {
    const value = state?.quantities?.[id];
    if (!isQuantity(value) || Number(value) === defaults[id]) continue;
    out[id === 'edge-cdn' ? 'egress' : `${QUANTITY_PREFIX}${id}`] = String(Number(value));
  }
  return out;
}

/**
 * The inverse of `encodeScenario`, tolerant of anything a hand-edited URL can
 * carry: an unknown scenario falls back to the default, unknown extras are
 * dropped, a quantity that is not a finite non-negative number is ignored.
 * `quantities` holds only the overrides that survived, never the defaults.
 *
 * @param {URLSearchParams|Record<string,string>|null} searchParams
 * @returns {{ scenarioId: string, extras: string[], quantities: Record<string, number> }}
 */
export function decodeScenario(searchParams) {
  const get = (key) => {
    if (!searchParams) return null;
    if (typeof searchParams.get === 'function') return searchParams.get(key);
    return Object.prototype.hasOwnProperty.call(searchParams, key) ? searchParams[key] : null;
  };
  const scenarioId = SCENARIO_BY_ID.has(get('scenario')) ? get('scenario') : DEFAULT_SCENARIO_ID;
  const extras = normalizeExtras(String(get('extras') ?? '').split(','));
  const defaults = scenarioQuantities(scenarioId);
  const quantities = {};
  for (const id of SERVICE_IDS) {
    const raw = get(id === 'edge-cdn' ? 'egress' : `${QUANTITY_PREFIX}${id}`);
    if (raw === null || raw === undefined || !isQuantity(raw)) continue;
    const value = Number(raw);
    if (value !== defaults[id]) quantities[id] = value;
  }
  return { scenarioId, extras, quantities };
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

/**
 * A monthly or yearly cost: "$1,234.56", "−$120.00" for a discount. Two
 * decimals rather than `formatPrice`'s four significant figures, because a
 * total is money owed, not a rate. Fixed to en-US for the hydration reason
 * `formatPrice` gives.
 */
export function formatCost(value, currency = 'USD') {
  const amount = value === null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(amount)) return null;
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return amount < 0 ? `−${abs}` : abs;
}

/** "+12%" for a provider's distance from the cheapest; "" for the cheapest. */
export function formatDelta(delta) {
  if (!Number.isFinite(delta) || delta <= 0) return '';
  return `+${Math.round(delta * 100)}%`;
}

/** An assumption's value in the format its row declares. */
export function formatAssumption(value, format) {
  if (!Number.isFinite(Number(value))) return '—';
  if (format === 'percent') return pct(Number(value));
  if (format === 'factor') return `×${Number(value)}`;
  return fmtInt(Number(value));
}

/** A quantity for a label: "1,460", "0.5". */
export function formatQuantity(value) {
  const n = value === null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
