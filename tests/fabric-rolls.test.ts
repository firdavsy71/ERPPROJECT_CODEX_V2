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
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(actor, action, input, key);
const roll = (
  rollNumber: string,
  receivedLength: string,
  supplierBatch = "BATCH-A",
) => ({
  rollNumber,
  receivedLength,
  supplierBatch,
  supplierLot: "LOT-1",
  color: "Hi-vis lime",
  composition: "65% polyester / 35% cotton",
  widthCm: "150",
  storageLocation: "Rack A",
});
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(
    sql`truncate users,warehouses,products,materials,suppliers cascade`,
  );
  const [user] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: user.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  const [m] = await db()
    .insert(s.materials)
    .values({ name: "Hi-vis fabric", sku: "FAB", unit: "Meters" })
    .returning();
  material = m.id;
  const [sp] = await db()
    .insert(s.suppliers)
    .values({ name: "Fabric supplier" })
    .returning();
  supplier = sp.id;
  const [product] = await db()
    .insert(s.products)
    .values({ name: "Jacket", sku: "JKT" })
    .returning();
  const [variant] = await db()
    .insert(s.variants)
    .values({ productId: product.id, sku: "JKT-L", size: "L", color: "Lime" })
    .returning();
  await approvedSpec(actor, product.id, variant.id);
  await act("bom", {
    variantId: variant.id,
    laborCost: "0",
    items: [{ materialId: material, quantity: "2.5" }],
  });
  [bom] = (await db().select().from(s.boms)).map((x) => x.id);
});
async function setup() {
  await act("adjust", {
    itemId: material,
    kind: "material",
    delta: "305",
    reason: "Opening stock",
  });
  await act("activateRollTracking", {
    materialId: material,
    rolls: [
      roll("001", "100"),
      roll("002", "85", "BATCH-B"),
      roll("003", "120"),
    ],
  });
  return db().select().from(s.fabricRolls).orderBy(s.fabricRolls.rollNumber);
}
async function makeOrder(quantity = 10) {
  await act("manufacture", { bomId: bom, quantity });
  const orders = await db().select().from(s.manufacturing);
  return orders[orders.length - 1];
}
async function complete(
  order: typeof s.manufacturing.$inferSelect,
  input: Record<string, unknown> = {},
) {
  await act("start", { id: order.id });
  await act("record", {
    id: order.id,
    completed: order.quantity,
    defective: 0,
  });
  await act("complete", {
    id: order.id,
    approved: order.quantity,
    qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }],
    ...input,
  });
}
describe("fabric roll inventory and traceability", () => {
  it("supports subcontractor and draft order maintenance with permissions and immutable activated terms", async () => {
    await setup();
    const mo = await makeOrder();
    await expect(
      execute(
        { ...actor, role: "viewer" },
        "saveSubcontractor",
        { supplierId: supplier, specialties: "Sewing", capacity: 100 },
        randomUUID(),
      ),
    ).rejects.toThrow("permission");
    await act("saveSubcontractor", {
      supplierId: supplier,
      specialties: "Sewing",
      capacity: 100,
    });
    const [p] = await db().select().from(s.subcontractors);
    await act("saveSubcontractor", {
      id: p.id,
      supplierId: supplier,
      specialties: "Jackets",
      capacity: 200,
      active: "false",
    });
    const terms = {
      manufacturingOrderId: mo.id,
      subcontractorId: p.id,
      dueDate: "2027-01-01",
      currency: "USD",
      unitCost: "5",
    };
    await expect(act("createOutsourcing", terms)).rejects.toThrow("active");
    await act("saveSubcontractor", {
      id: p.id,
      supplierId: supplier,
      specialties: "Jackets",
      capacity: 200,
      active: "true",
    });
    await act("createOutsourcing", terms);
    const [o] = await db().select().from(s.outsourcingOrders);
    await act("editOutsourcing", { ...terms, id: o.id, unitCost: "6" });
    expect((await db().select().from(s.outsourcingOrders))[0].unitCost).toBe(
      "6.00",
    );
    await act("cancelOutsourcing", { id: o.id });
    expect((await db().select().from(s.manufacturing))[0].status).toBe("Draft");
    await act("createOutsourcing", terms);
    const active = (await db().select().from(s.outsourcingOrders)).find(
      (v) => v.status === "Draft",
    )!;
    await act("activateOutsourcing", { id: active.id });
    await expect(
      act("editOutsourcing", { ...terms, id: active.id, unitCost: "7" }),
    ).rejects.toThrow();
    await expect(act("cancelOutsourcing", { id: active.id })).rejects.toThrow(
      "draft",
    );
  });
  it("tracks outsourcing custody separately from consumption and accepts partial inspected deliveries once", async () => {
    const rolls = await setup();
    const mo = await makeOrder();
    await act("saveSubcontractor", {
      supplierId: supplier,
      specialties: "Industrial sewing",
      capacity: 500,
      active: "true",
    });
    const [profile] = await db().select().from(s.subcontractors);
    await act("createOutsourcing", {
      manufacturingOrderId: mo.id,
      subcontractorId: profile.id,
      dueDate: "2027-01-01",
      currency: "USD",
      unitCost: "5",
    });
    const [o] = await db().select().from(s.outsourcingOrders);
    await expect(act("plan", { id: mo.id })).rejects.toThrow("Outsourcing");
    await act("activateOutsourcing", { id: o.id });
    const [r] = await db()
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, mo.id));
    const allocation = (
      await db()
        .select()
        .from(s.fabricRollReservations)
        .where(eq(s.fabricRollReservations.materialReservationId, r.id))
    )[0];
    const issue = {
      id: o.id,
      reservationId: r.id,
      rollId: allocation.rollId,
      quantity: "15",
      reference: "ISSUE-1",
    };
    const key = randomUUID();
    await act("issueOutsourcingMaterial", issue, key);
    await act("issueOutsourcingMaterial", issue, key);
    const [line] = await db().select().from(s.outsourcingCustody);
    expect([line.quantity, line.consumed, line.returned]).toEqual([
      "15.0000",
      "0.0000",
      "0.0000",
    ]);
    expect((await db().select().from(s.reservations))[0].consumed).toBe(
      "0.0000",
    );
    await expect(act("issueOutsourcingMaterial", issue)).rejects.toThrow();
    await expect(
      act("settleOutsourcingMaterial", {
        id: o.id,
        custodyId: line.id,
        kind: "Consumed",
        quantity: "16",
        reference: "OVER",
      }),
    ).rejects.toThrow("outstanding");
    await act("settleOutsourcingMaterial", {
      id: o.id,
      custodyId: line.id,
      kind: "Consumed",
      quantity: "12",
      reference: "USE-1",
    });
    await act("settleOutsourcingMaterial", {
      id: o.id,
      custodyId: line.id,
      kind: "Returned",
      quantity: "3",
      reference: "RETURN-1",
    });
    expect((await db().select().from(s.fabricRolls)).length).toBe(
      rolls.length + 1,
    );
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.materialId, material))
      )[0].onHand,
    ).toBe("293.0000");
    await expect(
      act("outsourcingProgress", { id: o.id, produced: 11 }),
    ).rejects.toThrow("assigned");
    await act("outsourcingProgress", { id: o.id, produced: 10 });
    const receipt = {
      id: o.id,
      reference: "DELIVERY-1",
      accepted: 4,
      rejected: 1,
      quality__0: "Pass",
      notes: "One defective sleeve",
    };
    const rk = randomUUID();
    await act("receiveOutsourcing", receipt, rk);
    await act("receiveOutsourcing", receipt, rk);
    await expect(act("receiveOutsourcing", receipt)).rejects.toThrow();
    await expect(
      act("receiveOutsourcing", {
        ...receipt,
        reference: "OVER",
        accepted: 6,
        rejected: 0,
      }),
    ).rejects.toThrow("exceeds");
    await expect(
      act("receiveOutsourcing", {
        ...receipt,
        reference: "FAIL",
        accepted: 1,
        rejected: 0,
        quality__0: "Fail",
      }),
    ).rejects.toThrow("checks");
    await expect(act("closeOutsourcing", { id: o.id })).rejects.toThrow(
      "every assigned",
    );
    await act("receiveOutsourcing", {
      ...receipt,
      reference: "DELIVERY-2",
      accepted: 5,
      rejected: 0,
      notes: "All checks passed",
    });
    await act("recordOutsourcingCost", {
      id: o.id,
      reference: "INV-1",
      amount: "50",
      notes: "Sewing invoice",
    });
    await act("closeOutsourcing", { id: o.id });
    expect((await db().select().from(s.manufacturing))[0].completed).toBe(9);
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.materialId, material))
      )[0].reserved,
    ).toBe("0.0000");
    expect((await db().select().from(s.reservations))[0].consumed).toBe(
      "12.0000",
    );
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, mo.variantId))
      )[0].onHand,
    ).toBe("9.0000");
    expect((await db().select().from(s.outsourcingReceipts)).length).toBe(2);
  });
  it("fixes cutting actuals and posts them only once at manufacturing QC", async () => {
    const rolls = await setup();
    const order = await makeOrder();
    await act("plan", {
      id: order.id,
      rollAllocations: [
        { materialId: material, rollId: rolls[0].id, quantity: "25" },
      ],
    });
    const [r] = await db()
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, order.id));
    await act("createCutting", {
      reservationId: r.id,
      rollId: rolls[0].id,
      quantity: 10,
      rateSource: "BOM",
      layout: "Marker JKT-L, ten layers; follow approved pattern",
    });
    const [batch] = await db().select().from(s.cuttingBatches);
    expect(batch.planned).toBe("25.0000");
    await expect(
      act("createCutting", {
        reservationId: r.id,
        rollId: rolls[1].id,
        quantity: 1,
        rateSource: "BOM",
        layout: "Invalid unallocated roll",
      }),
    ).rejects.toThrow("reserved");
    await expect(complete(order)).rejects.toThrow("cutting batch");
    const input = {
      id: batch.id,
      issued: "25",
      incorporated: "22",
      waste: "2",
      returned: "1",
      piecesCut: 10,
      rejectedPieces: 1,
      cutPieces: [{ part: "Sleeve", quantity: 20, rejected: 2 }],
    };
    const key = randomUUID();
    await act("completeCutting", input, key);
    await act("completeCutting", input, key);
    expect(
      (
        await db()
          .select()
          .from(s.fabricRolls)
          .where(eq(s.fabricRolls.id, rolls[0].id))
      )[0].remainingLength,
    ).toBe("100.0000");
    await expect(
      db()
        .update(s.cuttingBatches)
        .set({ layout: "Changed instructions" })
        .where(eq(s.cuttingBatches.id, batch.id)),
    ).rejects.toThrow();
    await act("complete", {
      id: order.id,
      approved: 9,
      qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }],
    });
    expect(
      (
        await db()
          .select()
          .from(s.fabricRolls)
          .where(eq(s.fabricRolls.id, rolls[0].id))
      )[0].remainingLength,
    ).toBe("76.0000");
    expect(
      (await db().select().from(s.cuttingBatches))[0].result?.efficiencyPercent,
    ).toBe("91.67");
  });
  it("adopts existing stock without doubling it, and prevents generic adjustments and bypasses", async () => {
    const rolls = await setup();
    const [balance] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect(balance.onHand).toBe("305.0000");
    expect(rolls.map((r) => r.remainingLength)).toEqual([
      "100.0000",
      "85.0000",
      "120.0000",
    ]);
    await expect(
      act("adjust", {
        itemId: material,
        kind: "material",
        delta: "1",
        reason: "Wrong adjustment",
      }),
    ).rejects.toThrow("roll tracking");
    await expect(
      db()
        .update(s.balances)
        .set({ onHand: "999" })
        .where(eq(s.balances.id, balance.id)),
    ).rejects.toThrow();
    await expect(
      db()
        .update(s.materials)
        .set({ unit: "Pieces" })
        .where(eq(s.materials.id, material)),
    ).rejects.toThrow();
  });
  it("records partial consumption from chosen batches and releases the unused reservation", async () => {
    const rolls = await setup();
    const order = await makeOrder();
    await act("plan", {
      id: order.id,
      rollAllocations: [
        { materialId: material, rollId: rolls[0].id, quantity: "10" },
        { materialId: material, rollId: rolls[1].id, quantity: "15" },
      ],
    });
    const [reservation] = await db()
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, order.id));
    await complete(order, {
      consumption: [{ reservationId: reservation.id, quantity: "12" }],
      rollConsumption: [
        { reservationId: reservation.id, rollId: rolls[0].id, quantity: "4" },
        { reservationId: reservation.id, rollId: rolls[1].id, quantity: "8" },
      ],
    });
    const after = await db()
      .select()
      .from(s.fabricRolls)
      .orderBy(s.fabricRolls.rollNumber);
    expect(after.map((r) => [r.remainingLength, r.reservedLength])).toEqual([
      ["96.0000", "0.0000"],
      ["77.0000", "0.0000"],
      ["120.0000", "0.0000"],
    ]);
    const events = await db()
      .select()
      .from(s.fabricRollMovements)
      .where(eq(s.fabricRollMovements.manufacturingOrderId, order.id));
    expect(
      events
        .filter((e) => e.reason === "consume")
        .map((e) => e.quantity)
        .sort(),
    ).toEqual(["-4.0000", "-8.0000"]);
    const [balance] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect([balance.onHand, balance.reserved]).toEqual(["293.0000", "0.0000"]);
  });
  it("does not consume another order's reserved roll and rolls back failed completion", async () => {
    const rolls = await setup();
    const first = await makeOrder();
    await act("plan", {
      id: first.id,
      rollAllocations: [
        { materialId: material, rollId: rolls[0].id, quantity: "25" },
      ],
    });
    const second = await makeOrder();
    await act("plan", {
      id: second.id,
      rollAllocations: [
        { materialId: material, rollId: rolls[1].id, quantity: "25" },
      ],
    });
    const [res] = await db()
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, first.id));
    await act("start", { id: first.id });
    await act("record", { id: first.id, completed: 10, defective: 0 });
    await expect(
      act("complete", {
        id: first.id,
        approved: 10,
        qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }],
        consumption: [{ reservationId: res.id, quantity: "61" }],
        rollConsumption: [
          { reservationId: res.id, rollId: rolls[1].id, quantity: "61" },
        ],
      }),
    ).rejects.toThrow("available");
    expect(
      (
        await db()
          .select()
          .from(s.fabricRolls)
          .where(eq(s.fabricRolls.id, rolls[1].id))
      )[0].reservedLength,
    ).toBe("25.0000");
    await act("cancelProduction", { id: second.id });
    expect(
      (
        await db()
          .select()
          .from(s.fabricRolls)
          .where(eq(s.fabricRolls.id, rolls[1].id))
      )[0].reservedLength,
    ).toBe("0.0000");
  });
  it("records damage once, keeps physical coordinates and honors idempotent operations", async () => {
    const rolls = await setup();
    const key = randomUUID(),
      input = {
        rollId: rolls[0].id,
        start: "10",
        end: "15",
        reason: "Damaged fabric",
      };
    await act("damageRoll", input, key);
    await act("damageRoll", input, key);
    await expect(act("damageRoll", input)).rejects.toThrow("usable fabric");
    const [r] = await db()
      .select()
      .from(s.fabricRolls)
      .where(eq(s.fabricRolls.id, rolls[0].id));
    expect(r.remainingLength).toBe("95.0000");
    expect((await db().select().from(s.fabricDefects)).length).toBe(1);
  });
  it("reconciles signed roll corrections and rejects forged segment balances", async () => {
    const [r] = await setup();
    await act("adjustRoll", {
      rollId: r.id,
      delta: "5",
      reason: "Corrected measurement",
    });
    await act("adjustRoll", {
      rollId: r.id,
      delta: "-2",
      reason: "Count correction",
    });
    const [after] = await db()
      .select()
      .from(s.fabricRolls)
      .where(eq(s.fabricRolls.id, r.id));
    expect([after.physicalLength, after.remainingLength]).toEqual([
      "105.0000",
      "103.0000",
    ]);
    const [balance] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect(balance.onHand).toBe("308.0000");
    await expect(
      db()
        .update(s.fabricRolls)
        .set({ usableSegments: [{ start: "0", end: "1" }] })
        .where(eq(s.fabricRolls.id, r.id)),
    ).rejects.toThrow();
  });
  it("allows explicit excess consumption from unreserved rolls and keeps the extra trace", async () => {
    const rolls = await setup();
    const order = await makeOrder();
    await act("plan", {
      id: order.id,
      rollAllocations: [
        { materialId: material, rollId: rolls[0].id, quantity: "25" },
      ],
    });
    const [reservation] = await db()
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, order.id));
    await complete(order, {
      consumption: [{ reservationId: reservation.id, quantity: "30" }],
      rollConsumption: [
        { reservationId: reservation.id, rollId: rolls[0].id, quantity: "25" },
        { reservationId: reservation.id, rollId: rolls[2].id, quantity: "5" },
      ],
    });
    const history = await db()
      .select()
      .from(s.fabricRollMovements)
      .where(eq(s.fabricRollMovements.manufacturingOrderId, order.id));
    expect(
      history.some(
        (event) => event.rollId === rolls[2].id && event.quantity === "-5.0000",
      ),
    ).toBe(true);
  });
  it("receives identifiable rolls against a purchase order atomically", async () => {
    await act("activateRollTracking", { materialId: material, rolls: [] });
    await act("purchase", {
      partyId: supplier,
      currency: "USD",
      lines: [{ itemId: material, quantity: "30", price: "1" }],
    });
    const [po] = await db().select().from(s.purchases);
    const [line] = await db().select().from(s.purchaseItems);
    await act("orderPurchase", { id: po.id });
    await expect(
      act("receive", { id: po.id, lines: [{ id: line.id, quantity: "30" }] }),
    ).rejects.toThrow("roll");
    await act("receive", {
      id: po.id,
      lines: [
        {
          id: line.id,
          quantity: "30",
          rolls: [roll("P1", "10"), roll("P2", "20")],
        },
      ],
    });
    const rolls = await db().select().from(s.fabricRolls);
    expect(rolls.length).toBe(2);
    expect(
      rolls.every(
        (r) => r.purchaseOrderItemId === line.id && r.supplierId === supplier,
      ),
    ).toBe(true);
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.materialId, material))
      )[0].onHand,
    ).toBe("30.0000");
  });
});
