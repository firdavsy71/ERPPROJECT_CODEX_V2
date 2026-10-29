import { sql, type SQL } from "drizzle-orm";
import type { MigrationMeta } from "drizzle-orm/migrator";

type MigrationTransaction = { execute(query: SQL): Promise<unknown> };
type MigrationDatabase = {
  transaction<T>(work: (tx: MigrationTransaction) => Promise<T>): Promise<T>;
};

/**
 * Keep the lock, history read and DDL on one PostgreSQL transaction. A session
 * advisory lock is insufficient when DATABASE_URL uses transaction pooling.
 * Drizzle's standard migrator reads history before opening its transaction.
 */
export async function applyMigrations(
  database: MigrationDatabase,
  migrations: MigrationMeta[],
  options: { advisoryLock: boolean },
) {
  return database.transaction(async (tx) => {
    if (options.advisoryLock) {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(1163022413, 1)`);
    }
    await tx.execute(sql`create schema if not exists drizzle`);
    await tx.execute(sql`create table if not exists drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )`);
    const result = await tx.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`);
    const rows = (Array.isArray(result) ? result : (result as {rows: unknown[]}).rows) as {created_at: string | number}[];
    const last = rows[0] ? Number(rows[0].created_at) : -Infinity;
    let applied = 0;
    for (const migration of migrations) {
      if (migration.folderMillis <= last) continue;
      for (const statement of migration.sql) await tx.execute(sql.raw(statement));
      await tx.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`);
      applied++;
    }
    return applied;
  });
}
