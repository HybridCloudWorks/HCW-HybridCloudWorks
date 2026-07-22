const axios = require('axios');
const { defaultModelFor, getActiveAiProvider } = require('./lib/ai-model-router');
const { getVertexReadiness } = require('./lib/vertex-readiness');

function parseArgs(argv) {
  const args = {
    remote: false,
    endpoint: process.env.CONTENTFORGE_AI_READINESS_URL || '',
    token: process.env.CONTENTFORGE_ADMIN_BEARER || '',
    project:
      process.env.CONTENTFORGE_FIREBASE_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      '',
    region: process.env.CONTENTFORGE_FUNCTIONS_REGION || 'us-central1',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--remote') {
      args.remote = true;
      continue;
    }

    if (current === '--endpoint' && argv[index + 1]) {
      args.endpoint = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--token' && argv[index + 1]) {
      args.token = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--project' && argv[index + 1]) {
      args.project = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--region' && argv[index + 1]) {
      args.region = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function buildRemoteEndpoint(project, region) {
  if (!project) return '';
  return `https://${region}-${project}.cloudfunctions.net/aiStackReadiness`;
}

function getControlSummary() {
  return {
    metadataOnly: process.env.CONTENTFORGE_METADATA_ONLY === 'true',
    tokenUsageLogging: process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true',
    altTextEnabled: process.env.CONTENTFORGE_ALT_TEXT_ENABLED === 'true',
    imageModel: process.env.CONTENTFORGE_IMAGE_MODEL || 'google/imagen-4-fast',
    imageModelHero:
      process.env.CONTENTFORGE_IMAGE_MODEL_HERO ||
      process.env.CONTENTFORGE_IMAGE_MODEL ||
      'google/imagen-4-fast',
  };
}

function getLocalSecretStatus(envName) {
  const configured = Boolean(String(process.env[envName] || '').trim());

  return {
    configured,
    verification: configured ? 'local-env' : 'not-verifiable-in-local-mode',
  };
}

async function localSnapshot() {
  const provider = getActiveAiProvider();
  const openAiReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const anthropicReady = Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
  const replicate = getLocalSecretStatus('REPLICATE_API_KEY');
  const headlessEnabled =
    String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
  const headlessUrl = String(process.env.CONTENTFORGE_HEADLESS_FALLBACK_URL || '').trim();
  const vertex = await getVertexReadiness();

  const missing = [];
  const warnings = [];
  if (provider === 'openai' && !openAiReady) missing.push('OPENAI_API_KEY');
  if (provider === 'anthropic' && !anthropicReady) missing.push('ANTHROPIC_API_KEY');
  if (headlessEnabled && !headlessUrl) missing.push('CONTENTFORGE_HEADLESS_FALLBACK_URL');
  if (provider === 'vertex' && !vertex.ready) missing.push(...vertex.missing);

  if (!replicate.configured) {
    warnings.push(
      'REPLICATE_API_KEY is not set in the local environment. Deployed Firebase Functions may still have this secret via Secret Manager; use --endpoint and --token to verify deployed runtime readiness.'
    );
  }

  return {
    mode: 'local-env',
    provider,
    models: {
      draft: process.env.CONTENTFORGE_DRAFT_MODEL || defaultModelFor(provider, 'draft'),
      analysis: process.env.CONTENTFORGE_ANALYSIS_MODEL || defaultModelFor(provider, 'analysis'),
      multimodal:
        process.env.CONTENTFORGE_MULTIMODAL_MODEL || defaultModelFor(provider, 'multimodal'),
    },
    controls: getControlSummary(),
    readiness: {
      vertex,
      openAiReady,
      anthropicReady,
      replicateReady: replicate.configured ? true : null,
      replicate,
      headlessEnabled,
      headlessUrlConfigured: Boolean(headlessUrl),
      warnings,
      missing,
      ready: missing.length === 0,
    },
  };
}

async function remoteSnapshot(endpoint, token) {
  const response = await axios.get(endpoint, {
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return {
    mode: 'remote-endpoint',
    ...response.data,
  };
}

async function run() {
  const args = parseArgs(process.argv);

  if (args.remote && !args.endpoint) {
    args.endpoint = buildRemoteEndpoint(args.project, args.region);
  }

  if (args.endpoint && args.token) {
    const snapshot = await remoteSnapshot(args.endpoint, args.token);
    console.warn(JSON.stringify(snapshot, null, 2));
    if (snapshot?.readiness?.ready === false) {
      process.exit(2);
    }
    return;
  }

  if (args.remote) {
    const missingFlags = [];
    if (!args.endpoint) missingFlags.push('project/region or endpoint');
    if (!args.token) missingFlags.push('token');

    throw new Error(
      `Remote readiness requires ${missingFlags.join(' and ')}. ` +
        'Set CONTENTFORGE_ADMIN_BEARER or pass --token, and pass --project/--region or --endpoint.'
    );
  }

  const snapshot = await localSnapshot();
  console.warn(JSON.stringify(snapshot, null, 2));
  if (snapshot.readiness.ready === false) {
    process.exit(2);
  }
}

run().catch((error) => {
  console.error(error?.response?.data || error.message || error);
  process.exit(1);
});
