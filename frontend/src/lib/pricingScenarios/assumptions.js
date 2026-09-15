/**
 * Every multiplier the extras use, with its source (#613, Phase 2). The rules
 * in extras.js read their numbers from these constants, and `ASSUMPTIONS` is
 * the same constants as a table the page renders under "How this is
 * calculated" — so a factor that is not in it is a factor a reader cannot
 * check, and the page cannot say one thing and compute another.
 */
import { HOURS_PER_MONTH } from './services';

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

const same = (value) => Object.freeze({ aws: value, azure: value, gcp: value });
const perProvider = (pick) =>
  Object.freeze({ aws: pick('aws'), azure: pick('azure'), gcp: pick('gcp') });
const src = (label, url) => Object.freeze({ label, url });

const SRC = Object.freeze({
  awsEbsSnapshots: src('AWS EBS snapshot pricing', 'https://aws.amazon.com/ebs/pricing/'),
  awsBackup: src('AWS Backup pricing', 'https://aws.amazon.com/backup/pricing/'),
  azureBackup: src('Azure Backup pricing', 'https://azure.microsoft.com/pricing/details/backup/'),
  azureDisks: src(
    'Azure managed disk snapshot pricing',
    'https://azure.microsoft.com/pricing/details/managed-disks/'
  ),
  gcpSnapshots: src(
    'Google Cloud disk and snapshot pricing',
    'https://cloud.google.com/compute/disks-image-pricing'
  ),
  awsDr: src(
    'AWS: disaster recovery options in the cloud',
    'https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html'
  ),
  azureDr: src(
    'Azure: disaster recovery overview',
    'https://learn.microsoft.com/azure/reliability/disaster-recovery-overview'
  ),
  gcpDr: src(
    'Google Cloud: DR planning guide',
    'https://cloud.google.com/architecture/dr-scenarios-planning-guide'
  ),
  awsS3: src('Amazon S3 pricing', 'https://aws.amazon.com/s3/pricing/'),
  awsS3Durability: src(
    'Amazon S3 data durability (stored across at least three AZs)',
    'https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html'
  ),
  azureBlob: src(
    'Azure Blob Storage pricing (LRS vs ZRS)',
    'https://azure.microsoft.com/pricing/details/storage/blobs/'
  ),
  azureRedundancy: src(
    'Azure Storage redundancy',
    'https://learn.microsoft.com/azure/storage/common/storage-redundancy'
  ),
  gcpStorage: src('Cloud Storage pricing', 'https://cloud.google.com/storage/pricing'),
  gcpLocations: src(
    'Cloud Storage bucket locations (regional is multi-zone)',
    'https://cloud.google.com/storage/docs/locations'
  ),
  awsRds: src('Amazon RDS pricing (Multi-AZ)', 'https://aws.amazon.com/rds/pricing/'),
  azureSqlZr: src(
    'Azure SQL Database zone redundancy',
    'https://learn.microsoft.com/azure/azure-sql/database/high-availability-sla-local-zone-redundancy'
  ),
  gcpSqlHa: src(
    'Cloud SQL high availability (standby billed)',
    'https://cloud.google.com/sql/docs/mysql/high-availability'
  ),
  gcpSqlPricing: src('Cloud SQL pricing', 'https://cloud.google.com/sql/pricing'),
  awsSavingsPlans: src('AWS Savings Plans pricing', 'https://aws.amazon.com/savingsplans/pricing/'),
  awsRdsRi: src('Amazon RDS reserved instances', 'https://aws.amazon.com/rds/reserved-instances/'),
  azureReservations: src('Azure reservations', 'https://azure.microsoft.com/pricing/reservations/'),
  azureReservationsDoc: src(
    'Azure: save costs with reservations',
    'https://learn.microsoft.com/azure/cost-management-billing/reservations/save-compute-costs-reservations'
  ),
  gcpCud: src(
    'Google Cloud committed-use discounts',
    'https://cloud.google.com/compute/docs/instances/committed-use-discounts-overview'
  ),
  gcpSqlCud: src(
    'Cloud SQL committed-use discounts',
    'https://cloud.google.com/sql/docs/mysql/cud'
  ),
});

