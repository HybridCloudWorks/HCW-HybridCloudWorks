import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function pickMarkdownChunk(id) {
  if (
    id.includes('react-markdown') ||
    id.includes('react-syntax-highlighter') ||
    id.includes('remark-') ||
    id.includes('rehype-') ||
    id.includes('refractor') ||
    id.includes('hast-') ||
    id.includes('mdast-') ||
    id.includes('micromark') ||
    id.includes('unified') ||
    id.includes('unist-') ||
    id.includes('vfile') ||
    id.includes('property-information') ||
    id.includes('comma-separated-tokens') ||
    id.includes('space-separated-tokens') ||
    id.includes('character-entities') ||
    id.includes('decode-named-character-reference')
  ) {
    return 'vendor-markdown';
  }
  return null;
}

function pickChartsChunk(id) {
  if (
    id.includes('chart.js') ||
    id.includes('react-chartjs-2') ||
    id.includes('recharts') ||
    id.includes('d3')
  ) {
    return 'vendor-charts';
  }
  return null;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables.
  // 1. System environment variables (process.env)
  // 2. Variables from the current secrets path
  // 3. Variables from legacy infrastructure path
  // 4. Standard Vite .env files in workspace root
  const secretsEnvDir = path.resolve(import.meta.dirname, 'secrets/env');
  const infrastructureEnvDir = path.resolve(import.meta.dirname, 'infrastructure/secrets/env');
  const env = {
    ...process.env,
    ...loadEnv(mode, secretsEnvDir, ''), // Current custom path (all vars)
    ...loadEnv(mode, infrastructureEnvDir, ''), // Legacy custom path (all vars)
    ...loadEnv(mode, process.cwd(), ''), // Load from root (standard Vite behavior)
  };

  // Browser configuration that must survive the custom secrets directories
  // above. Vite only reads .env files from its own envDir, so anything sourced
  // from secrets/env has to be injected explicitly here.
  //
  // The Firebase variables that used to occupy this list are gone: no file
  // under src/ reads them any more. VITE_GCP_FUNCTIONS_URL is gone with them —
  // the API base is VITE_AZURE_FUNCTIONS_URL, resolved in lib/functionsBase.js.
  const browserEnvVars = [
    'VITE_AZURE_FUNCTIONS_URL',
    'VITE_ENTRA_CLIENT_ID',
    'VITE_ENTRA_TENANT_ID',
    'VITE_ENTRA_API_SCOPE',
    'VITE_SOCIAL_X_URL',
    'VITE_SOCIAL_LINKEDIN_URL',
    'VITE_SOCIAL_GITHUB_URL',
    'VITE_DEFAULT_LANGUAGE',
    'VITE_TRANSLATIONS',
    'VITE_NEWS_ENABLE_INSIGHTS',
  ];

  // Create define object with fallbacks for non-prefixed versions just in case
  const defineConf = {};
  browserEnvVars.forEach((key) => {
    // Try VITE_ prefixed first, then try same name without VITE_ prefix as fallback
    const fallbackKey = key.replace('VITE_', '');
    const value = env[key] || env[fallbackKey] || '';

    defineConf[`import.meta.env.${key}`] = JSON.stringify(value);
  });

  // A deploy build without an API base produces a bundle whose every backend
  // call throws at runtime. REQUIRE_API_BASE is set by the deploy workflow so
  // that misconfiguration fails the build instead of the site; plain CI builds
  // leave it unset and stay green without backend secrets.
  if (process.env.REQUIRE_API_BASE === 'true' && !env.VITE_AZURE_FUNCTIONS_URL) {
    throw new Error(
      'VITE_AZURE_FUNCTIONS_URL is required for a deploy build. Set it to "/api" ' +
        'for a same-origin deployment, or to the Function App origin followed by ' +
        '"/api" for a cross-origin one.'
    );
  }

  // Log injected keys (NOT values) to help debug CI issues
  console.log('--- CI/CD Build Config ---');
  console.log('Mode:', mode);
  console.log(
    'Injected VITE keys:',
    Object.keys(defineConf)
      .map((k) => k.split('.').pop())
      .filter((k) => defineConf[`import.meta.env.${k}`] !== '""')
      .join(', ') || 'None!'
  );
  console.log('--------------------------');

  return {
    plugins: [react()],
    logLevel: mode === 'production' ? 'warn' : 'info',
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    define: defineConf,
    // Build optimization
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const markdownChunk = pickMarkdownChunk(id);
            if (markdownChunk) return markdownChunk;
            const chartsChunk = pickChartsChunk(id);
            if (chartsChunk) return chartsChunk;
            if (id.includes('node_modules')) {
              if (id.includes('@radix-ui')) {
                return 'vendor-radix';
              }
              // framer-motion v13 ships its engine as the separate motion-dom /
              // motion-utils packages. Matching only 'framer-motion' let ~337 kB
              // of engine fall through to the catch-all vendor chunk, which is
              // what pushed that chunk past the 500 kB warning threshold.
              if (
                id.includes('framer-motion') ||
                id.includes('node_modules/motion-dom/') ||
                id.includes('node_modules/motion-utils/')
              ) {
                return 'vendor-framer';
              }
              // MSAL is only reached on the admin/auth path, so it has no
              // business in the chunk every public route downloads.
              if (id.includes('node_modules/@azure/msal-')) {
                return 'vendor-msal';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-lucide';
              }
              // Date / sanitization / interaction libs that aren't on every route.
              if (
                id.includes('date-fns') ||
                id.includes('dompurify') ||
                id.includes('react-zoom-pan-pinch')
              ) {
                return 'vendor-utils';
              }
              if (id.includes('react-router')) {
                return 'vendor-router';
              }
              if (id.includes('react-hook-form')) {
                return 'vendor-forms';
              }
              // The React runtime: needed on every route, but it changes far
              // less often than application code, so it earns its own
              // long-lived cache entry. Anchored on the '/' package boundary so
              // it does not swallow other react-* packages.
              if (
                id.includes('node_modules/react/') ||
                id.includes('node_modules/react-dom/') ||
                id.includes('node_modules/scheduler/')
              ) {
                return 'vendor-react';
              }
              return 'vendor'; // all other node_modules
            }
          },
        },
      },
      // 'hidden' generates source maps without `//# sourceMappingURL=` refs
      // in the bundle output. Lighthouse's `valid-source-maps` audit passes
      // (maps exist), but the public bundle does NOT advertise them, so
      // browser DevTools won't auto-load the source. The maps are still
      // available to upload to error-tracking services (Sentry etc.) at
      // deploy time. See GH #171.
      sourcemap: mode === 'development' ? true : 'hidden',
      minify: 'esbuild',
    },
  };
});
