import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        Terminal: 'readonly',
        FitAddon: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
