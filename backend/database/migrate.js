import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

// `schema.sql` is the baseline — it only ever runs on a fresh database. Every
// schema change after it lives in migrations/ and is applied by this runner,
// which records what it has already run in `schema_migrations`.
const runMigrations = async () => {
  let connection;
  let failed = false;

  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      // Aiven requires TLS; the local Compose database does not.
      ...(process.env.DB_SSL === 'true' && {
        ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
      }),
      // A migration file may hold several statements.
      multipleStatements: true,
    });
    console.log('Connected to database\n');

    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );

    const [appliedRows] = await connection.query(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(appliedRows.map((row) => row.filename));

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    let appliedCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipped (already applied): ${file}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');

      console.log(`Applying: ${file}`);
      // MySQL DDL is not transactional, so each file is recorded on its own
      // once it has succeeded — a failure part-way leaves the earlier files
      // recorded and this one not.
      await connection.query(sql);
      await connection.query(
        'INSERT INTO schema_migrations (filename) VALUES (?)',
        [file],
      );
      appliedCount += 1;
      console.log(`Applied: ${file}`);
    }

    console.log(
      `\nMIGRATIONS COMPLETE — ${appliedCount} applied, ${files.length - appliedCount} already up to date.`,
    );
  } catch (error) {
    failed = true;
    console.error('Migration error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
    process.exit(failed ? 1 : 0);
  }
};

runMigrations();
