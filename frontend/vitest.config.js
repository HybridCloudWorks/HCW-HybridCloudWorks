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
    // landing-page slug ran past the 5 s default locally (2026-09-14). That
    // walk now states its own 30 s budget on the test itself, because the same
    // overrun reached a plain `npm test` run too (#640) — so these flags are a
    // backstop for whatever else coverage slows down, not the only thing
    // holding that one test up. They stay on the coverage script, so `npm test`
    // keeps the 5 s default for every test that has not asked for more.
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
