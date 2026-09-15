/**
 * Where each cell of the pricing comparison links to: the provider's own
 * pricing page for the product behind that service id (#613).
 *
 * STATIC ON PURPOSE. These are the only hrefs on the page, and none of them
 * comes from data — the API supplies prices and SKUs, never URLs — so there is
 * nothing for `safeUrl` to check. A provider's product page is also the one
 * thing a reader can verify a number against, which is why every cell links,
 * including an unavailable one.
 *
 * The product behind each id is the one the server's live loaders query
 * (functions/src/lib/cloud-tools/pricing/{aws,azure,gcp}.js): EC2 / Virtual
 * Machines / Compute Engine, Lambda / Functions / Cloud Run functions, S3 /
 * Blob Storage / Cloud Storage, RDS / SQL Database / Cloud SQL, DynamoDB /
 * Cosmos DB / Firestore, EKS / AKS / GKE, SQS / Service Bus / Pub/Sub, and
 * CloudFront / Azure bandwidth / Cloud CDN. Change the loader and this map
 * together, or a cell will link to a page that does not carry its number.
 */
export const PRICING_PAGES = Object.freeze({
  aws: Object.freeze({
    'compute-vm': 'https://aws.amazon.com/ec2/pricing/on-demand/',
    'compute-serverless': 'https://aws.amazon.com/lambda/pricing/',
    'storage-object': 'https://aws.amazon.com/s3/pricing/',
    'database-relational': 'https://aws.amazon.com/rds/pricing/',
    'database-nosql': 'https://aws.amazon.com/dynamodb/pricing/',
    'containers-kubernetes': 'https://aws.amazon.com/eks/pricing/',
    'integration-messaging': 'https://aws.amazon.com/sqs/pricing/',
    'edge-cdn': 'https://aws.amazon.com/cloudfront/pricing/',
  }),
  azure: Object.freeze({
    'compute-vm': 'https://azure.microsoft.com/pricing/details/virtual-machines/linux/',
    'compute-serverless': 'https://azure.microsoft.com/pricing/details/functions/',
    'storage-object': 'https://azure.microsoft.com/pricing/details/storage/blobs/',
    'database-relational': 'https://azure.microsoft.com/pricing/details/azure-sql-database/single/',
    'database-nosql':
      'https://azure.microsoft.com/pricing/details/cosmos-db/autoscale-provisioned/',
    'containers-kubernetes': 'https://azure.microsoft.com/pricing/details/kubernetes-service/',
    'integration-messaging': 'https://azure.microsoft.com/pricing/details/service-bus/',
    'edge-cdn': 'https://azure.microsoft.com/pricing/details/bandwidth/',
  }),
  gcp: Object.freeze({
    'compute-vm': 'https://cloud.google.com/compute/vm-instance-pricing',
    'compute-serverless': 'https://cloud.google.com/functions/pricing',
    'storage-object': 'https://cloud.google.com/storage/pricing',
    'database-relational': 'https://cloud.google.com/sql/pricing',
    'database-nosql': 'https://cloud.google.com/firestore/pricing',
    'containers-kubernetes': 'https://cloud.google.com/kubernetes-engine/pricing',
    'integration-messaging': 'https://cloud.google.com/pubsub/pricing',
    'edge-cdn': 'https://cloud.google.com/cdn/pricing',
  }),
});

/**
 * The provider's front door for prices, for a service id this map has not
 * been taught. A new service in the server catalogue then links somewhere
 * true rather than nowhere, and the mapping test names the gap.
 */
export const PRICING_HOME = Object.freeze({
  aws: 'https://aws.amazon.com/pricing/',
  azure: 'https://azure.microsoft.com/pricing/',
  gcp: 'https://cloud.google.com/pricing',
});

/**
 * @param {'aws'|'azure'|'gcp'} provider
 * @param {string} serviceId
 * @returns {string|null} null for a provider this page does not know
 */
export function pricingPageFor(provider, serviceId) {
  return PRICING_PAGES[provider]?.[serviceId] ?? PRICING_HOME[provider] ?? null;
}
