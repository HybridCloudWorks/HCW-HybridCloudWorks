// Lint for the repository's operational scripts. This stays a correctness
// gate, not a broad style check.
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