const BACKUP_SOURCES = [SRC.awsBackup, SRC.azureBackup, SRC.gcpSnapshots];
const DR_SOURCES = [SRC.awsDr, SRC.azureDr, SRC.gcpDr];
const COMMIT_SOURCES = [
  SRC.awsSavingsPlans,
  SRC.awsRdsRi,
  SRC.azureReservations,
  SRC.gcpCud,
  SRC.gcpSqlCud,
];

const row = (id, label, values, format, sources) =>
  Object.freeze({ id, label, values, format, sources });

/**
 * Every factor the rules use, one row each, with the page it was read from.
 * `format` is how the page prints the value: a plain number, a ×factor, or a
 * percentage.
 */
export const ASSUMPTIONS = Object.freeze([
  row('hours-per-month', 'Hours in a billing month', same(HOURS_PER_MONTH), 'number', [
    SRC.awsSavingsPlans,
    SRC.azureReservationsDoc,
    SRC.gcpCud,
  ]),
  row(
    'backup-tier-factor',
    'Backup storage rate, as a share of the hot object-storage rate',
    BACKUP_TIER_FACTOR,
    'factor',
    [SRC.awsEbsSnapshots, SRC.awsBackup, SRC.azureBackup, SRC.azureDisks, SRC.gcpSnapshots]
  ),
  row(
    'backup-db-size',
    'Relational database size assumed for backups (GB)',
    same(BACKUP_DB_SIZE_GB),
    'number',
    BACKUP_SOURCES
  ),
  row(
    'backup-db-change-share',
    'Share of the database captured per backup cycle',
    same(BACKUP_DB_CHANGE_SHARE),
    'factor',
    BACKUP_SOURCES
  ),
  row(
    'backup-retention-days',
    'Backup retention (days)',
    same(BACKUP_RETENTION_DAYS),
    'number',
    BACKUP_SOURCES
  ),
  row(
    'dr-replication-egress',
    'Pilot light: monthly replication egress, as a share of storage GB',
    same(DR_REPLICATION_EGRESS_SHARE),
    'factor',
    DR_SOURCES
  ),
  row(
    'dr-warm-standby-share',
    'Warm standby: compute and Kubernetes hours in the second region',
    same(DR_WARM_STANDBY_SHARE),
    'factor',
    DR_SOURCES
  ),
  row(
    'dr-active-active-egress',
    'Active-active: cross-region egress, as a share of CDN egress',
    same(DR_ACTIVE_ACTIVE_EGRESS_SHARE),
    'factor',
    DR_SOURCES
  ),
  row(
    'zone-storage-uplift',
    'Zone redundancy: uplift on object storage',
    perProvider((p) => ZONE_FACTOR[p].storage),
    'factor',
    [
      SRC.awsS3Durability,
      SRC.awsS3,
      SRC.azureBlob,
      SRC.azureRedundancy,
      SRC.gcpLocations,
      SRC.gcpStorage,
    ]
  ),
  row(
    'zone-db-uplift',
    'Zone redundancy: uplift on the relational database',
    perProvider((p) => ZONE_FACTOR[p].db),
    'factor',
    [SRC.awsRds, SRC.azureSqlZr, SRC.gcpSqlHa, SRC.gcpSqlPricing]
  ),
  row(
    'commit-1y',
    '1-year commitment: discount on compute, Kubernetes and the database',
    perProvider((p) => COMMIT_DISCOUNT[p]['1y']),
    'percent',
    COMMIT_SOURCES
  ),
  row(
    'commit-3y',
    '3-year commitment: discount on compute, Kubernetes and the database',
    perProvider((p) => COMMIT_DISCOUNT[p]['3y']),
    'percent',
    COMMIT_SOURCES
  ),
]);
