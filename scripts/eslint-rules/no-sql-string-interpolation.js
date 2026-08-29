// Two local ESLint rules that move CLAUDE.md's SQL rules off review and onto
// the linter, the same way 6.7 did for "ESM imports only, no require()".
//
//   no-sql-string-interpolation — "parameterised queries only, never
//     string-concatenated SQL"
//   no-select-star             — "never SELECT * in a tool query"
//
// Both live here rather than in either package because `backend/` and `mcp/`
// are separate npm roots with deliberately identical rule sets, and `scripts/`
// already holds the tooling they share (the lint ratchet).
//
// WHY THIS IS AN ALLOWLIST RATHER THAN A BAN. A rule that simply rejected
// template literals in `db.query` would fire on eleven sites, nine of which
// are correct: column lists and result limits held in module constants, and
// WHERE clauses assembled from arrays of string literals. Those are STRUCTURE,
// which cannot be a `?` placeholder. So the rule permits text it can prove is
// fixed in the source, and rejects everything else — notably anything derived
// from a function argument, which is where user input enters.
//
// The distinction is "can the linter prove this text is code-controlled", not
// "does this look safe". A runtime guard such as `allowedFields.includes(key)`
// is a real defence but not a provable one, so 6.10 restructured the two sites
// that relied on one.
//
// THE ARGUMENT IS FOLLOWED, NOT JUST INSPECTED. Ten call sites in this
// codebase build SQL into a variable and pass the variable —
// `let query = \`...\`; if (status) query += ' AND a.status = ?';`. A rule that
// only looked at inline template literals would report nothing there, which
// would make it a rule about a coding style rather than about SQL. So an
// identifier argument is resolved to every assignment that can reach it, and
// each one is held to the same standard.
//
// SCOPE NOTE for no-select-star: it is registered only for
// `backend/src/assistant/**`, which is where the tools live. One tool call
// reaches outside that tree — `checkAvailability` uses
// `appointments/services/appointmentService.js` — and that file is therefore
// NOT covered here. It has no `SELECT *` today; this is written down so the
// boundary is a known gap rather than a silent assumption.

const QUERY_METHODS = new Set(['query', 'execute']);

// ---------------------------------------------------------------- helpers

const isQueryCall = (node) =>
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.type === 'Identifier' &&
  QUERY_METHODS.has(node.callee.property.name);

// A template literal counts as a literal only when it has no holes of its own.
// Without that check a constant becomes a laundering step: interpolate the
// dynamic value once, then interpolate the "constant" into the query.
const isStringLiteral = (node) =>
  node &&
  ((node.type === 'Literal' && typeof node.value === 'string') ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0));

const isNumberLiteral = (node) =>
  node && node.type === 'Literal' && typeof node.value === 'number';

// The variable a name resolves to, or null when it is a parameter, an import,
// a global, or otherwise not something we can read assignments from. Null is
// the safe answer: the caller then reports.
const resolveVariable = (scope, name) => {
  for (let current = scope; current; current = current.upper) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found) return found;
  }
  return null;
};

// The single `const`/`let` declaration that defines this variable, or null when
// it is not a plain declaration with an initialiser.
const soleDeclaration = (variable) => {
  if (!variable || variable.defs.length !== 1) return null;

  const def = variable.defs[0];
  if (def.type !== 'Variable' || !def.node.init) return null;

  return def;
};

// -------------------------------------------------------- provable text

