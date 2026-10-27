import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
const { db, localClient } = await import("../src/db");
const client = localClient();
if (client) {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { drizzle } = await import("drizzle-orm/pglite");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.close();
} else {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db(), { migrationsFolder: "drizzle" });
}
console.log("Migrations applied.");
process.exit(0);
