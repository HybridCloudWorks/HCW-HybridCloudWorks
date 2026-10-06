// Lint for the Functions app: a correctness gate, not a style check. Added
// 2026-10-06 after schedulers.js shipped a timer that called `createNotifier`
// without importing it, so checkAgentHealth threw a ReferenceError every five
// minutes for a day and paged the owner through alert-app-exceptions. Tests
// import the module and count its registrations; only running the handler
// would have found it — or `no-undef`, which is why this file exists.
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
