import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

import localRules from '../scripts/eslint-rules/no-sql-string-interpolation.js';

// The same config as backend/eslint.config.js — mcp/ is its own npm root, so it
// needs its own, but the rules are deliberately identical.
//
// Linted from 6.7 onwards because leaving it out would have been arbitrary:
// these ten files carry the rule-6 separation between the patient and doctor
// registries, and the token verification each server's auth depends on.

export default defineConfig([
  globalIgnores(['node_modules']),
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended],
    plugins: { local: localRules },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'ESM imports only (CLAUDE.md). Use import, not require().',
        },
      ],

      // There is no SQL in this package and there should never be — the
      // servers reach the database through the backend's service layer. The
      // rule is registered anyway so that if SQL ever appears here it is held
      // to the same standard on arrival, rather than being the one place the
      // check does not run.
      'local/no-sql-string-interpolation': 'error',
    },
  },
]);
