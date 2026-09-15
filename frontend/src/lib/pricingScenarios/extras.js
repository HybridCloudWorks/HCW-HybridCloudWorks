/**
 * The extras a reader can add (#613, Phase 2), each a rule that turns the
 * scenario's quantities into line items priced off the SAME eight meters as
 * the base bill — a backup is object-storage GB-months at a cheaper tier, a
 * DR replica is relational-database hours, replication is CDN-rate egress.
 * Every multiplier comes from assumptions.js, so the page's "How this is
 * calculated" table and these rules cannot disagree.
 */
import {
  BACKUP_DB_CHANGE_SHARE,
  BACKUP_DB_SIZE_GB,
  BACKUP_RETENTION_DAYS,
  BACKUP_TIER_FACTOR,
  COMMIT_DISCOUNT,
  DR_ACTIVE_ACTIVE_EGRESS_SHARE,
  DR_REPLICATION_EGRESS_SHARE,
  DR_WARM_STANDBY_SHARE,
  ZONE_FACTOR,
} from './assumptions';
import { fmtInt, pct } from './format';
import { SERVICE_IDS, line, serviceMeta } from './services';

const COMMIT_SERVICES = Object.freeze([
  'compute-vm',
  'containers-kubernetes',
  'database-relational',
]);

/** What a backup copies, in words: the storage, and the database's share. */
function backupParts(storageGb, dbGb) {
  const parts = [];
  if (storageGb > 0) parts.push(`${fmtInt(storageGb)} GB of object storage`);
  if (dbGb > 0) {
    parts.push(
      `${fmtInt(dbGb)} GB (${pct(BACKUP_DB_CHANGE_SHARE)} of a ${BACKUP_DB_SIZE_GB} GB database)`
    );
  }
  return parts.join(' + ');
}

function backupRule({ quantities, provider }) {
  const storageGb = quantities['storage-object'];
  const dbGb =
    quantities['database-relational'] > 0 ? BACKUP_DB_SIZE_GB * BACKUP_DB_CHANGE_SHARE : 0;
  const snapshotGb = storageGb + dbGb;
  if (snapshotGb <= 0) return [];
  const retention = BACKUP_RETENTION_DAYS / 30;
  const tier = BACKUP_TIER_FACTOR[provider];
  return [
    line(
      'storage-object',
      snapshotGb * retention,
      tier,
      `Snapshot copies of ${backupParts(storageGb, dbGb)}, ${BACKUP_RETENTION_DAYS}-day retention, at ${pct(tier)} of the hot rate`
    ),
  ];
}

function pilotLightLines({ quantities }) {
  const out = [];
  const storageGb = quantities['storage-object'];
  if (storageGb > 0) {
    out.push(line('storage-object', storageGb, 1, 'Second-region copy of object storage'));
    out.push(
      line(
        'edge-cdn',
        storageGb * DR_REPLICATION_EGRESS_SHARE,
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
  for (const [id, what] of [
    ['compute-vm', 'compute'],
    ['containers-kubernetes', 'Kubernetes'],
  ]) {
    if (ctx.quantities[id] > 0) {
      out.push(
        line(
          id,
          ctx.quantities[id],
          DR_WARM_STANDBY_SHARE,
          `Standby ${what} at ${share} of the primary's hours`
        )
      );
    }
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
    return COMMIT_SERVICES.filter((id) => quantities[id] > 0).map((id) =>
      line(
        id,
        quantities[id],
        -discount,
        `${serviceMeta(id).label}: ${pct(discount)} off for the term`
      )
    );
  };

/**
 * `group` is the mutual-exclusion group: two extras in the same non-null
 * group cannot both be on (one DR level, one commitment term). `rule(ctx)`
 * returns the line items for one provider, with `ctx = { quantities, prices,
 * provider }`; `ruleText` is the same rule in a sentence for the "How this is
 * calculated" section.
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

const asList = (ids) => (Array.isArray(ids) ? ids : []);
const groupOf = (id) => EXTRA_BY_ID.get(id)?.group ?? null;

/**
 * Unknown ids dropped, duplicates dropped, and within a mutual-exclusion group
 * the LAST one named wins — so a list built by appending the reader's latest
 * choice resolves in their favour. Returned in `EXTRAS` order, which is the
 * order the segments stack in.
 */
export function normalizeExtras(ids) {
  const chosen = new Set();
  for (const id of asList(ids)) {
    const extra = EXTRA_BY_ID.get(id);
    if (!extra) continue;
    if (extra.group) {
      for (const otherId of chosen) if (groupOf(otherId) === extra.group) chosen.delete(otherId);
    }
    chosen.add(id);
  }
  return EXTRA_IDS.filter((id) => chosen.has(id));
}

/** The extras list with `extraId` switched on or off; exclusion applied. */
export function setExtra(ids, extraId, on) {
  const rest = asList(ids).filter((id) => id !== extraId);
  return normalizeExtras(on ? [...rest, extraId] : rest);
}

/**
 * The extras list with one group's choice replaced — `extraId` from that
 * group, or null for "none". What a radio group writes.
 */
export function setGroupChoice(ids, group, extraId) {
  const rest = asList(ids).filter((id) => groupOf(id) !== group);
  return normalizeExtras(extraId ? [...rest, extraId] : rest);
}

/** The chosen extra in a mutual-exclusion group, or null. */
export function groupChoice(ids, group) {
  return asList(ids).find((id) => groupOf(id) === group) ?? null;
}
