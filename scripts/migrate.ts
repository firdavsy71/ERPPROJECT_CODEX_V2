import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
const { db, localClient, neonClient } = await import("../src/db");
const client = localClient();
if (client) {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { drizzle } = await import("drizzle-orm/pglite");
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.close();
} else if (neonClient()) {
  const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  await migrate(drizzle(neonClient()!), { migrationsFolder: "drizzle" });
  await neonClient()!.end();
} else {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db(), { migrationsFolder: "drizzle" });
}
console.log("Migrations applied.");
process.exit(0);
