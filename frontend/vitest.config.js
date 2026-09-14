/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/e2e/**',
      '**/tests-e2e/**',
      '**/ToDelete/**',
    ],
    // Only collected when asked for (`npm run test:coverage`, or
    // `vitest run --coverage`), so `npm test` in the required CI job is
    // unchanged. coverage.yml uploads coverage/lcov.info to Qlty (#568).
    // `projectRoot` is the repository root, so lcov.info names files as
    // `frontend/src/...` and one Qlty upload can carry frontend and functions
    // together without per-package prefix fixing.
    // `test:coverage` passes --testTimeout=30000 --hookTimeout=60000: under V8
    // coverage on a loaded machine, CertDetailPage.test.jsx's walk over every
    // landing-page slug passed the 5 s default locally (2026-09-14). The flags
    // are on the coverage script only, so `npm test` keeps the defaults.
    coverage: {
      provider: 'v8',
      reporter: [
        'text-summary',
        ['lcovonly', { file: 'lcov.info', projectRoot: path.resolve(import.meta.dirname, '..') }],
      ],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        'src/**/*.test.{js,jsx,ts,tsx}',
        'src/**/*.spec.{js,jsx,ts,tsx}',
        'src/**/__tests__/**',
        'src/setupTests.js',
        'src/**/*.d.ts',
      ],
    },
  },
});
