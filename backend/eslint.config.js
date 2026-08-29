import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

import localRules from '../scripts/eslint-rules/no-sql-string-interpolation.js';

// Flat config, deliberately mirroring frontend/eslint.config.js so the repo has
// one shape rather than two. The differences from that file are only the ones
// the runtime forces: Node globals instead of browser, no JSX, no React plugins.

export default defineConfig([
  globalIgnores(['node_modules', 'uploads', 'coverage']),
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

      // "Parameterised queries only, never string-concatenated SQL" — the
      // strongest SQL rule in CLAUDE.md, held by review until 6.10. An
      // allowlist rather than a ban, because column lists and WHERE-clause
      // assembly are structure and cannot be `?` placeholders; see the rule
      // file for what it can and cannot prove.
      'local/no-sql-string-interpolation': 'error',
    },
  },

  // The one exception, and it is here in the config rather than as an inline
  // disable so that it is visible to anyone reading the lint setup and cannot
  // quietly spread to a second site.
  //
  // `migrate.js` reads a `.sql` file and executes it. That is not a query
  // built from a value — it is the entire job of a migration runner, and the
  // text comes from a file committed to this repository. There is no shape
  // that would make it provable, and rewriting the runner to satisfy a linter
  // would be the tail wagging the dog.
  {
    files: ['database/migrate.js'],
    rules: {
      'local/no-sql-string-interpolation': 'off',
    },
  },

  // Rule 4 — "never SELECT * in a tool query" — is scoped to the tools rather
  // than applied package-wide. `SELECT *` is used nineteen times in
  // auth/admin/doctors, legitimately: those flows need the password hash the
  // tools must never see. Widening this rule would mean nineteen disable
  // comments on day one, which is how a rule stops being read.
  {
    files: ['src/assistant/**/*.js'],
    rules: {
      'local/no-select-star': 'error',
    },
  },
]);
