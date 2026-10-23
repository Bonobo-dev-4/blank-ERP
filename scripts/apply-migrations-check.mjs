/**
 * Apply every migration to a throwaway Postgres (PGlite, in memory) and report
 * what the resulting schema contains.
 *
 * This is the cheapest possible check that the migrations are valid SQL and
 * apply in order on an empty database, and it needs no Docker and no server.
 *
 *   node scripts/apply-migrations-check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const base = 'apps/api/prisma/migrations';

// Read the directory rather than listing migrations by hand. A hardcoded list
// silently skips every migration added after it was written, which makes the
// check pass while verifying nothing.
const dirs = fs
  .readdirSync(base, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(`${base}/${e.name}/migration.sql`))
  .map((e) => e.name)
  .sort(); // Prisma's timestamp prefixes sort into application order.

if (dirs.length === 0) {
  console.error(`No migrations found under ${base}`);
  process.exit(1);
}

const db = new PGlite();
for (const dir of dirs) {
  const sql = fs.readFileSync(`${base}/${dir}/migration.sql`, 'utf8');
  try {
    await db.exec(sql);
    console.log(`APPLIED  ${dir}`);
  } catch (e) {
    console.log(`FAILED   ${dir}\n  ${e.message}`);
    process.exit(1);
  }
}

const one = async (sql) => (await db.query(sql)).rows[0].n;
const tables = await one(
  `select count(*)::int n from information_schema.tables where table_schema='public'`,
);
const checks = await one(
  `select count(*)::int n from pg_constraint where contype='c' and connamespace='public'::regnamespace`,
);
const indexes = await one(`select count(*)::int n from pg_indexes where schemaname='public'`);
const fks = await one(
  `select count(*)::int n from pg_constraint where contype='f' and connamespace='public'::regnamespace`,
);
const enums = await one(`select count(*)::int n from pg_type where typtype='e' and typnamespace='public'::regnamespace`);

console.log(
  `${dirs.length} migrations -> tables=${tables} enums=${enums} check_constraints=${checks} fks=${fks} indexes=${indexes}`,
);
