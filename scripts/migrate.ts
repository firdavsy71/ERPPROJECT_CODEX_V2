import { config } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { applyMigrations } from "./migration-runner";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
const { db, localClient, neonClient } = await import("../src/db");
const client = localClient();
try {
  await applyMigrations(db(), readMigrationFiles({ migrationsFolder: "drizzle" }), {
    advisoryLock: !client,
  });
  console.log("Migrations applied.");
} finally {
  await client?.close();
  await neonClient()?.end();
}
process.exit(0);
