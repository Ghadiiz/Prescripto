import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import express from 'express';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenApiSpec } from '../src/docs/openapi.js';
import { mountApiDocs, DOCS_PATH, DOCS_JSON_PATH } from '../src/docs/serveDocs.js';
import { API_ROUTES, listApiEndpoints, toOpenApiPath } from '../src/routes.js';

// The API documentation (6.3).
//
// No database and no Redis: the spec is generated from source comments, so
// these run anywhere. That is deliberate — documentation drift should be
// caught by the cheapest test in the suite, not one that needs infrastructure.

const spec = buildOpenApiSpec();

// Every { method, path } the spec documents.
const documented = () => {
  const out = new Set();
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(operations)) {
      out.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return out;
};

// --- coverage: the assertion that matters -----------------------------------

test('every mounted endpoint is documented', () => {
  const docs = documented();
  const missing = listApiEndpoints()
    .map(({ method, path }) => `${method} ${path}`)
    .filter((key) => !docs.has(key));

  assert.deepEqual(
    missing,
    [],
    'these endpoints are served but undocumented — add an @openapi block ' +
      'beside the route',
  );
});

test('the docs describe no endpoint that does not exist', () => {
  // The other direction, and it matters as much: a spec entry for a route that
  // was renamed or removed is worse than no entry, because a reader trusts it.
  const served = new Set(
    listApiEndpoints().map(({ method, path }) => `${method} ${path}`),
  );
  const phantom = [...documented()].filter((key) => !served.has(key));

  assert.deepEqual(phantom, [], 'documented but not served');
});

test('the whole API is covered, counted', () => {
  // A router silently dropped from the mount table would leave both tests
  // above passing on a smaller API. The count is what notices.
  assert.equal(API_ROUTES.length, 7, 'seven routers are mounted');
  assert.equal(listApiEndpoints().length, 47, 'the API has 47 endpoints');
  assert.equal(documented().size, 47);
});

test('path parameters are converted to OpenAPI templates', () => {
  assert.equal(toOpenApiPath('/api/doctors/:id'), '/api/doctors/{id}');
  assert.equal(
    toOpenApiPath('/api/doctor/appointments/:id/cancel'),
    '/api/doctor/appointments/{id}/cancel',
  );
  // A router's own '/' must not leave a trailing slash behind.
  assert.equal(toOpenApiPath('/api/doctors/'), '/api/doctors');
  assert.equal(toOpenApiPath('/'), '/');
});

// --- nothing real, and nothing internal, may appear in a public document ----

const serialised = JSON.stringify(spec);

test('no real credential or personal data appears in the spec', () => {
  // A JWT is three base64 segments and always starts `eyJ`. Nothing that
  // shape belongs in a document served to the public.
  assert.ok(
    !/eyJ[A-Za-z0-9_-]{6,}/.test(serialised),
    'something JWT-shaped is in the spec',
  );

  // Every example address must be in the reserved .invalid TLD, which can
  // never resolve. A real address would mean data from local testing leaked
  // into a public page.
  const addresses = serialised.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
  const foreign = addresses.filter((a) => !a.endsWith('@example.invalid'));
  assert.deepEqual(foreign, [], 'example addresses must use @example.invalid');

  // The seed's real accounts, named explicitly so a copy-paste from a local
  // session is caught by name rather than by pattern.
  for (const real of ['demo@prescripto.com', 'prescripto.com', 'gmail.com']) {
    assert.ok(!serialised.includes(real), `the spec mentions "${real}"`);
  }
});

test('the spec documents the contract, not the defences', () => {
  // These docs are public. They may say a 401 is possible; they may not
  // explain what distinguishes one from another, or how the assistant decides
  // to refuse. Each term below names an internal mechanism.
  const forbidden = [
    'guardrail',
    'emergency',
    'scope check',
    'wrong_role',
    'misconfigured',
    'thoughtSignature',
    'confirmation_token',
    'assistant_audit_log',
    'JWT_SECRET',
    'active_slot',
  ];

  const leaked = forbidden.filter((term) =>
    serialised.toLowerCase().includes(term.toLowerCase()),
  );

  assert.deepEqual(
    leaked,
    [],
    'these name internal mechanisms and must not appear in public docs',
  );
});

