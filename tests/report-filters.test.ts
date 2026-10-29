import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
const { actor } = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("../src/auth", () => ({ currentActor: actor }));
vi.mock("../src/i18n/server", () => ({ currentLocale: async () => "en" }));
import { GET } from "../src/app/api/reports/route";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let warehouse: string;
const get = (query: string) => GET(new Request(`http://localhost/api/reports?${query}`));
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
  await db().transaction(async tx => {
    const [u] = await tx.insert(s.users).values({name:"Test admin", email:"filters@test.com", passwordHash:"test", role:"admin"}).returning();
    actor.mockResolvedValue({id:u.id,role:"admin"});
    const [w, other] = await tx.insert(s.warehouses).values([{name:"Selected"},{name:"Other"}]).returning();
    warehouse = w.id;
    await tx.insert(s.settings).values({id:1,timezone:"Asia/Tashkent",primaryWarehouseId:w.id});
    const [m, m2] = await tx.insert(s.materials).values([{name:"Selected fabric",sku:"SELECTED",unit:"Meters"},{name:"Other fabric",sku:"OTHER",unit:"Meters"}]).returning();
    const [b, b2] = await tx.insert(s.balances).values([{warehouseId:w.id,materialId:m.id,onHand:"3"},{warehouseId:other.id,materialId:m2.id,onHand:"1"}]).returning();
    await tx.insert(s.movements).values([
      {balanceId:b.id,quantity:"1",reason:"Before day",source:"test",operationKey:randomUUID(),createdBy:u.id,createdAt:new Date("2026-10-28T18:59:59Z")},
      {balanceId:b.id,quantity:"1",reason:"Start boundary",source:"test",operationKey:randomUUID(),createdBy:u.id,createdAt:new Date("2026-10-28T19:00:00Z")},
      {balanceId:b.id,quantity:"1",reason:"End boundary",source:"test",operationKey:randomUUID(),createdBy:u.id,createdAt:new Date("2026-10-29T18:59:59Z")},
      {balanceId:b2.id,quantity:"1",reason:"Wrong warehouse",source:"test",operationKey:randomUUID(),createdBy:u.id,createdAt:new Date("2026-10-29T10:00:00Z")},
    ]);
  });
});
afterAll(async () => { await localClient()?.close(); });
it("validates filter values and rejects unsupported stock-history claims", async () => {
  for (const query of ["report=movements&from=2026-02-30","report=movements&from=2026-10-30&to=2026-10-29","report=movements&warehouseId=bad","report=inventory&from=2026-10-29","report=materials&to=2026-10-29",`report=invoices&warehouseId=${warehouse}`]) {
    expect((await get(query)).status, query).toBe(400);
  }
  expect((await get(`report=movements&warehouseId=${randomUUID()}`)).status).toBe(404);
});
it("filters actual journal by warehouse and inclusive configured business day", async () => {
  const response = await get(`report=movements&from=2026-10-29&to=2026-10-29&warehouseId=${warehouse}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Report-Time-Zone")).toBe("Asia/Tashkent");
  const csv = await response.text();
  expect(csv).toContain("Start boundary");
  expect(csv).toContain("End boundary");
  expect(csv).not.toContain("Before day");
  expect(csv).not.toContain("Wrong warehouse");
  expect(csv.trim().split("\r\n")).toHaveLength(3);
});
it("filters current inventory and material catalog by an actual warehouse balance", async () => {
  const inventory = await get(`report=inventory&warehouseId=${warehouse}`);
  expect(inventory.headers.get("X-Report-Basis")).toBe("current-state");
  expect((await inventory.text()).trim().split("\r\n")).toHaveLength(2);
  const csv = await (await get(`report=materials&warehouseId=${warehouse}`)).text();
  expect(csv).toContain("Selected fabric");
  expect(csv).not.toContain("Other fabric");
});
it("retains authorization before filter and warehouse discovery", async () => {
  actor.mockResolvedValue(null);
  expect((await get("report=movements&warehouseId=bad")).status).toBe(401);
  actor.mockResolvedValue({id:randomUUID(),role:"production"});
  expect((await get("report=invoices&warehouseId=bad")).status).toBe(403);
});
