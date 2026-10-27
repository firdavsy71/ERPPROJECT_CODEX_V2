import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
type Database = ReturnType<typeof drizzle<typeof schema>>;
const globalDb = globalThis as unknown as {
  erpDb?: Database;
  erpLocal?: PGlite;
  erpNeon?: Pool;
};
export function db(): Database {
  if (globalDb.erpDb) return globalDb.erpDb;
  if (process.env.DATABASE_URL) {
    if (new URL(process.env.DATABASE_URL).hostname.endsWith(".neon.tech")) {
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      neonConfig.webSocketConstructor = class extends WebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(
            url,
            protocols,
            proxy ? { agent: new HttpsProxyAgent(proxy) } : undefined,
          );
        }
      };
      globalDb.erpNeon = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 15000,
      });
      globalDb.erpDb = neonDrizzle(globalDb.erpNeon, {
        schema,
      }) as unknown as Database;
    } else
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
export function neonClient() {
  db();
  return globalDb.erpNeon;
}
