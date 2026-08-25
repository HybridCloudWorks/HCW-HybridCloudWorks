import { createRequire } from 'node:module';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * The installed React version, read rather than hardcoded.
 *
 * `version: 'detect'` is what eslint-plugin-react documents, and it is also
 * what stops the plugin working on ESLint 10: detection calls
 * `context.getFilename()`, which v9 deprecated and v10 removed, so every rule
 * that consults the React version dies with
 * "contextOrFilename.getFilename is not a function". Supplying the version
 * skips detection altogether — the plugin only calls `detectReactVersion` when
 * the setting is the literal string 'detect'.
 *
 * Read from the installed package rather than pinned to a literal so an
 * upgrade cannot silently leave the linter reasoning about the wrong React.
 */
const require = createRequire(import.meta.url);
const reactVersion = require('react/package.json').version;

export default [
  {
    ignores: [
      'legacy/**',
      'old-code/**',
      'not-needed/**',
      'REVIEW/**',
      '.copilot/**',
      'build/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'documentation/archive/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: {
        version: reactVersion,
      },
    },
    rules: {
      // TypeScript rules
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // React rules
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-no-constructed-context-values': 'warn',
      'react/jsx-key': 'warn',
      'react/jsx-no-comment-textnodes': 'error',
      'react/no-children-prop': 'error',
      'react/display-name': 'warn',
      'react/no-unescaped-entities': 'warn',

      // React Hooks rules
      ...reactHooks.configs.recommended.rules,

      // Accessibility rules
      ...jsxA11y.configs.recommended.rules,
      // ON as of A-001. The note that used to sit here said this rule "runs
      // fine on ESLint 10". It did not, and the error was worth correcting
      // rather than deleting: the rule crashed with
      // `(0 , _minimatch.default) is not a function` on the first file
      // containing a label, and a rule crash aborts the entire ESLint run —
      // so "it reports 20 violations" had never actually been observed.
      //
      // The cause was this repository's own supply-chain override, not the
      // ESLint version. jsx-a11y declares `minimatch: ^3.1.2` and imports it
      // as a DEFAULT export; package.json overrode minimatch to ^10 tree-wide
      // to carry the brace-expansion advisory fix, and v10 exports no default.
      // The repair is a SCOPED override pinning jsx-a11y's own minimatch back
      // to ^3.1.2 (see the overrides block in package.json), which leaves
      // everything else on v10. 3.1.x is past the 3.0.5 ReDoS fix, and its
      // brace-expansion is pinned to ^1.1.12 for the same advisory.
      //
      // controlComponents is required rather than cosmetic. Without it the
      // rule cannot see the custom <Input>/<Textarea> wrappers as controls, so
      // a label that correctly WRAPS one is still reported. Three of the
      // twenty findings were exactly that — already-accessible markup — and
      // "fixing" them would have meant rewriting working code to satisfy a
      // misconfigured linter.
      'jsx-a11y/label-has-associated-control': [
        'error',
        { controlComponents: ['Input', 'Textarea'] },
      ],

      // General code quality rules
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error'],
        },
      ],
      'no-debugger': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': 'warn',
      'no-param-reassign': 'warn',
      'no-shadow': 'off', // Handled by TypeScript
      'no-throw-literal': 'error',
      'no-use-before-define': 'off', // Handled by TypeScript
      complexity: ['warn', 20], // Warn on high cyclomatic complexity (relaxed for existing code)
      'max-depth': 'off', // Too strict for existing codebase
      'max-lines': 'off', // Too strict for existing codebase
      'max-nested-callbacks': 'off', // Too strict for existing codebase
      'no-duplicate-imports': 'warn', // Warn instead of error
      'no-unneeded-ternary': 'warn',
      'no-nested-ternary': 'warn',
      'object-shorthand': 'warn',
      'prefer-destructuring': 'warn', // Warn instead of error

      // Theming guardrail: hardcoded hex/rgb in inline `style` attrs cannot
      // respond to light/dark mode toggles. Use Tailwind utilities with
      // `dark:` variants or CSS custom properties instead. See
      // documentation/Frontend-Theming-Guide.md.
      //
      // Allowed: template literals that interpolate runtime values without
      // any literal hex/rgb in the static parts (e.g. dynamic per-cert glow
      // colors from metadata). These are theme-agnostic by design — the
      // color is data, not a hardcoded palette choice.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|borderColor|fill|stroke)$/] Literal[value=/#[0-9a-fA-F]{3,8}|rgba?\\(/]",
          message:
            'Hardcoded color in inline style cannot respect light/dark mode. Use Tailwind classes with `dark:` variants or a CSS variable from src/index.css.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|borderColor|fill|stroke)$/] TemplateLiteral TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}|rgba?\\(/]",
          message:
            'Hardcoded hex/rgb inside a template literal in inline style cannot respect light/dark mode. Move the gradient to a CSS class with `dark:` variant or to a CSS variable.',
        },
      ],
    },
  },
  // Scripts - CLI tools that use require() and console for output
  {
    files: ['scripts/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
];
