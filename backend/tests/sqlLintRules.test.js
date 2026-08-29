import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';

import { rules } from '../../scripts/eslint-rules/no-sql-string-interpolation.js';

// Tests for 6.10's two local lint rules.
//
// A lint rule is code, and an untested one is worse than no rule: it reports
// nothing, everyone assumes the guarantee holds, and the review that used to
// catch the problem has been retired. So the valid cases below matter as much
// as the invalid ones — a rule that fires on correct code gets disabled, which
// is the failure mode CLAUDE.md's own note about this increment warns about.
//
// RuleTester runs each case through ESLint itself, so these assert the rule as
// ESLint will actually apply it, not as a hand-rolled AST walk.

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

describe('local/no-sql-string-interpolation', () => {
  ruleTester.run(
    'no-sql-string-interpolation',
    rules['no-sql-string-interpolation'],
    {
      valid: [
        // A fully static query, which is the overwhelming majority.
        {
          code: `const [rows] = await db.query('SELECT id FROM users WHERE id = ?', [id]);`,
        },

        // How long queries are wrapped in this codebase. Every operand is a
        // string literal, so nothing dynamic can enter.
        {
          code: `
            const [rows] = await db.query(
              'SELECT id, name ' +
                'FROM users WHERE id = ?',
              [id],
            );
          `,
        },

        // S1 — a module-level const holding a fixed column list. This is the
        // shape a `?` placeholder cannot express.
        {
          code: `
            const DOCTOR_COLUMNS = \`d.id, d.name, d.fees\`;
            const load = async (db) =>
              db.query(\`SELECT \${DOCTOR_COLUMNS} FROM doctors\`);
          `,
        },

        // S2 — a module-level numeric const.
        {
          code: `
            const RESULT_LIMIT = 20;
            const load = async (db) =>
              db.query(\`SELECT id FROM doctors LIMIT \${RESULT_LIMIT}\`);
          `,
        },

        // S3 — a WHERE clause assembled from string literals.
        {
          code: `
            const search = async (db, filters) => {
              const conditions = ['available = TRUE'];
              const params = [];
              if (filters.area) {
                conditions.push('area = ?');
                params.push(filters.area);
              }
              return db.query(
                \`SELECT id FROM doctors WHERE \${conditions.join(' AND ')}\`,
                params,
              );
            };
          `,
        },

        // S4 — fragments chosen from a module-level map of literals. The key
        // can be anything; the SQL text cannot.
        {
          code: `
            const UPDATABLE_COLUMNS = { name: 'name = ?', fees: 'fees = ?' };
            const update = async (db, id, fields) => {
              const setClauses = [];
              const values = [];
              for (const column of Object.keys(UPDATABLE_COLUMNS)) {
                if (fields[column] !== undefined) {
                  setClauses.push(UPDATABLE_COLUMNS[column]);
                  values.push(fields[column]);
                }
              }
              return db.query(
                \`UPDATE doctors SET \${setClauses.join(', ')} WHERE id = ?\`,
                [...values, id],
              );
            };
          `,
        },

        // The shape ten call sites in this codebase use: build the statement
        // into a variable, append literal clauses, parameterise the values.
        // A rule that only looked at inline literals would say nothing here.
        {
          code: `
            const load = async (db, status) => {
              let query = 'SELECT id FROM appointments WHERE doctor_id = ?';
              const params = [1];
              if (status) {
                query += ' AND status = ?';
                params.push(status);
              }
              query += ' ORDER BY id DESC';
              return db.query(query, params);
            };
          `,
        },

        // Not a query call. The rule must not police every template literal in
        // the codebase — most interpolation is log messages and URLs.
        {
          code: 'console.log(`fetched ${count} rows FROM the cache`);',
        },
      ],

      invalid: [
        // The plain case: a value pasted into the statement.
        {
          code: `
            const load = async (db, sort) =>
              db.query(\`SELECT id FROM doctors ORDER BY \${sort}\`);
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // Straight from a request. Reported for the same reason, which is the
        // point — the rule does not need to recognise "user input", only the
        // absence of proof.
        {
          code: `
            const load = async (db, req) =>
              db.query(\`SELECT id FROM doctors WHERE area = '\${req.body.area}'\`);
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // Concatenation, once a non-literal joins the chain.
        {
          code: `
            const load = async (db, table) =>
              db.query('SELECT id FROM ' + table + ' WHERE id = ?', [1]);
          `,
          errors: [{ messageId: 'concatenation' }],
        },

        // One bad push spoils the array — the join is only as safe as
        // everything that reached it.
        {
          code: `
            const search = async (db, filters) => {
              const conditions = ['available = TRUE'];
              conditions.push('area = ' + filters.area);
              return db.query(
                \`SELECT id FROM doctors WHERE \${conditions.join(' AND ')}\`,
              );
            };
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // The shape 6.10 removed from doctorAuthService: a fragment built from
        // a variable, safe only because of a runtime allowlist check the
        // linter cannot see.
        {
          code: `
            const update = async (db, id, updates) => {
              const allowed = ['name', 'fees'];
              const setClauses = [];
              for (const [key, value] of Object.entries(updates)) {
                if (allowed.includes(key)) {
                  setClauses.push(\`\${key} = ?\`);
                }
              }
              return db.query(
                \`UPDATE doctors SET \${setClauses.join(', ')} WHERE id = ?\`,
              );
            };
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // A map is only a proof if every value in it is fixed.
        {
          code: `
            const CLAUSES = { name: 'name = ?', fees: buildFeesClause() };
            const update = async (db, fields, column) =>
              db.query(\`UPDATE doctors SET \${CLAUSES[column]} WHERE id = ?\`);
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // A constant that is itself interpolated launders the dynamic value
        // through a second name. The "no expressions of its own" check on S1
        // is what stops it.
        {
          code: `
            const ORDER = \`ORDER BY \${process.env.SORT_COLUMN}\`;
            const load = async (db) =>
              db.query(\`SELECT id FROM doctors \${ORDER}\`);
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // Module-level but reassignable, so its value at the query is not the
        // value at the declaration.
        {
          code: `
            let limit = 20;
            limit = Number(process.env.LIMIT);
            const load = async (db) =>
              db.query(\`SELECT id FROM doctors LIMIT \${limit}\`);
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // A local array is not a licence: this one is built by a caller.
        {
          code: `
            const update = async (db, id, setClauses) =>
              db.query(
                \`UPDATE users SET \${setClauses.join(', ')} WHERE id = ?\`,
                [id],
              );
          `,
          errors: [{ messageId: 'dynamic' }],
        },

        // The same build-into-a-variable shape as the valid case above, but
        // with one appended clause carrying a value. Following the assignments
        // is the only way to see this.
        {
          code: `
            const load = async (db, sort) => {
              let query = 'SELECT id FROM appointments';
              query += ' ORDER BY ' + sort;
              return db.query(query);
            };
          `,
          errors: [{ messageId: 'concatenation' }],
        },

        // The statement arrives from outside the function entirely.
        {
          code: `
            const run = async (db, sql, params) => db.query(sql, params);
          `,
          errors: [{ messageId: 'indirect' }],
        },
      ],
    },
  );
});

describe('local/no-select-star', () => {
  ruleTester.run('no-select-star', rules['no-select-star'], {
    valid: [
      {
        code: `db.query('SELECT id, name FROM doctors WHERE id = ?', [id]);`,
      },
      // The rule reads query arguments, not every string in the file.
      {
        code: `const note = 'never SELECT * in a tool query';`,
      },
      // A star that is not a column list.
      {
        code: `db.query('SELECT COUNT(*) AS count FROM doctors');`,
      },
    ],

    invalid: [
      {
        code: `db.query('SELECT * FROM users WHERE email = ?', [email]);`,
        errors: [{ messageId: 'selectStar' }],
      },
      // Case and whitespace must not be a way around it.
      {
        code: `db.query('select   *  from doctors');`,
        errors: [{ messageId: 'selectStar' }],
      },
      // And it has to see through a template literal.
      {
        code: `
          const LIMIT = 5;
          db.query(\`SELECT * FROM doctors LIMIT \${LIMIT}\`);
        `,
        errors: [{ messageId: 'selectStar' }],
      },
      // Assigning the statement to a variable first is not a way around it —
      // which matters because that is how several queries here are written.
      {
        code: `
          const load = async (db) => {
            const query = 'SELECT * FROM doctors';
            return db.query(query);
          };
        `,
        errors: [{ messageId: 'selectStar' }],
      },
      // A qualified star is still a star.
      {
        code: `db.query('SELECT a.*, u.name FROM appointments a JOIN users u');`,
        errors: [{ messageId: 'selectStar' }],
      },
    ],
  });
});
