/**
 * Minimal PostgreSQL access layer. Production uses node-postgres against
 * DATABASE_URL; development and tests use PGlite (Postgres compiled to WASM,
 * in-process) — same SQL, no server to install.
 */
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { MIGRATIONS } from './migrations';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgliteDb implements Db {
  constructor(private readonly pg: PGlite) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.pg.transaction((t) =>
      fn({ query: async <R>(sql: string, params: unknown[] = []) => (await t.query<R>(sql, params)).rows }),
    );
  }

  close(): Promise<void> {
    return this.pg.close();
  }
}

class PostgresDb implements Db {
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows as T[];
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({ query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * DATABASE_URL set → PostgreSQL. Otherwise PGlite stored in `dataDir`
 * (or in memory when dataDir is null, for tests).
 */
export async function openDb(options: { databaseUrl?: string; dataDir?: string | null }): Promise<Db> {
  // PGlite does not create missing parent directories (fresh checkouts).
  if (!options.databaseUrl && options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const db = options.databaseUrl
    ? new PostgresDb(new pg.Pool({ connectionString: options.databaseUrl }))
    : new PgliteDb(options.dataDir ? new PGlite(options.dataDir) : new PGlite());
  await migrate(db);
  return db;
}

async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    await db.tx(async (q) => {
      for (const statement of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(statement);
      await q.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
  }
}
