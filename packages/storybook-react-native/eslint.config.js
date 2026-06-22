// ESLint flat config — applies to the SDK source + tests. Kept deliberately
// minimal: lean on `no-unused-vars`, `no-undef`, and prefer-const to catch
// the kind of drift unit tests miss (dead code, stale imports, redeclared
// bindings). Stylistic rules belong in prettier, not here.

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Node 22+ runtime — we don't need eslint-plugin-n's full ruleset,
        // just the globals so `no-undef` doesn't false-positive.
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-undef': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '.percy/**',
      'percy-debug.log',
    ],
  },
];
