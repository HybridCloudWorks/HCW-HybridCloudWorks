import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// F10 — Firebase SDK split. Returns the chunk name for a given module id, or
// null if the id isn't a Firebase package. Pulled out to keep manualChunks
// from tripping the complexity lint rule.
function pickFirebaseChunk(id) {
  if (!id.includes('firebase')) return null;
  if (id.includes('@firebase/storage') || id.includes('firebase/storage')) {
    return 'vendor-firebase-storage';
  }
  if (id.includes('@firebase/auth') || id.includes('firebase/auth')) {
    return 'vendor-firebase-auth';
  }
  if (id.includes('@firebase/functions') || id.includes('firebase/functions')) {
    return 'vendor-firebase-functions';
  }
  if (id.includes('node_modules')) return 'vendor-firebase';
  return null;
}

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
  const secretsEnvDir = path.resolve(__dirname, 'secrets/env');
  const infrastructureEnvDir = path.resolve(__dirname, 'infrastructure/secrets/env');
  const env = {
    ...process.env,
    ...loadEnv(mode, secretsEnvDir, ''), // Current custom path (all vars)
    ...loadEnv(mode, infrastructureEnvDir, ''), // Legacy custom path (all vars)
    ...loadEnv(mode, process.cwd(), ''), // Load from root (standard Vite behavior)
  };

  // List of required Firebase variables
  const firebaseVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MEASUREMENT_ID',
    'VITE_GCP_FUNCTIONS_URL',
  ];

  // Create define object with fallbacks for non-prefixed versions just in case
  const defineConf = {};
  firebaseVars.forEach((key) => {
    // Try VITE_ prefixed first, then try same name without VITE_ prefix as fallback
    const fallbackKey = key.replace('VITE_', '');
    const value = env[key] || env[fallbackKey] || '';

    defineConf[`import.meta.env.${key}`] = JSON.stringify(value);
  });

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
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: defineConf,
    // Build optimization
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // F10 — Split Firebase SDK so the public-page bundle stops paying
            // for Storage/Auth/Functions code that only admin routes use.
            // firebase/app + firestore stays in the core chunk (every page
            // reads from Firestore today via useFirestore).
            const firebaseChunk = pickFirebaseChunk(id);
            if (firebaseChunk) return firebaseChunk;
            const markdownChunk = pickMarkdownChunk(id);
            if (markdownChunk) return markdownChunk;
            const chartsChunk = pickChartsChunk(id);
            if (chartsChunk) return chartsChunk;
            if (id.includes('node_modules')) {
              if (id.includes('@radix-ui')) {
                return 'vendor-radix';
              }
              if (id.includes('framer-motion')) {
                return 'vendor-framer';
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
