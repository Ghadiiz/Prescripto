import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Flat config, deliberately mirroring frontend/eslint.config.js so the repo has
// one shape rather than two. The differences from that file are only the ones
// the runtime forces: Node globals instead of browser, no JSX, no React plugins.

export default defineConfig([
  globalIgnores(['node_modules', 'uploads', 'coverage']),
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // varsIgnorePattern matches the frontends. The caught-error and argument
      // patterns are escape hatches for the genuinely-unused-on-purpose case
      // (`catch (_error)`), not a licence to leave bindings lying around —
      // ESLint 9 made caughtErrors default to "all", which is the right
      // default and is kept.
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // CLAUDE.md says "ESM imports only, no require()". This moves that from
      // a rule someone has to remember in review to one the linter enforces.
      // It starts green because the codebase is already fully ESM, so it can
      // only ever fire on a regression.
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
