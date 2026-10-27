import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
type Database = ReturnType<typeof drizzle<typeof schema>>;
const globalDb = globalThis as unknown as {
  erpDb?: Database;
  erpLocal?: PGlite;
};
export function db(): Database {
  if (globalDb.erpDb) return globalDb.erpDb;
  if (process.env.DATABASE_URL) {
    globalDb.erpDb = drizzle(
      postgres(process.env.DATABASE_URL, { max: 5, prepare: false }),
      { schema },
    );
  } else if (process.env.PGLITE_DATA_DIR && process.env.VERCEL !== "1") {
    globalDb.erpLocal = new PGlite(
      process.env.PGLITE_DATA_DIR === ":memory:"
        ? undefined
        : process.env.PGLITE_DATA_DIR,
    );
    globalDb.erpDb = localDrizzle(globalDb.erpLocal, {
      schema,
    }) as unknown as Database;
  } else
    throw new Error(
      "Configure DATABASE_URL for Neon, or run npm run setup:local for local development.",
    );
  return globalDb.erpDb;
}
export function localClient() {
  db();
  return globalDb.erpLocal;
}
