import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { SQL } from "drizzle-orm";
import { applyMigrations } from "../scripts/migration-runner";

const migration = (when: number, ...statements: string[]): MigrationMeta => ({
  folderMillis: when, hash: `hash-${when}`, sql: statements, bps: true,
});

it("preserves Drizzle history and skips already applied migrations on PostgreSQL-compatible storage", async () => {
  const client = new PGlite();
  try {
    const database = drizzle(client);
    const files = [migration(1, "create table migration_probe (id int primary key)", "insert into migration_probe values (1)")];
    expect(await applyMigrations(database, files, {advisoryLock:false})).toBe(1);
    expect(await applyMigrations(database, files, {advisoryLock:false})).toBe(0);
    expect((await client.query("select * from migration_probe")).rows).toEqual([{id:1}]);
    expect((await client.query("select hash from drizzle.__drizzle_migrations")).rows).toEqual([{hash:"hash-1"}]);
  } finally { await client.close(); }
});

it("rolls back DDL and migration history together when a later statement fails", async () => {
  const client = new PGlite();
  try {
    const files = [migration(1, "create table rollback_probe (id int)", "insert into missing_table values (1)")];
    await expect(applyMigrations(drizzle(client), files, {advisoryLock:false})).rejects.toThrow();
    expect((await client.query("select to_regclass('rollback_probe') as name")).rows).toEqual([{name:null}]);
    expect((await client.query("select to_regclass('drizzle.__drizzle_migrations') as name")).rows).toEqual([{name:null}]);
  } finally { await client.close(); }
});

it("acquires transaction-scoped lock before history access and serializes two simulated runners", async () => {
  const dialect = new PgDialect();
  let queue = Promise.resolve(), latest: number | undefined, applied = 0;
  const events: {tx:number; query:string}[] = [];
  let nextTx = 0;
  const database = {
    async transaction<T>(work: (tx: {execute(query:SQL):Promise<unknown>}) => Promise<T>) {
      const tx = ++nextTx;
      let release: (() => void) | undefined;
      try {
        return await work({execute: async (statement) => {
          const query = dialect.sqlToQuery(statement);
          events.push({tx,query:query.sql});
          if (query.sql.includes("pg_advisory_xact_lock")) {
            const previous = queue;
            queue = new Promise<void>(resolve => {release = resolve;});
            await previous;
          }
          if (query.sql.startsWith("select created_at")) return {rows:latest === undefined ? [] : [{created_at:latest}]};
          if (query.sql === "create table concurrent_probe (id int)") {
            if (++applied > 1) throw new Error("duplicate migration");
          }
          if (query.sql.startsWith("insert into drizzle.__drizzle_migrations")) latest = Number(query.params[1]);
          return {rows:[]};
        }});
      } finally { release?.(); }
    },
  };
  const files = [migration(1,"create table concurrent_probe (id int)")];
  expect(await Promise.all([
    applyMigrations(database,files,{advisoryLock:true}),
    applyMigrations(database,files,{advisoryLock:true}),
  ])).toEqual([1,0]);
  for (const tx of [1,2]) {
    const own = events.filter(e=>e.tx===tx).map(e=>e.query);
    expect(own[0]).toContain("set local lock_timeout");
    expect(own[1]).toContain("pg_advisory_xact_lock");
    expect(own[2]).toContain("create schema");
  }
});
