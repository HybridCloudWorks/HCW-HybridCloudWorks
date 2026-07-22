const { GoogleAuth } = require('google-auth-library');

async function getVertexReadiness() {
  const location = String(process.env.CONTENTFORGE_VERTEX_LOCATION || 'us-central1').trim();
  const configuredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  ).trim();

  const readiness = {
    location,
    configuredProject: configuredProject || null,
    resolvedProject: null,
    authReady: false,
    accessTokenReady: false,
    missing: [],
    ready: false,
  };

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  try {
    readiness.resolvedProject = configuredProject || (await auth.getProjectId()) || null;
  } catch (error) {
    readiness.projectError = error?.message || String(error);
  }

  try {
    const client = await auth.getClient();
    readiness.authReady = Boolean(client);

    const tokenResponse = await client.getAccessToken();
    const accessToken =
      typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || null;
    readiness.accessTokenReady = Boolean(accessToken);
  } catch (error) {
    readiness.authError = error?.message || String(error);
  }

  if (!readiness.resolvedProject) {
    readiness.missing.push('GCLOUD_PROJECT/GCP_PROJECT or resolvable ADC project');
  }
  if (!readiness.accessTokenReady) {
    readiness.missing.push('Vertex ADC credentials');
  }

  readiness.ready = readiness.missing.length === 0;
  return readiness;
}

module.exports = {
  getVertexReadiness,
};
