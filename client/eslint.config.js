// Correctness-only lint: catches undefined variables and missing/unused imports,
// which is exactly what large refactors and codemods break silently (the build
// succeeds and the failure only shows when that code path renders). Style rules
// are deliberately not enabled — this codebase has its own dense style.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    // ESLint 10 tracks JSX references itself: no-undef catches an unimported
    // component and no-unused-vars counts JSX usage, so eslint-plugin-react
    // (whose jsx-no-undef / jsx-uses-vars rules did this) is no longer needed.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
