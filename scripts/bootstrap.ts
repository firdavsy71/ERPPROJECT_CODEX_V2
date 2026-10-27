import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { hash } from "bcryptjs";
import { z } from "zod";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = z.string().min(12).max(200).parse(process.env.ADMIN_PASSWORD);
await db().transaction(async (tx) => {
  await tx
    .insert(s.users)
    .values({
      name: "Administrator",
      email,
      passwordHash: await hash(password, 12),
      role: "admin",
    })
    .onConflictDoNothing();
  await tx
    .insert(s.warehouses)
    .values({ name: "Main warehouse" })
    .onConflictDoNothing();
  await tx.insert(s.settings).values({ id: 1 }).onConflictDoNothing();
});
console.log(
  "Administrator and workspace bootstrapped. Existing credentials preserved.",
);
await localClient()?.close();
process.exit(0);
