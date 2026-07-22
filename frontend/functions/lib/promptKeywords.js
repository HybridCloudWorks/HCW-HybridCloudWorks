'use strict';

// ============================================================================
// Prompt keyword matrix
// ----------------------------------------------------------------------------
// Two layers, both editable in the Prompts admin UI:
//
//   1. SYNONYMS      → collapse messy raw tags into a canonical tag.
//                      ("aurora", "mysql", "postgres", "sql") → "Database"
//   2. AUGMENTATIONS → when a keyword appears anywhere (title, summary, tags),
//                      append a directive that pulls in a specific icon /
//                      scene element so the hero image stays on-theme.
//
// Storage:
//   prompt_keyword_synonyms/{id}      → { canonical, patterns: ["str", ...] }
//   prompt_keyword_augmentations/{id} → { label, patterns: ["str", ...], directive }
//
// If Firestore returns nothing, the SEED constants below are used so a fresh
// project still gets useful behaviour out of the box.
// ============================================================================

const SEED_SYNONYMS = [
  {
    canonical: 'Database',
    patterns: [
      'aurora',
      'mysql',
      'postgres',
      'postgresql',
      'rds',
      'dynamodb',
      'cosmosdb',
      'spanner',
      'bigtable',
      'firestore',
      'sql server',
      'mssql',
      'mariadb',
      'oracle db',
      'cockroach',
      'neon',
      'planetscale',
      'database',
      'databases',
      'redis',
      'memcached',
    ],
  },
  {
    canonical: 'AI / ML',
    patterns: [
      'bedrock',
      'sagemaker',
      'openai',
      'anthropic',
      'claude',
      'gpt',
      'gemini',
      'llama',
      'mistral',
      'foundry',
      'vertex ai',
      'azure openai',
      'llm',
      'llms',
      'prompt',
      'rag',
      'embedding',
      'fine-tune',
      'fine tuning',
      'inference',
      'machine learning',
      'generative ai',
    ],
  },
  {
    canonical: 'Storage',
    patterns: [
      's3',
      'blob',
      'file share',
      'data lake',
      'glacier',
      'ebs',
      'efs',
      'fsx',
      'azure files',
      'azure blob',
      'bucket',
      'storage account',
    ],
  },
  {
    canonical: 'Compute',
    patterns: [
      'ec2',
      'lambda',
      'fargate',
      'app service',
      'container apps',
      'cloud run',
      'functions',
      'vm',
      'virtual machine',
      'gke',
      'eks',
      'aks',
      'kubernetes',
      'k8s',
    ],
  },
  {
    canonical: 'Networking',
    patterns: [
      'vpc',
      'vnet',
      'subnet',
      'nat gateway',
      'application gateway',
      'load balancer',
      'cloudfront',
      'front door',
      'cdn',
      'dns',
      'route 53',
      'networking',
    ],
  },
  {
    canonical: 'Security',
    patterns: [
      'iam',
      'rbac',
      'defender',
      'sentinel',
      'guardduty',
      'inspector',
      'security hub',
      'key vault',
      'secrets manager',
      'kms',
      'zero trust',
      'encryption',
      'authentication',
      'authorization',
      'oauth',
      'saml',
      'mfa',
    ],
  },
  {
    canonical: 'DevOps',
    patterns: [
      'github actions',
      'azure devops',
      'gitops',
      'argocd',
      'terraform',
      'bicep',
      'cloudformation',
      'pulumi',
      'ansible',
      'ci/cd',
      'cicd',
      'pipeline',
      'deployment',
    ],
  },
  {
    canonical: 'Backup & Recovery',
    patterns: ['backup', 'restore', 'disaster recovery', 'snapshot', 'recovery services vault'],
  },
  {
    canonical: 'Observability',
    patterns: [
      'cloudwatch',
      'application insights',
      'log analytics',
      'otel',
      'opentelemetry',
      'datadog',
      'new relic',
      'grafana',
      'prometheus',
      'observability',
      'monitoring',
      'telemetry',
      'tracing',
    ],
  },
  {
    canonical: 'Certification',
    patterns: [
      'certification',
      'certified',
      'certify',
      'exam',
      'aws certified',
      'az-104',
      'az-204',
      'az-305',
      'az-900',
      'saa-c03',
      'sap-c02',
    ],
  },
];

