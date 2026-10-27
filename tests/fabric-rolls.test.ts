import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import { approvedSpec } from "./spec-fixture";
import type { Actor } from "../src/lib/permissions";

process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor, material: string, bom: string, supplier: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) => execute(actor, action, input, key);
const roll = (rollNumber: string, receivedLength: string, supplierBatch = "BATCH-A") => ({ rollNumber, receivedLength, supplierBatch, supplierLot: "LOT-1", color: "Hi-vis lime", composition: "65% polyester / 35% cotton", widthCm: "150", storageLocation: "Rack A" });
beforeAll(async () => { await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" }); });
afterAll(async () => { await localClient()?.close(); });
beforeEach(async () => {
  await db().execute(sql`truncate users,warehouses,products,materials,suppliers cascade`);
  const [user] = await db().insert(s.users).values({ name: "Admin", email: "admin@example.com", passwordHash: "test", role: "admin" }).returning();
  actor = { id: user.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  const [m] = await db().insert(s.materials).values({ name: "Hi-vis fabric", sku: "FAB", unit: "Meters" }).returning();
  material = m.id;
  const [sp] = await db().insert(s.suppliers).values({ name: "Fabric supplier" }).returning(); supplier = sp.id;
  const [product] = await db().insert(s.products).values({ name: "Jacket", sku: "JKT" }).returning();
  const [variant] = await db().insert(s.variants).values({ productId: product.id, sku: "JKT-L", size: "L", color: "Lime" }).returning();
  await approvedSpec(actor, product.id, variant.id);
  await act("bom", { variantId: variant.id, laborCost: "0", items: [{ materialId: material, quantity: "2.5" }] });
  [bom] = (await db().select().from(s.boms)).map((x) => x.id);
});
async function setup() {
  await act("adjust", { itemId: material, kind: "material", delta: "305", reason: "Opening stock" });
  await act("activateRollTracking", { materialId: material, rolls: [roll("001", "100"), roll("002", "85", "BATCH-B"), roll("003", "120")] });
  return db().select().from(s.fabricRolls).orderBy(s.fabricRolls.rollNumber);
}
async function makeOrder(quantity = 10) {
  await act("manufacture", { bomId: bom, quantity });
  const orders = await db().select().from(s.manufacturing);
  return orders[orders.length - 1];
}
async function complete(order: typeof s.manufacturing.$inferSelect, input: Record<string, unknown> = {}) {
  await act("start", { id: order.id });
  await act("record", { id: order.id, completed: order.quantity, defective: 0 });
  await act("complete", { id: order.id, approved: order.quantity, qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }], ...input });
}
describe("fabric roll inventory and traceability", () => {
  it("adopts existing stock without doubling it, and prevents generic adjustments and bypasses", async () => {
    const rolls = await setup();
    const [balance] = await db().select().from(s.balances).where(eq(s.balances.materialId, material));
    expect(balance.onHand).toBe("305.0000");
    expect(rolls.map((r) => r.remainingLength)).toEqual(["100.0000", "85.0000", "120.0000"]);
    await expect(act("adjust", { itemId: material, kind: "material", delta: "1", reason: "Wrong adjustment" })).rejects.toThrow("roll tracking");
    await expect(db().update(s.balances).set({ onHand: "999" }).where(eq(s.balances.id, balance.id))).rejects.toThrow();
    await expect(db().update(s.materials).set({ unit: "Pieces" }).where(eq(s.materials.id, material))).rejects.toThrow();
  });
  it("records partial consumption from chosen batches and releases the unused reservation", async () => {
    const rolls = await setup();
    const order = await makeOrder();
    await act("plan", { id: order.id, rollAllocations: [{ materialId: material, rollId: rolls[0].id, quantity: "10" }, { materialId: material, rollId: rolls[1].id, quantity: "15" }] });
    const [reservation] = await db().select().from(s.reservations).where(eq(s.reservations.orderId, order.id));
    await complete(order, { consumption: [{ reservationId: reservation.id, quantity: "12" }], rollConsumption: [{ reservationId: reservation.id, rollId: rolls[0].id, quantity: "4" }, { reservationId: reservation.id, rollId: rolls[1].id, quantity: "8" }] });
    const after = await db().select().from(s.fabricRolls).orderBy(s.fabricRolls.rollNumber);
    expect(after.map((r) => [r.remainingLength, r.reservedLength])).toEqual([["96.0000", "0.0000"], ["77.0000", "0.0000"], ["120.0000", "0.0000"]]);
    const events = await db().select().from(s.fabricRollMovements).where(eq(s.fabricRollMovements.manufacturingOrderId, order.id));
    expect(events.filter((e) => e.reason === "consume").map((e) => e.quantity).sort()).toEqual(["-4.0000", "-8.0000"]);
    const [balance] = await db().select().from(s.balances).where(eq(s.balances.materialId, material));
    expect([balance.onHand, balance.reserved]).toEqual(["293.0000", "0.0000"]);
  });
  it("does not consume another order's reserved roll and rolls back failed completion", async () => {
    const rolls = await setup();
    const first = await makeOrder();
    await act("plan", { id: first.id, rollAllocations: [{ materialId: material, rollId: rolls[0].id, quantity: "25" }] });
    const second = await makeOrder();
    await act("plan", { id: second.id, rollAllocations: [{ materialId: material, rollId: rolls[1].id, quantity: "25" }] });
    const [res] = await db().select().from(s.reservations).where(eq(s.reservations.orderId, first.id));
    await act("start", { id: first.id });
    await act("record", { id: first.id, completed: 10, defective: 0 });
    await expect(act("complete", { id: first.id, approved: 10, qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }], consumption: [{ reservationId: res.id, quantity: "61" }], rollConsumption: [{ reservationId: res.id, rollId: rolls[1].id, quantity: "61" }] })).rejects.toThrow("available");
    expect((await db().select().from(s.fabricRolls).where(eq(s.fabricRolls.id, rolls[1].id)))[0].reservedLength).toBe("25.0000");
    await act("cancelProduction", { id: second.id });
    expect((await db().select().from(s.fabricRolls).where(eq(s.fabricRolls.id, rolls[1].id)))[0].reservedLength).toBe("0.0000");
  });
  it("records damage once, keeps physical coordinates and honors idempotent operations", async () => {
    const rolls = await setup();
    const key = randomUUID(), input = { rollId: rolls[0].id, start: "10", end: "15", reason: "Damaged fabric" };
    await act("damageRoll", input, key); await act("damageRoll", input, key);
    await expect(act("damageRoll", input)).rejects.toThrow("usable fabric");
    const [r] = await db().select().from(s.fabricRolls).where(eq(s.fabricRolls.id, rolls[0].id));
    expect(r.remainingLength).toBe("95.0000");
    expect((await db().select().from(s.fabricDefects)).length).toBe(1);
  });
  it("reconciles signed roll corrections and rejects forged segment balances", async () => {
    const [r] = await setup();
    await act("adjustRoll", { rollId: r.id, delta: "5", reason: "Corrected measurement" });
    await act("adjustRoll", { rollId: r.id, delta: "-2", reason: "Count correction" });
    const [after] = await db().select().from(s.fabricRolls).where(eq(s.fabricRolls.id, r.id));
    expect([after.physicalLength, after.remainingLength]).toEqual(["105.0000", "103.0000"]);
    const [balance] = await db().select().from(s.balances).where(eq(s.balances.materialId, material));
    expect(balance.onHand).toBe("308.0000");
    await expect(db().update(s.fabricRolls).set({ usableSegments: [{ start: "0", end: "1" }] }).where(eq(s.fabricRolls.id, r.id))).rejects.toThrow();
  });
  it("allows explicit excess consumption from unreserved rolls and keeps the extra trace", async () => {
    const rolls = await setup();
    const order = await makeOrder();
    await act("plan", { id: order.id, rollAllocations: [{ materialId: material, rollId: rolls[0].id, quantity: "25" }] });
    const [reservation] = await db().select().from(s.reservations).where(eq(s.reservations.orderId, order.id));
    await complete(order, { consumption: [{ reservationId: reservation.id, quantity: "30" }], rollConsumption: [{ reservationId: reservation.id, rollId: rolls[0].id, quantity: "25" }, { reservationId: reservation.id, rollId: rolls[2].id, quantity: "5" }] });
    const history = await db().select().from(s.fabricRollMovements).where(eq(s.fabricRollMovements.manufacturingOrderId, order.id));
    expect(history.some((event) => event.rollId === rolls[2].id && event.quantity === "-5.0000")).toBe(true);
  });
  it("receives identifiable rolls against a purchase order atomically", async () => {
    await act("activateRollTracking", { materialId: material, rolls: [] });
    await act("purchase", { partyId: supplier, currency: "USD", lines: [{ itemId: material, quantity: "30", price: "1" }] });
    const [po] = await db().select().from(s.purchases); const [line] = await db().select().from(s.purchaseItems);
    await act("orderPurchase", { id: po.id });
    await expect(act("receive", { id: po.id, lines: [{ id: line.id, quantity: "30" }] })).rejects.toThrow("roll");
    await act("receive", { id: po.id, lines: [{ id: line.id, quantity: "30", rolls: [roll("P1", "10"), roll("P2", "20")] }] });
    const rolls = await db().select().from(s.fabricRolls);
    expect(rolls.length).toBe(2);
    expect(rolls.every((r) => r.purchaseOrderItemId === line.id && r.supplierId === supplier)).toBe(true);
    expect((await db().select().from(s.balances).where(eq(s.balances.materialId, material)))[0].onHand).toBe("30.0000");
  });
});
