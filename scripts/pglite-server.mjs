/**
 * Dev/test Postgres over TCP, backed by PGlite (Postgres compiled to WASM).
 *
 * Lets `prisma migrate deploy`, `prisma studio` and the Jest integration suite
 * talk to a real Postgres engine on a machine with no Postgres and no Docker.
 *
 *   node scripts/pglite-server.mjs [--port 5432] [--dir ./.pgdata] [--host 127.0.0.1]
 *
 * Without --dir the database is IN MEMORY and is lost when this process stops.
 *
 * NOTES
 *  - PGlite serves ONE connection at a time, so this is for migrations and
 *    sequential integration tests only. True concurrency tests (SELECT ... FOR
 *    UPDATE races) need the real Postgres in docker/docker-compose.yml.
 *  - Prisma must connect with `pgbouncer=true`, which disables its
 *    prepared-statement cache. PGlite shares a single backend session, so a
 *    second client would otherwise collide on prepared statement names.
 *  - The default host is 127.0.0.1 rather than localhost: on macOS "localhost"
 *    resolves to ::1 first, and a client would get ECONNREFUSED against an
 *    IPv4-only listener.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const port = Number(arg('port', 5432));
const host = arg('host', '127.0.0.1');
const dir = arg('dir', undefined); // undefined = in-memory

const die = (lines) => {
  console.error(`\n  ${lines.join('\n  ')}\n`);
  process.exit(1);
};

/**
 * Refuse early and legibly if the port is taken.
 *
 * Without this the failure is a raw EADDRINUSE stack trace, which does not say
 * the obvious thing: a server is probably already running, and starting a
 * second one is not what you want.
 */
async function assertPortFree() {
  await new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        fail(
          die([
            `Port ${port} is already in use.`,
            '',
            'A PGlite server is most likely already running. Check with:',
            `  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
            '',
            'If it is the one you want, leave it running - you do not need a second.',
            'To stop it:  pkill -f pglite-server.mjs',
            `Or start this one elsewhere:  --port ${port + 1}`,
          ]),
        );
        return;
      }
      fail(e);
    });
    probe.once('listening', () => probe.close(ok));
    probe.listen(port, host);
  });
}

/**
 * Refuse if another process already has this data directory open.
 *
 * PGlite is an embedded single-process engine. Two servers on one data
 * directory abort inside the WASM runtime with an unreadable
 * `RuntimeError: Aborted()` and can leave the directory damaged, so this
 * catches it first.
 */
function assertDataDirFree(dataDir) {
  const lock = resolve(dataDir, 'postmaster.pid');
  if (!existsSync(lock)) return;

  const pid = Number(readFileSync(lock, 'utf8').split('\n')[0]);
  let alive = false;
  try {
    process.kill(pid, 0); // signal 0 only tests for existence
    alive = true;
  } catch {
    alive = false;
  }

  if (alive) {
    die([
      `The data directory ${dataDir} is already open by process ${pid}.`,
      '',
      'PGlite is a single-process engine; a second server on the same directory',
      'would corrupt it. That other process is your database - use it.',
      '',
      `To stop it:  kill ${pid}`,
    ]);
  }

  // Stale lock from a process that is gone. Safe to clear.
  console.warn(`  clearing stale lock from pid ${pid}`);
  rmSync(lock, { force: true });
}

if (dir) assertDataDirFree(dir);
await assertPortFree();

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

const db = await PGlite.create(dir ? { dataDir: dir } : {});
const server = new PGLiteSocketServer({ db, port, host });
await server.start();

// Record our pid so a second start can detect us even before PGlite would.
if (dir) writeFileSync(resolve(dir, 'postmaster.pid'), `${process.pid}\n`);

console.log(`pglite listening on ${host}:${port} (${dir ?? 'in-memory, not persisted'})`);
console.log(`connect with: postgresql://postgres:postgres@${host}:${port}/postgres` +
            '?schema=public&sslmode=disable&pgbouncer=true&connection_limit=1');
if (!dir) console.log('WARNING: no --dir given, so this database is lost on exit');

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try {
    await server.stop();
    await db.close();
  } finally {
    if (dir) rmSync(resolve(dir, 'postmaster.pid'), { force: true });
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
