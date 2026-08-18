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
      // Needs the Firestore emulator, which T-317 retired along with the
      // `test:rules` script that used to start it. In the default run it
      // fails at initializeTestEnvironment, so it is excluded rather than
      // left red; run it explicitly with an emulator if the rules file ever
      // changes again (TODO.md T-320).
      'functions/firestore.rules.test.js',
    ],
  },
});
