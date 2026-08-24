import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// Loads backend/.env by a path derived from THIS FILE's location.
//
// Not from the working directory, because dotenv.config() resolves `.env`
// against process.cwd() and Claude Desktop chooses the cwd when it launches
// this server. Measured: run from mcp/, JWT_SECRET, DB_HOST and DB_NAME are
// all missing; run from backend/, all three are set. With no JWT_SECRET there
// is nothing to verify a token WITH, and the failure would look like a bad
// token rather than a bad configuration.
//
// Deriving the path from import.meta.url means the server finds its own env
// wherever it is started and whatever the host config says.
//
// Imported SECOND — after stdioGuard.js, before any backend module. Same
// import-ordering rule 4.1 established: imports are evaluated in order, and
// the backend must not be loaded before its env exists.

const here = dirname(fileURLToPath(import.meta.url));

export const BACKEND_ENV_PATH = resolve(here, '..', 'backend', '.env');

// `override` is left at its default of false: dotenv will not clobber a
// variable already in process.env. That is what makes the backend's own
// later dotenv.config() calls harmless no-ops, and it lets a host config
// override any single value if it needs to.
const result = dotenv.config({ path: BACKEND_ENV_PATH, quiet: true });

if (result.error) {
  console.error(
    `Could not read ${BACKEND_ENV_PATH} — the server will start, but nothing ` +
      'requiring the database or JWT_SECRET will work until it exists.',
  );
}

export const hasJwtSecret = () => Boolean(process.env.JWT_SECRET);
