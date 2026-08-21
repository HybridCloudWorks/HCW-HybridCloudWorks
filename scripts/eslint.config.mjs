// Lint for the migration scripts — added 2026-08-21 after the first preflight
// dispatch failed with `ReferenceError: FIRESTORE_PROJECT_ID is not defined`.
// `node --check` and the vitest suite both passed: an undefined identifier is
// a runtime error, invisible to the parser and to tests that never reach the
// line. `no-undef` is the rule that catches it at CI time; the rest is kept
// deliberately small so this stays a correctness gate, not a style one.
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'reports/**', 'export/**'] },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
    },
  },
];
