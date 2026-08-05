/**
 * Firestore Data Population Script
 * Run with: node scripts/populate-firestore.cjs
 *
 * This script populates Firestore with sample content for:
 * - Blog articles (AWS, Azure, GCP)
 * - Architecture designs (AWS, Azure, GCP)
 * - Frameworks
 * - Education resources
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '../firebase-service-account.json');

try {
  const serviceAccount = require(serviceAccountPath);
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log('✓ Firebase Admin initialized');
} catch (error) {
  console.error('❌ Error initializing Firebase Admin:', error.message);
  console.log('\nPlease ensure you have:');
  console.log('1. Downloaded your Firebase service account key');
  console.log('2. Saved it as firebase-service-account.json in the project root');
  console.log('3. Or set FIREBASE_SERVICE_ACCOUNT_PATH environment variable');
  process.exit(1);
}

const db = getFirestore();

// Sample content data
const contentData = {
  aws: {
    blog: [
      {
        slug: 'multi-region-resilient-architectures',
        title: 'Designing Multi-Region Resilient Architectures on AWS',
        description:
          'Learn how to build highly available applications across multiple AWS regions with automated failover and disaster recovery strategies.',
        content:
          '<h2>Introduction</h2><p>Multi-region architectures are essential for mission-critical applications...</p>',
        author: 'Cloud Architect Team',
        date: 'Feb 8, 2026',
        category: 'Architecture',
        tags: ['Multi-Region', 'High Availability', 'DR'],
        readTime: 12,
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
      {
        slug: 'aws-cost-optimization-2026',
        title: 'AWS Cost Optimization: A Comprehensive 2026 Guide',
        description:
          'Discover proven strategies to reduce your AWS bill by up to 40% through reserved instances, savings plans, and right-sizing.',
        content:
          '<h2>Cost Optimization Strategies</h2><p>Effective cost management starts with visibility...</p>',
        author: 'FinOps Team',
        date: 'Feb 5, 2026',
        category: 'Cost Optimization',
        tags: ['FinOps', 'Savings', 'Best Practices'],
        readTime: 15,
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
    architectures: [
      {
        slug: 'multi-tier-web-application',
        title: 'Multi-Tier Web Application with Auto Scaling',
        description:
          'Production-ready architecture featuring ALB, Auto Scaling Groups, RDS Multi-AZ, and ElastiCache for high availability.',
        overview:
          '<h2>Architecture Overview</h2><p>This reference architecture demonstrates a scalable, highly available web application...</p>',
        category: 'Web Applications',
        complexity: 'Intermediate',
        tags: ['ALB', 'Auto Scaling', 'RDS', 'ElastiCache'],
        estimatedCost: '$800-$2,500/month',
        terraformCode:
          'resource "aws_lb" "main" {\n  name = "web-alb"\n  load_balancer_type = "application"\n}',
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
  },
  azure: {
    blog: [
      {
        slug: 'azure-landing-zones-enterprise',
        title: 'Azure Landing Zones: Enterprise-Scale Architecture',
        description:
          'Comprehensive guide to implementing Azure Landing Zones with management groups, policies, and governance at scale.',
        content:
          '<h2>Enterprise-Scale Landing Zones</h2><p>Azure Landing Zones provide a foundation for enterprise cloud adoption...</p>',
        author: 'Enterprise Architecture Team',
        date: 'Feb 9, 2026',
        category: 'Architecture',
        tags: ['Landing Zones', 'Governance', 'Enterprise'],
        readTime: 18,
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
    architectures: [
      {
        slug: 'hub-spoke-network-topology',
        title: 'Hub-Spoke Network Topology with Azure Firewall',
        description:
          'Centralized network architecture using hub-spoke topology, Azure Firewall, and Network Security Groups for enterprise security.',
        overview:
          '<h2>Hub-Spoke Architecture</h2><p>The hub-spoke topology is a proven pattern for enterprise networking...</p>',
        category: 'Networking',
        complexity: 'Advanced',
        tags: ['Networking', 'Firewall', 'Hub-Spoke'],
        estimatedCost: '$1,200-$3,500/month',
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
  },
  gcp: {
    blog: [
      {
        slug: 'building-ml-pipelines-vertex-ai',
        title: 'Building ML Pipelines with Vertex AI',
        description:
          'End-to-end machine learning workflows using Vertex AI Pipelines, AutoML, and custom training jobs.',
        content:
          '<h2>ML Pipeline Architecture</h2><p>Vertex AI provides a unified platform for building production ML systems...</p>',
        author: 'ML Engineering Team',
        date: 'Feb 8, 2026',
        category: 'AI/ML',
        tags: ['Vertex AI', 'ML Pipelines', 'AutoML'],
        readTime: 20,
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
    architectures: [
      {
        slug: 'data-lake-cloud-storage',
        title: 'Data Lake Architecture with Cloud Storage',
        description:
          'Scalable data lake using Cloud Storage, Dataproc, and BigQuery for petabyte-scale analytics.',
        overview:
          '<h2>Data Lake Design</h2><p>Modern data lakes on GCP leverage Cloud Storage for cost-effective storage...</p>',
        category: 'Data & Analytics',
        complexity: 'Intermediate',
        tags: ['Data Lake', 'BigQuery', 'Cloud Storage'],
        estimatedCost: '$500-$2,000/month',
        published: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    ],
  },
};

async function populateFirestore() {
  console.log('\n🚀 Starting Firestore population...\n');

  try {
    let totalDocs = 0;

    for (const [provider, collections] of Object.entries(contentData)) {
      console.log(`\n📦 Populating ${provider.toUpperCase()} content...`);

      // Populate blog articles
      if (collections.blog) {
        for (const article of collections.blog) {
          const docRef = db
            .collection(provider)
            .doc('blog')
            .collection('articles')
            .doc(article.slug);
          await docRef.set(article);
          console.log(`  ✓ Blog: ${article.title}`);
          totalDocs++;
        }
      }

      // Populate architectures
      if (collections.architectures) {
        for (const arch of collections.architectures) {
          const docRef = db
            .collection(provider)
            .doc('architectures')
            .collection('designs')
            .doc(arch.slug);
          await docRef.set(arch);
          console.log(`  ✓ Architecture: ${arch.title}`);
          totalDocs++;
        }
      }
    }

    // Add metadata collection
    await db
      .collection('metadata')
      .doc('stats')
      .set({
        totalArticles: totalDocs,
        lastUpdated: FieldValue.serverTimestamp(),
        providers: ['aws', 'azure', 'gcp'],
      });

    console.log(`\n✅ Successfully populated ${totalDocs} documents in Firestore!`);
    console.log('\n📊 Collection structure:');
    console.log('   - aws/blog/articles/{slug}');
    console.log('   - aws/architectures/designs/{slug}');
    console.log('   - azure/blog/articles/{slug}');
    console.log('   - azure/architectures/designs/{slug}');
    console.log('   - gcp/blog/articles/{slug}');
    console.log('   - gcp/architectures/designs/{slug}');
    console.log('   - metadata/stats');
  } catch (error) {
    console.error('\n❌ Error populating Firestore:', error);
    process.exit(1);
  }
}

// Run the population
populateFirestore()
  .then(() => {
    console.log('\n✨ Firestore population complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