// Written as a factory so the mutually recursive checks share one source code
// object and one cycle guard.
const createProvableChecks = (sourceCode) => {
  const scopeOf = (node) => sourceCode.getScope(node);

  // S4 — a lookup into an object whose values are ALL string literals.
  // `SET_CLAUSES[key]` is code-controlled text no matter what `key` holds,
  // because every value in the map is fixed in the source.
  const isLiteralMapLookup = (node) => {
    if (node.type !== 'MemberExpression') return false;
    if (node.object.type !== 'Identifier') return false;

    const variable = resolveVariable(scopeOf(node), node.object.name);
    const def = soleDeclaration(variable);
    if (!def || def.node.init.type !== 'ObjectExpression') return false;

    return def.node.init.properties.every(
      (property) =>
        property.type === 'Property' && isStringLiteral(property.value),
    );
  };

  // Every write to a variable: its initialiser plus every assignment,
  // including `+=` and ones inside nested functions.
  const writesTo = (variable) => {
    const writes = [];

    const def = soleDeclaration(variable);
    if (def) writes.push(def.node.init);

    for (const reference of variable.references) {
      if (reference.writeExpr && !writes.includes(reference.writeExpr)) {
        writes.push(reference.writeExpr);
      }
    }

    return writes;
  };

  const seen = new Set();

  // Is this expression's text fixed in the source?
  const isProvable = (node) => {
    if (!node) return false;
    if (isStringLiteral(node) || isNumberLiteral(node)) return true;

    if (node.type === 'TemplateLiteral') {
      return node.expressions.every((expression) => isProvable(expression));
    }

    if (node.type === 'BinaryExpression' && node.operator === '+') {
      return isProvable(node.left) && isProvable(node.right);
    }

    if (node.type === 'MemberExpression') return isLiteralMapLookup(node);

    if (node.type === 'CallExpression') return isLiteralArrayJoin(node);

    if (node.type === 'Identifier') {
      const variable = resolveVariable(scopeOf(node), node.name);
      if (!variable) return false;

      // A variable declared but never assigned anything we can see — a
      // parameter, a destructured field, an import — is not provable.
      const writes = writesTo(variable);
      if (writes.length === 0) return false;

      if (seen.has(variable)) return true; // cycle: judged by its other writes
      seen.add(variable);
      try {
        return writes.every((write) => isProvable(write));
      } finally {
        seen.delete(variable);
      }
    }

    return false;
  };

  // Every value that can reach an array: its initialiser elements, and the
  // argument of every `arr.push(...)`. A push whose argument we cannot judge,
  // or any other mutating method, makes the whole array unprovable.
  const arrayHoldsOnlyProvableText = (variable) => {
    const def = soleDeclaration(variable);
    if (!def || def.node.init.type !== 'ArrayExpression') return false;

    if (!def.node.init.elements.every((element) => isProvable(element))) {
      return false;
    }

    for (const reference of variable.references) {
      const identifier = reference.identifier;
      const parent = sourceCode.getNodeByRangeIndex(identifier.range[0]).parent;

      if (!parent || parent.type !== 'MemberExpression') continue;
      if (parent.object !== identifier) continue;

      const call = parent.parent;
      if (!call || call.type !== 'CallExpression' || call.callee !== parent) {
        continue;
      }

      const method = parent.computed ? null : parent.property.name;

      // Reads are fine; `join` is the consumption being validated. Anything
      // else could put unprovable text in, so refuse.
      if (method === 'join' || method === 'length') continue;
      if (method !== 'push') return false;

      if (call.arguments.length !== 1) return false;
      if (!isProvable(call.arguments[0])) return false;
    }

    return true;
  };

  // S3 — `arr.join('<literal>')` where every value in `arr` is provable.
  function isLiteralArrayJoin(node) {
    if (node.type !== 'CallExpression') return false;
    if (node.callee.type !== 'MemberExpression' || node.callee.computed) {
      return false;
    }
    if (node.callee.property.name !== 'join') return false;
    if (node.callee.object.type !== 'Identifier') return false;
    if (node.arguments.length !== 1 || !isStringLiteral(node.arguments[0])) {
      return false;
    }

    const variable = resolveVariable(scopeOf(node), node.callee.object.name);
    if (!variable) return false;

    return arrayHoldsOnlyProvableText(variable);
  }

  return { isProvable, writesTo };
};

// ------------------------------------------------- no-sql-string-interpolation

