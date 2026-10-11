import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
  {
    files: ['apps/client/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/server/**/*.ts', '**/*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // CLI scripts, the structured logger and the process entrypoint (fatal startup errors,
    // before a logger exists) are allowed to write to the console.
    files: ['apps/server/scripts/**', 'apps/server/src/logger.ts', 'apps/server/src/index.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
