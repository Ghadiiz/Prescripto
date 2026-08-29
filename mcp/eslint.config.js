import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

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
    },
  },
]);