const noSqlStringInterpolation = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only provably code-controlled text may reach a SQL statement; ' +
        'values belong in parameters.',
    },
    schema: [],
    messages: {
      dynamic:
        'Interpolating {{ what }} into SQL. CLAUDE.md: parameterised queries ' +
        'only. Pass the value as a ? placeholder, or — if this is structure ' +
        'rather than a value — hold it in a module-level constant, an array ' +
        'of string literals joined in place, or a map of literal fragments.',
      concatenation:
        'Concatenating {{ what }} into SQL. CLAUDE.md: parameterised queries ' +
        'only. Pass the value as a ? placeholder.',
      indirect:
        'The SQL passed here is built from {{ what }}, which is not provably ' +
        'fixed in the source. CLAUDE.md: parameterised queries only.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const { isProvable, writesTo } = createProvableChecks(sourceCode);

    const describe = (node) => {
      if (node.type === 'Identifier') return `\`${node.name}\``;
      if (node.type === 'MemberExpression' || node.type === 'CallExpression') {
        return `\`${sourceCode.getText(node)}\``;
      }
      return 'a dynamic expression';
    };

    // Walks a SQL expression reporting the exact offending leaf, rather than
    // pointing at the whole statement and leaving the reader to find it.
    // Concatenation of string literals is how long queries are wrapped across
    // lines here — safe, and reported only when a non-literal actually appears
    // in the chain, which is the difference between a rule people keep and one
    // they disable.
    const report = (node, messageId) => {
      if (!node) return;
      if (isProvable(node)) return;

      if (node.type === 'TemplateLiteral') {
        for (const expression of node.expressions) {
          report(expression, 'dynamic');
        }
        return;
      }

      if (node.type === 'BinaryExpression' && node.operator === '+') {
        report(node.left, 'concatenation');
        report(node.right, 'concatenation');
        return;
      }

      context.report({ node, messageId, data: { what: describe(node) } });
    };

    return {
      CallExpression(node) {
        if (!isQueryCall(node)) return;

        const argument = node.arguments[0];
        if (!argument) return;

        // An identifier argument is followed to its assignments, so the common
        // `let query = ...; query += ...` shape is judged rather than skipped.
        if (argument.type === 'Identifier') {
          if (isProvable(argument)) return;

          const variable = resolveVariable(
            sourceCode.getScope(argument),
            argument.name,
          );
          const writes = variable ? writesTo(variable) : [];

          if (writes.length === 0) {
            context.report({
              node: argument,
              messageId: 'indirect',
              data: { what: describe(argument) },
            });
            return;
          }

          for (const write of writes) report(write, 'dynamic');
          return;
        }

        report(argument, 'dynamic');
      },
    };
  },
};

// ------------------------------------------------------------ no-select-star

// A `*` used as a COLUMN SELECTOR: preceded by whitespace, a comma or a dot —
// `SELECT *`, `SELECT id, *`, `SELECT a.*`. A `*` preceded by `(` is
// `COUNT(*)` or `SUM(*)`, which is an aggregate over rows rather than a column
// list and is used legitimately throughout the dashboard queries.
const SELECT_STAR = /\bselect\b[^;]*?[\s,.]\*/i;

const noSelectStar = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Tool queries must list their columns explicitly, so a column added ' +
        'later cannot reach a tool result.',
    },
    schema: [],
    messages: {
      selectStar:
        'SELECT * in a query. CLAUDE.md rule 4: explicit column lists only — ' +
        '`users` and `doctors` carry password, verification_token and ' +
        'reset_password_token, which must never reach a tool result.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const { writesTo } = createProvableChecks(sourceCode);

    const textOf = (node) => {
      if (!node) return null;
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
      }
      if (node.type === 'TemplateLiteral') return sourceCode.getText(node);
      return null;
    };

    // Same reach as the interpolation rule: an identifier argument is followed
    // to its assignments, since `const query = \`SELECT * ...\`` is exactly how
    // several queries in this codebase are written.
    const check = (node) => {
      if (!node) return;

      const text = textOf(node);
      if (text !== null) {
        if (SELECT_STAR.test(text)) {
          context.report({ node, messageId: 'selectStar' });
        }
        return;
      }

      if (node.type === 'BinaryExpression' && node.operator === '+') {
        check(node.left);
        check(node.right);
        return;
      }

      if (node.type === 'Identifier') {
        const variable = resolveVariable(sourceCode.getScope(node), node.name);
        if (!variable) return;

        for (const write of writesTo(variable)) {
          if (textOf(write) !== null || write.type === 'BinaryExpression') {
            check(write);
          }
        }
      }
    };

    return {
      CallExpression(node) {
        if (!isQueryCall(node)) return;
        check(node.arguments[0]);
      },
    };
  },
};

export const rules = {
  'no-sql-string-interpolation': noSqlStringInterpolation,
  'no-select-star': noSelectStar,
};

export default { rules };
