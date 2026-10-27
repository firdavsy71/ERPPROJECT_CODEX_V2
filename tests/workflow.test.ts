import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import {
  execute,
  lineTotal,
  type BusinessAction,
} from "../src/services/operations";
import { saveMaster } from "../src/services/master";
import { overview } from "../src/services/queries";
import type { Actor } from "../src/lib/permissions";
import { approvedSpec } from "./spec-fixture";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor,
  warehouse: string,
  material: string,
  variant: string,
  customer: string,
  supplier: string,
  bom: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(
    actor,
    action,
    action === "complete"
      ? {
          qualityResults: [
            { check: "Visual finish", result: "Pass", notes: "" },
          ],
          ...(input as Record<string, unknown>),
        }
      : input,
    key,
  );
beforeAll(async () => {
  const client = localClient()!;
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(
    sql`truncate users,warehouses,products,materials,customers,suppliers,bom_versions cascade`,
  );
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Test administrator",
      email: "test@example.com",
      passwordHash: "test-only",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  const [w] = await db()
    .insert(s.warehouses)
    .values({ name: "Main" })
    .returning();
  warehouse = w.id;
  const [m] = await db()
    .insert(s.materials)
    .values({
      name: "Fabric",
      sku: "FAB",
      unit: "Meters",
      price: "10",
      minimum: "5",
    })
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
      color: "Navy",
      price: "100",
    })
    .returning();
  variant = v.id;
  await approvedSpec(actor, p.id, v.id);
  const [c] = await db()
    .insert(s.customers)
    .values({ name: "Customer" })
    .returning();
  customer = c.id;
  const [sp] = await db()
    .insert(s.suppliers)
    .values({ name: "Supplier" })
    .returning();
  supplier = sp.id;
  await act("bom", {
    variantId: variant,
    laborCost: "5",
    items: [{ materialId: material, quantity: "2.5" }],
  });
  [bom] = (await db().select().from(s.boms)).map((b) => b.id);
});
async function stock(quantity = "100") {
  await act("adjust", {
    kind: "material",
    itemId: material,
    delta: quantity,
    reason: "Opening test stock",
  });
}
async function production(quantity = 10) {
  await act("manufacture", { bomId: bom, quantity });
  const [mo] = await db().select().from(s.manufacturing);
  return mo;
}
describe("Critical PostgreSQL workflows", () => {
  it("completes a fully discounted order without requiring an impossible zero payment", async () => {
    await act("adjust", {
      itemId: variant,
      kind: "variant",
      delta: "1",
      reason: "Finished opening balance",
    });
    await act("sale", {
      partyId: customer,
      currency: "UZS",
      lines: [
        { itemId: variant, quantity: "1", price: "100", discount: "100" },
      ],
    });
    const [order] = await db().select().from(s.sales);
    const [line] = await db().select().from(s.saleItems);
    await act("confirmSale", { id: order.id });
    await act("reserveSale", { id: order.id });
    await act("ship", { id: order.id, lines: [{ id: line.id, quantity: 1 }] });
    await act("invoice", { id: order.id, dueDate: "2027-01-01", taxRate: "0" });
    expect((await db().select().from(s.invoices))[0].status).toBe("Paid");
    expect((await db().select().from(s.sales))[0].status).toBe("Completed");
  });
  it("runs sales → purchasing → production → quality → partial shipment → invoice → payment", async () => {
    await act("purchase", {
      partyId: supplier,
      currency: "UZS",
      lines: [{ itemId: material, quantity: "300", price: "10" }],
    });
    const [po] = await db().select().from(s.purchases);
    const [pi] = await db().select().from(s.purchaseItems);
    await act("orderPurchase", { id: po.id });
    const receiptKey = randomUUID();
    const receipt = { id: po.id, lines: [{ id: pi.id, quantity: "150" }] };
    await act("receive", receipt, receiptKey);
    await act("receive", receipt, receiptKey);
    expect((await db().select().from(s.balances))[0].onHand).toBe("150.0000");
    expect((await db().select().from(s.purchases))[0].status).toBe(
      "Partially Received",
    );
    await act("receive", {
      id: po.id,
      lines: [{ id: pi.id, quantity: "150" }],
    });
    await act("sale", {
      partyId: customer,
      currency: "UZS",
      lines: [
        { itemId: variant, quantity: "100", price: "100", discount: "10" },
      ],
    });
    const [so] = await db().select().from(s.sales);
    const [si] = await db().select().from(s.saleItems);
    expect(so.total).toBe("9000.00");
    await act("confirmSale", { id: so.id });
    await act("reserveSale", { id: so.id });
    expect((await db().select().from(s.sales))[0].status).toBe(
      "Awaiting Production",
    );
    await act("manufacture", { bomId: bom, quantity: 100, saleItemId: si.id });
    const [mo] = await db().select().from(s.manufacturing);
    await act("plan", { id: mo.id });
    let [b] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect(b.reserved).toBe("250.0000");
    await act("start", { id: mo.id });
    await act("record", { id: mo.id, completed: 100, defective: 0 });
    const completeKey = randomUUID();
    await act("complete", { id: mo.id, approved: 100 }, completeKey);
    await act("complete", { id: mo.id, approved: 100 }, completeKey);
    await act("complete", { id: mo.id, approved: 100 });
    [b] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect(b.onHand).toBe("50.0000");
    expect(b.reserved).toBe("0.0000");
    await act("reserveSale", { id: so.id });
    expect((await db().select().from(s.sales))[0].status).toBe(
      "Ready for Shipment",
    );
    await act("ship", { id: so.id, lines: [{ id: si.id, quantity: 40 }] });
    expect((await db().select().from(s.sales))[0].status).toBe(
      "Partially Shipped",
    );
    await expect(
      act("ship", { id: so.id, lines: [{ id: si.id, quantity: 61 }] }),
    ).rejects.toThrow("exceeds");
    const shipKey = randomUUID(),
      ship = { id: so.id, lines: [{ id: si.id, quantity: 60 }] };
    await act("ship", ship, shipKey);
    await act("ship", ship, shipKey);
    const [fg] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.variantId, variant));
    expect(fg.onHand).toBe("0.0000");
    expect(fg.reserved).toBe("0.0000");
    await act("invoice", { id: so.id, dueDate: "2027-01-01", taxRate: "12" });
    const [inv] = await db().select().from(s.invoices);
    expect(inv.total).toBe("10080.00");
    const paymentKey = randomUUID(),
      payment = { id: inv.id, amount: "5000", reference: "BANK-1" };
    await act("pay", payment, paymentKey);
    await act("pay", payment, paymentKey);
    expect((await db().select().from(s.invoices))[0].status).toBe(
      "Partially Paid",
    );
    await expect(
      act("pay", { id: inv.id, amount: "5081", reference: "OVERPAY" }),
    ).rejects.toThrow("exceeds");
    await act("pay", { id: inv.id, amount: "5080", reference: "BANK-2" });
    expect((await db().select().from(s.invoices))[0].status).toBe("Paid");
    expect((await db().select().from(s.sales))[0].status).toBe("Completed");
    expect(await db().select().from(s.payments)).toHaveLength(2);
    const metrics = await overview();
    expect(Number(metrics.kpis.completed)).toBe(1);
    expect(Number(metrics.kpis.pending)).toBe(0);
    expect(metrics.revenue[0]).toMatchObject({
      currency: "UZS",
      total: "10080.00",
      outstanding: "0.00",
    });
    expect(metrics.trends[0].revenue).toBe("10080.00");
  });
  it("calculates decimal amounts and discounts without binary floating point", () => {
    expect(lineTotal("3", "0.10", "10")).toBe("0.27");
    expect(lineTotal("100", "185000", "5")).toBe("17575000.00");
  });
  it("rejects a shortage and rolls the transaction back", async () => {
    await stock("10");
    const mo = await production();
    await expect(act("plan", { id: mo.id })).rejects.toThrow("Insufficient");
    expect((await db().select().from(s.manufacturing))[0].status).toBe("Draft");
    expect(await db().select().from(s.reservations)).toHaveLength(0);
    expect((await db().select().from(s.balances))[0].reserved).toBe("0.0000");
  });
  it("releases all reserved materials on cancellation", async () => {
    await stock();
    const mo = await production();
    await act("plan", { id: mo.id });
    await act("cancelProduction", { id: mo.id });
    const [b] = await db().select().from(s.balances);
    expect(b.reserved).toBe("0.0000");
    expect(b.onHand).toBe("100.0000");
  });
  it("accounts for actual consumption and rejected units", async () => {
    await stock();
    const mo = await production();
    await act("plan", { id: mo.id });
    await act("start", { id: mo.id });
    await act("record", { id: mo.id, completed: 9, defective: 1 });
    const [r] = await db().select().from(s.reservations);
    await act("complete", {
      id: mo.id,
      approved: 8,
      consumption: [{ reservationId: r.id, quantity: "24" }],
    });
    const [b] = await db()
      .select()
      .from(s.balances)
      .where(eq(s.balances.materialId, material));
    expect(b.onHand).toBe("76.0000");
    expect(b.reserved).toBe("0.0000");
    expect((await db().select().from(s.inspections))[0].rejected).toBe(2);
  });
  it("prevents duplicate adjustments and rejects reused keys with changed data", async () => {
    const key = randomUUID(),
      v = {
        kind: "material",
        itemId: material,
        delta: "20",
        reason: "Test opening stock",
      };
    await act("adjust", v, key);
    await act("adjust", v, key);
    expect((await db().select().from(s.balances))[0].onHand).toBe("20.0000");
    await expect(act("adjust", { ...v, delta: "30" }, key)).rejects.toThrow(
      "already used",
    );
  });
  it("enforces server-side role permissions", async () => {
    await expect(
      execute(
        { ...actor, role: "viewer" },
        "adjust",
        {
          itemId: material,
          kind: "material",
          delta: "10",
          reason: "Unauthorized",
        },
        randomUUID(),
      ),
    ).rejects.toThrow("permission");
    await expect(
      saveMaster({ ...actor, role: "sales" }, "materials", {
        name: "Forbidden",
      }),
    ).rejects.toThrow("permission");
  });
  it("does not allow negative stock", async () => {
    await stock("1");
    await expect(
      act("adjust", {
        kind: "material",
        itemId: material,
        delta: "-2",
        reason: "Too much deduction",
      }),
    ).rejects.toThrow("Insufficient");
  });
  it("enforces database constraints and foreign keys", async () => {
    await expect(
      db()
        .insert(s.balances)
        .values({ warehouseId: warehouse, materialId: material, onHand: "-1" }),
    ).rejects.toThrow();
    await expect(
      db().insert(s.variants).values({
        productId: randomUUID(),
        sku: "BAD",
        size: "L",
        color: "Black",
      }),
    ).rejects.toThrow();
  });
  it("keeps historical BOM versions immutable", async () => {
    await act("bom", {
      variantId: variant,
      laborCost: "7",
      items: [{ materialId: material, quantity: "3" }],
    });
    expect(await db().select().from(s.boms)).toHaveLength(2);
    expect(
      (await db().select().from(s.bomItems).where(eq(s.bomItems.bomId, bom)))[0]
        .quantity,
    ).toBe("2.5000");
  });
  it("accepts multi-variant orders and calculates each discounted line", async () => {
    const [p] = await db().select().from(s.products);
    const [v2] = await db()
      .insert(s.variants)
      .values({
        productId: p.id,
        sku: "JKT-M",
        size: "M",
        color: "Navy",
        price: "120",
      })
      .returning();
    await act("sale", {
      partyId: customer,
      currency: "USD",
      lines: [
        { itemId: variant, quantity: "2", price: "100", discount: "10" },
        { itemId: v2.id, quantity: "3", price: "120", discount: "0" },
      ],
    });
    expect(await db().select().from(s.saleItems)).toHaveLength(2);
    expect((await db().select().from(s.sales))[0].total).toBe("540.00");
  });
  it("rolls back an entire multi-line receipt if one line exceeds the order", async () => {
    await act("purchase", {
      partyId: supplier,
      currency: "UZS",
      lines: [{ itemId: material, quantity: "10", price: "10" }],
    });
    const [po] = await db().select().from(s.purchases);
    const [pi] = await db().select().from(s.purchaseItems);
    await act("orderPurchase", { id: po.id });
    await expect(
      act("receive", {
        id: po.id,
        lines: [
          { id: pi.id, quantity: "5" },
          { id: pi.id, quantity: "6" },
        ],
      }),
    ).rejects.toThrow("exceeds");
    expect(await db().select().from(s.receipts)).toHaveLength(0);
    expect(await db().select().from(s.movements)).toHaveLength(0);
  });
});
