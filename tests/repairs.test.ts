import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import type { Actor } from "../src/lib/permissions";

process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor,
  customer: string,
  employee: string,
  material: string,
  variant: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(actor, action, input, key);
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(
    sql`truncate users,warehouses,products,materials,customers,employees cascade`,
  );
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  [customer] = (
    await db().insert(s.customers).values({ name: "Customer" }).returning()
  ).map((x) => x.id);
  [employee] = (
    await db().insert(s.employees).values({ name: "Tailor" }).returning()
  ).map((x) => x.id);
  [material] = (
    await db()
      .insert(s.materials)
      .values({ name: "Fabric", sku: "FAB", unit: "Meters" })
      .returning()
  ).map((x) => x.id);
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Jacket", sku: "JKT" })
    .returning();
  [variant] = (
    await db()
      .insert(s.variants)
      .values({ productId: p.id, sku: "JKT-L", size: "L", color: "Navy" })
      .returning()
  ).map((x) => x.id);
});
async function create() {
  await act("createRepair", {
    customerId: customer,
    variantId: variant,
    productDescription: "Customer jacket, navy size L",
    activity: "Seam repair",
    instructions: "Repair left sleeve seam",
    employeeId: employee,
    estimatedDate: "2099-01-01",
    cost: "25.50",
    currency: "UZS",
  });
  return (await db().select().from(s.repairOrders))[0];
}
it("tracks customer property without creating finished stock and consumes materials once", async () => {
  const order = await create();
  await expect(
    act("repairStatus", { id: order.id, status: "Completed", notes: "done" }),
  ).rejects.toThrow("Invalid");
  await act("adjust", {
    kind: "material",
    itemId: material,
    delta: "10",
    reason: "Opening stock",
  });
  await act("requireRepairMaterial", {
    id: order.id,
    materialId: material,
    quantity: "2",
    notes: "Seam material",
  });
  await act("repairStatus", {
    id: order.id,
    status: "Diagnosed",
    notes: "Seam damaged",
  });
  await act("repairStatus", {
    id: order.id,
    status: "In Progress",
    notes: "Assigned and started",
  });
  await act("recordRepairLabor", {
    id: order.id,
    employeeId: employee,
    minutes: "35",
    notes: "Repair completed",
  });
  const key = randomUUID(),
    usage = {
      id: order.id,
      materialId: material,
      quantity: "2",
      notes: "Used for repair",
    };
  await act("consumeRepairMaterial", usage, key);
  await act("consumeRepairMaterial", usage, key);
  await expect(
    act("consumeRepairMaterial", { ...usage, quantity: "9" }),
  ).rejects.toThrow("Insufficient");
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0].onHand,
  ).toBe("8.0000");
  expect(await db().select().from(s.repairMaterialUsage)).toHaveLength(1);
  await act("repairStatus", {
    id: order.id,
    status: "Quality Check",
    notes: "Submitted for inspection",
  });
  await act("repairStatus", {
    id: order.id,
    status: "Completed",
    notes: "Seam inspected and passed",
  });
  await act("repairStatus", {
    id: order.id,
    status: "Returned",
    notes: "Customer collected garment",
  });
  expect(
    await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.variantId, variant)),
  ).toHaveLength(0);
  expect(await db().select().from(s.repairLabor)).toHaveLength(1);
});
it("uses the selected tracked roll and respects permissions", async () => {
  const order = await create();
  await act("adjust", {
    kind: "material",
    itemId: material,
    delta: "10",
    reason: "Opening stock",
  });
  await act("activateRollTracking", {
    materialId: material,
    rolls: [
      {
        rollNumber: "R1",
        receivedLength: "10",
        color: "Navy",
        composition: "Cotton",
        widthCm: "150",
        storageLocation: "A",
      },
    ],
  });
  const [roll] = await db().select().from(s.fabricRolls);
  await act("repairStatus", {
    id: order.id,
    status: "Diagnosed",
    notes: "Inspect",
  });
  await act("repairStatus", {
    id: order.id,
    status: "In Progress",
    notes: "Started",
  });
  await expect(
    act("consumeRepairMaterial", {
      id: order.id,
      materialId: material,
      quantity: "2",
      notes: "Used",
    }),
  ).rejects.toThrow("Select a fabric roll");
  await act("consumeRepairMaterial", {
    id: order.id,
    materialId: material,
    quantity: "2",
    rollId: roll.id,
    notes: "Used",
  });
  expect((await db().select().from(s.fabricRolls))[0].remainingLength).toBe(
    "8.0000",
  );
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0].onHand,
  ).toBe("8.0000");
  expect((await db().select().from(s.repairMaterialUsage))[0].rollId).toBe(
    roll.id,
  );
  await expect(
    execute(
      { id: actor.id, role: "viewer" },
      "recordRepairLabor",
      { id: order.id, employeeId: employee, minutes: "1", notes: "No access" },
      randomUUID(),
    ),
  ).rejects.toThrow("permission");
});
