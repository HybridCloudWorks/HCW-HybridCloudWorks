import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

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
      'functions/node_modules/**',
      '.firebase/**',
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
        version: 'detect',
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
      // Disabled: crashes with ESLint v9 due to minimatch API incompatibility in jsx-a11y v6
      'jsx-a11y/label-has-associated-control': 'off',

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
  // Firebase Cloud Functions: CommonJS runtime, allows require(), and the
  // standalone setup/test scripts under functions/scripts and
  // functions/test-* legitimately use console for CLI output.
  {
    files: ['functions/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['functions/scripts/**/*.js', 'functions/test-*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
