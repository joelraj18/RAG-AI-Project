import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/*.config.js'], languageOptions: { globals: globals.node } },
  // the benchmark harness (bench/) runs in Node; bench/page runs in the browser under test
  {
    files: ['bench/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }] },
  },
];