// --- the document itself -----------------------------------------------------

test('the spec is structurally valid OpenAPI 3', () => {
  assert.match(spec.openapi, /^3\./);
  assert.ok(spec.info?.title);
  assert.ok(spec.info?.version);
  assert.ok(Object.keys(spec.paths ?? {}).length > 0);

  // Tags come from the mount table, so the grouping cannot drift from what is
  // mounted.
  assert.deepEqual(
    (spec.tags ?? []).map((t) => t.name).sort(),
    API_ROUTES.map((r) => r.tag).sort(),
  );
});

test('every $ref resolves', () => {
  const refs = [...serialised.matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected the spec to use shared components');

  for (const ref of new Set(refs)) {
    const segments = ref.replace(/^#\//, '').split('/');
    let node = spec;
    for (const segment of segments) {
      node = node?.[segment];
    }
    assert.ok(node, `dangling $ref: ${ref}`);
  }
});

test('secured endpoints declare it, public ones do not', () => {
  const security = (method, path) => spec.paths?.[path]?.[method]?.security;

  // A patient's own data must never be documented as public.
  assert.ok(security('get', '/api/auth/profile'), 'profile must require auth');
  assert.ok(security('get', '/api/appointments/my-appointments'));
  assert.ok(security('get', '/api/notifications'));
  assert.ok(security('post', '/api/assistant/chat'));
  assert.ok(security('get', '/api/admin/doctors'));

  // The public directory genuinely is public; claiming otherwise would be a
  // different kind of wrong.
  assert.equal(security('get', '/api/doctors'), undefined);
  assert.equal(security('post', '/api/auth/login'), undefined);
});

// --- serving ------------------------------------------------------------------

let server;

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('server.js mounts the docs ABOVE the readiness gate', async () => {
  // Boots the REAL server.js with the database pointed at a dead port.
  //
  // The app-level test below proves mountApiDocs needs no database. It does
  // NOT prove server.js mounts it in the right place — measured: moving the
  // call below `app.use('/api', databaseReady)` left that test passing 10/10,
  // because it builds its own app. Only the real entry point can answer this.
  const port = 3089;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    env: {
      ...process.env,
      PORT: String(port),
      // Unroutable, so connectDB never succeeds and the gate stays closed.
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    // connectDB is deliberately not awaited, so the port binds immediately.
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15000;
    let docs;

    for (;;) {
      try {
        docs = await fetch(`${base}${DOCS_JSON_PATH}`);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error('server never bound its port');
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    assert.equal(docs.status, 200, 'the docs must answer while the DB is down');

    // The control: a database-backed route IS gated, so this proves the gate
    // is active and the docs are genuinely above it rather than the gate being
    // inert.
    const gated = await fetch(`${base}/api/doctors`);
    assert.equal(gated.status, 503, 'a database route must be gated meanwhile');
  } finally {
    child.kill('SIGKILL');
  }
});

test('the docs are served without a database', async () => {
  // The readiness-gate point. This app has no database connection at all, and
  // never calls connectDB — if the docs needed one, or were mounted below the
  // gate, this could not answer.
  const app = express();
  mountApiDocs(app);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const base = `http://127.0.0.1:${server.address().port}`;

  const json = await fetch(`${base}${DOCS_JSON_PATH}`);
  assert.equal(json.status, 200);
  const body = await json.json();
  assert.equal(Object.keys(body.paths).length, Object.keys(spec.paths).length);

  const ui = await fetch(`${base}${DOCS_PATH}/`);
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await ui.text(), /swagger/i);
});