const SEED_AUGMENTATIONS = [
  {
    label: 'kiro',
    patterns: ['kiro'],
    directive:
      'The cloud engineer is holding or working with the Kiro AI assistant logo / icon (a stylized friendly robot/chat avatar). Include the Kiro icon prominently in the scene.',
  },
  {
    label: 'aws-backup',
    patterns: ['aws backup', 'backup vault'],
    directive:
      'The character is storing or rearranging stacked AWS-orange lego blocks; one block has a disk icon and another has a VM icon on it.',
  },
  {
    label: 'azure-backup',
    patterns: ['azure backup', 'recovery services vault'],
    directive:
      'The character is storing or rearranging stacked Azure-blue lego blocks; one block has a disk icon and another has a VM icon on it.',
  },
  {
    label: 'certification',
    patterns: ['certification', 'certified', 'exam', 'az-', 'saa-c', 'sap-c'],
    directive:
      'The character is studying and reading a coloring book whose cover shows white clouds; pencils and study notes are visible on a small desk.',
  },
  {
    label: 'database',
    patterns: ['aurora', 'mysql', 'postgres', 'database', 'rds'],
    directive:
      'The character is holding or pointing at a clay-style database cylinder icon; small data records float around it.',
  },
  {
    label: 'ai-llm',
    patterns: [
      'bedrock',
      'sagemaker',
      'foundry',
      'llm',
      'generative ai',
      'gpt',
      'claude',
      'gemini',
    ],
    directive:
      'A glowing neural-network / brain icon floats next to the character; the laptop screen shows a chat bubble.',
  },
  {
    label: 'kubernetes',
    patterns: ['kubernetes', 'k8s', 'aks', 'eks', 'gke'],
    directive:
      'A clay-style Kubernetes wheel icon floats beside the character. Small container blocks orbit the wheel.',
  },
  {
    label: 'serverless',
    patterns: ['lambda', 'azure functions', 'cloud run'],
    directive:
      'A small lightning-bolt icon glows on the laptop lid representing serverless / event-driven compute.',
  },
  {
    label: 'security',
    patterns: ['iam', 'rbac', 'key vault', 'secrets manager', 'defender', 'sentinel', 'guardduty'],
    directive: 'A small shield / lock icon hovers beside the character to represent security.',
  },
  {
    label: 'storage',
    patterns: ['s3', 'blob', 'storage account', 'data lake', 'bucket'],
    directive:
      "Stacked storage drive icons sit at the character's feet to represent object storage.",
  },
];

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePatterns(patterns) {
  return (patterns || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, 'i'));
}

async function loadKeywordMatrix(db) {
  let synonyms = SEED_SYNONYMS;
  let augmentations = SEED_AUGMENTATIONS;

  try {
    if (db && typeof db.collection === 'function') {
      const [synSnap, augSnap] = await Promise.all([
        db
          .collection('prompt_keyword_synonyms')
          .get()
          .catch(() => null),
        db
          .collection('prompt_keyword_augmentations')
          .get()
          .catch(() => null),
      ]);
      if (synSnap && !synSnap.empty) {
        synonyms = synSnap.docs.map((d) => {
          const data = d.data() || {};
          return {
            canonical: String(data.canonical || d.id || '').trim(),
            patterns: Array.isArray(data.patterns) ? data.patterns : [],
          };
        });
      }
      if (augSnap && !augSnap.empty) {
        augmentations = augSnap.docs.map((d) => {
          const data = d.data() || {};
          return {
            label: String(data.label || d.id || '').trim(),
            patterns: Array.isArray(data.patterns) ? data.patterns : [],
            directive: String(data.directive || '').trim(),
          };
        });
      }
    }
  } catch {
    // fall through with seeds
  }

  return {
    synonyms: synonyms.map((s) => ({
      canonical: s.canonical,
      patterns: compilePatterns(s.patterns),
    })),
    augmentations: augmentations
      .filter((a) => a.directive)
      .map((a) => ({
        label: a.label,
        patterns: compilePatterns(a.patterns),
        directive: a.directive,
      })),
  };
}

function applyMatrix(matrix, { rawTags = [], haystack = '' } = {}) {
  const raw = Array.from(
    new Set(rawTags.map((v) => String(v || '').trim()).filter((v) => v.length > 0 && v.length < 60))
  );

  const probe = `${raw.join(' \n ')}\n${haystack || ''}`;

  const canonical = [];
  for (const group of matrix.synonyms) {
    if (group.patterns.some((re) => re.test(probe))) {
      canonical.push(group.canonical);
    }
  }
  const canonicalUnique = Array.from(new Set(canonical));

  const augSeen = new Set();
  const augmentations = [];
  for (const aug of matrix.augmentations) {
    if (augSeen.has(aug.label)) continue;
    if (aug.patterns.some((re) => re.test(probe))) {
      augSeen.add(aug.label);
      augmentations.push(aug.directive);
    }
  }

  const all = Array.from(new Set([...canonicalUnique, ...raw]));
  return { canonical: canonicalUnique, raw, all, augmentations };
}

module.exports = {
  SEED_SYNONYMS,
  SEED_AUGMENTATIONS,
  loadKeywordMatrix,
  applyMatrix,
};
