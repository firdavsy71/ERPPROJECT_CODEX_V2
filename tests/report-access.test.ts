import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute } from "../src/services/operations";
const { actor } = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("../src/auth", () => ({ currentActor: actor }));
vi.mock("../src/i18n/server", () => ({ currentLocale: async () => "en" }));
import { GET } from "../src/app/api/reports/route";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
it("denies anonymous and unauthorized exports and exports the entire movement journal", async () => {
  actor.mockResolvedValue(null);
  expect(
    (await GET(new Request("http://localhost/api/reports?report=invoices")))
      .status,
  ).toBe(401);
  actor.mockResolvedValue({ id: randomUUID(), role: "production" });
  expect(
    (await GET(new Request("http://localhost/api/reports?report=invoices")))
      .status,
  ).toBe(403);
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@test.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  await db().insert(s.warehouses).values({ name: "Main" });
  const [m] = await db()
    .insert(s.materials)
    .values({ name: "Material", sku: "MAT", unit: "Meters" })
    .returning();
  for (let i = 0; i < 105; i++)
    await execute(
      { id: u.id, role: "admin" },
      "adjust",
      {
        kind: "material",
        itemId: m.id,
        delta: "1",
        reason: "Journal export regression",
      },
      randomUUID(),
    );
  actor.mockResolvedValue({ id: u.id, role: "inventory" });
  const response = await GET(
    new Request("http://localhost/api/reports?report=movements"),
  );
  expect(response.status).toBe(200);
  expect((await response.text()).trim().split("\r\n")).toHaveLength(106);
});
