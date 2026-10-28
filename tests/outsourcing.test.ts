import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import { checkConsistency } from "../src/services/consistency";
import type { Actor } from "../src/lib/permissions";
import { approvedSpec } from "./spec-fixture";

const { currentActor } = vi.hoisted(() => ({ currentActor: vi.fn() }));
vi.mock("../src/auth", () => ({ currentActor }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("../src/components/forms", () => ({ ActionForm: () => null }));
vi.mock("../src/components/data-table", () => ({ DataTable: () => null }));
import OutsourcingPage from "../src/app/(erp)/outsourcing/page";
import OutsourcingDetail from "../src/app/(erp)/outsourcing/[id]/page";
import SubcontractorsPage from "../src/app/(erp)/subcontractors/page";
import SubcontractorDetail from "../src/app/(erp)/subcontractors/[id]/page";

process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor,
  material: string,
  variant: string,
  bom: string,
  profile: string;
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
    sql`truncate users,warehouses,products,materials,customers,suppliers cascade`,
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
  const [m] = await db()
    .insert(s.materials)
    .values({ name: "Fabric", sku: "FAB", unit: "Meters" })
    .returning();
  material = m.id;
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Jacket", sku: "JKT" })
    .returning();
  const [v] = await db()
    .insert(s.variants)
    .values({
      productId: p.id,
      sku: "JKT-L",
      size: "L",
      color: "Lime",
      price: "100",
    })
    .returning();
  variant = v.id;
  await approvedSpec(actor, p.id, variant);
  await act("bom", {
    variantId: variant,
    laborCost: "0",
    items: [{ materialId: material, quantity: "2.5" }],
  });
  [bom] = (await db().select().from(s.boms)).map((b) => b.id);
  const [supplier] = await db()
    .insert(s.suppliers)
    .values({ name: "Workshop" })
    .returning();
  await act("saveSubcontractor", {
    supplierId: supplier.id,
    specialties: "Sewing",
    capacity: 100,
  });
  [profile] = (await db().select().from(s.subcontractors)).map((p) => p.id);
  await act("adjust", {
    itemId: material,
    kind: "material",
    delta: "100",
    reason: "Opening material stock",
  });
});
async function outsourcing(saleItemId?: string) {
  await act("manufacture", { bomId: bom, quantity: 10, saleItemId });
  const [mo] = await db().select().from(s.manufacturing);
  await act("createOutsourcing", {
    manufacturingOrderId: mo.id,
    subcontractorId: profile,
    dueDate: "2099-01-01",
    currency: "UZS",
    unitCost: "5",
  });
  const [order] = await db().select().from(s.outsourcingOrders);
  return { mo, order };
}
it("requires confirmed customer demand before outsourcing material allocation and rolls back rejected activation", async () => {
  const [customer] = await db()
    .insert(s.customers)
    .values({ name: "Buyer" })
    .returning();
  await act("sale", {
    partyId: customer.id,
    currency: "UZS",
    lines: [{ itemId: variant, quantity: "10", price: "100", discount: "0" }],
  });
  const [sale] = await db().select().from(s.sales);
  const [line] = await db().select().from(s.saleItems);
  const { mo, order } = await outsourcing(line.id);
  const key = randomUUID();
  await expect(
    act("activateOutsourcing", { id: order.id }, key),
  ).rejects.toThrow("Confirm the sales order");
  expect(await db().select().from(s.reservations)).toHaveLength(0);
  expect(
    await db().select().from(s.operations).where(eq(s.operations.key, key)),
  ).toHaveLength(0);
  expect(
    (
      await db()
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, mo.id))
    )[0].status,
  ).toBe("Draft");
  await act("confirmSale", { id: sale.id });
  await act("activateOutsourcing", { id: order.id }, key);
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0].reserved,
  ).toBe("25.0000");
});
it("reconciles active outsourcing reservations after physical issue, consumption and unused return", async () => {
  const { order } = await outsourcing();
  await act("activateOutsourcing", { id: order.id });
  const [reservation] = await db().select().from(s.reservations);
  await act("issueOutsourcingMaterial", {
    id: order.id,
    reservationId: reservation.id,
    quantity: "15",
    reference: "ISSUE-1",
  });
  const [custody] = await db().select().from(s.outsourcingCustody);
  expect(custody.consumed).toBe("0.0000");
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0],
  ).toMatchObject({ onHand: "85.0000", reserved: "10.0000" });
  expect((await checkConsistency()).filter((r) => r.violations)).toEqual([]);
  await act("settleOutsourcingMaterial", {
    id: order.id,
    custodyId: custody.id,
    kind: "Consumed",
    quantity: "12",
    reference: "USE-1",
  });
  await act("settleOutsourcingMaterial", {
    id: order.id,
    custodyId: custody.id,
    kind: "Returned",
    quantity: "3",
    reference: "RETURN-1",
  });
  expect(
    (
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.materialId, material))
    )[0],
  ).toMatchObject({ onHand: "88.0000", reserved: "10.0000" });
  expect((await checkConsistency()).filter((r) => r.violations)).toEqual([]);
});
it.each(["sales", "viewer"] as const)(
  "denies %s access to subcontractor and outsourcing records before database reads",
  async (role) => {
    currentActor.mockResolvedValue({ ...actor, role });
    const params = Promise.resolve({ id: randomUUID() });
    await expect(OutsourcingPage()).rejects.toThrow("NOT_FOUND");
    await expect(OutsourcingDetail({ params })).rejects.toThrow("NOT_FOUND");
    await expect(SubcontractorsPage()).rejects.toThrow("NOT_FOUND");
    await expect(SubcontractorDetail({ params })).rejects.toThrow("NOT_FOUND");
  },
);
