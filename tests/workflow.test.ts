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
import { pricingDay } from "../src/services/pricing";
import { checkConsistency } from "../src/services/consistency";
import { canExportReport, canReadModule } from "../src/lib/permissions";
import {
  uploadDeliveryProof,
  readDeliveryProof,
} from "../src/services/delivery-proof";
import type { BrandingStorage } from "../src/services/branding-storage";
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
  it("connects customer demand to shortage, purchasing, production QC, managed shipment and paid invoice with reconciled ledgers", async () => {
    await act("sale", {
      partyId: customer,
      currency: "UZS",
      lines: [{ itemId: variant, quantity: "10", price: "100", discount: "0" }],
    });
    const [so] = await db().select().from(s.sales);
    const [si] = await db().select().from(s.saleItems);
    await act("manufacture", { bomId: bom, quantity: 10, saleItemId: si.id });
    const [mo] = await db().select().from(s.manufacturing);
    await expect(act("plan", { id: mo.id })).rejects.toThrow("Confirm");
    await act("confirmSale", { id: so.id });
    await act("reserveSale", { id: so.id });
    const failedKey = randomUUID();
    await expect(act("plan", { id: mo.id }, failedKey)).rejects.toThrow(
      "Insufficient",
    );
    expect(await db().select().from(s.reservations)).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(s.operations)
        .where(eq(s.operations.key, failedKey)),
    ).toHaveLength(0);
    await act("purchase", {
      partyId: supplier,
      currency: "UZS",
      date: "2099-01-01",
      lines: [{ itemId: material, quantity: "25", price: "10" }],
    });
    const [po] = await db().select().from(s.purchases);
    const [pi] = await db().select().from(s.purchaseItems);
    await act("orderPurchase", { id: po.id });
    const receive = { id: po.id, lines: [{ id: pi.id, quantity: "25" }] },
      receiveKey = randomUUID();
    await execute(
      { ...actor, role: "inventory" },
      "receive",
      receive,
      receiveKey,
    );
    await execute(
      { ...actor, role: "inventory" },
      "receive",
      receive,
      receiveKey,
    );
    const [receiptLine] = await db().select().from(s.purchaseReceiptItems);
    await act("inspectProcurement", {
      receiptItemId: receiptLine.id,
      accepted: "25",
      rejected: "0",
      notes: "Incoming fabric passed",
    });
    await act("plan", { id: mo.id });
    await act("start", { id: mo.id });
    expect(
      await db()
        .select()
        .from(s.balances)
        .where(eq(s.balances.variantId, variant)),
    ).toHaveLength(1);
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, variant))
      )[0].onHand,
    ).toBe("0.0000");
    await act("record", { id: mo.id, completed: 10, defective: 0 });
    await act("complete", { id: mo.id, approved: 10 });
    await act("reserveSale", { id: so.id });
    await act("createDelivery", {
      orderId: so.id,
      address: "Customer receiving gate",
      carrier: "Carrier",
      lines: [{ saleItemId: si.id, quantity: 10 }],
    });
    const [delivery] = await db().select().from(s.deliveryOrders);
    const [dl] = await db().select().from(s.deliveryItems);
    await act("recordDeliveryPacking", {
      id: delivery.id,
      lineId: dl.id,
      picked: 10,
      packed: 10,
      notes: "Counted and packed",
    });
    const dispatchKey = randomUUID();
    await act("dispatchDelivery", { id: delivery.id }, dispatchKey);
    await act("dispatchDelivery", { id: delivery.id }, dispatchKey);
    expect(Number((await overview()).kpis.pending)).toBe(0);
    await act("updateDeliveryStatus", {
      id: delivery.id,
      status: "Delivered",
      notes: "Recipient confirmed delivery",
    });
    await act("invoice", { id: so.id, dueDate: "2099-01-01", taxRate: "12" });
    const [invoice] = await db().select().from(s.invoices);
    expect(invoice.total).toBe("1120.00");
    await act("pay", {
      id: invoice.id,
      amount: "1120",
      reference: "INTEGRATION-BANK",
    });
    expect((await db().select().from(s.sales))[0].status).toBe("Completed");
    expect((await overview()).revenue[0].outstanding).toBe("0.00");
    expect(await checkConsistency()).toEqual(
      expect.arrayContaining([{ check: "stock_ledger", violations: 0 }]),
    );
    expect((await checkConsistency()).filter((c) => c.violations > 0)).toEqual(
      [],
    );
  });
  it("counts low stock once per material and protects financial module/report reads", async () => {
    await stock("3");
    const [other] = await db()
      .insert(s.warehouses)
      .values({ name: "Second" })
      .returning();
    await db()
      .insert(s.balances)
      .values({ warehouseId: other.id, materialId: material, onHand: "3" });
    expect(Number((await overview()).kpis.low)).toBe(0);
    expect(canExportReport("viewer", "invoices")).toBe(false);
    expect(canExportReport("production", "invoices")).toBe(false);
    expect(canExportReport("inventory", "movements")).toBe(true);
    expect(canReadModule("production", "invoices")).toBe(false);
    expect(canReadModule("inventory", "settings")).toBe(false);
    expect(canReadModule("sales", "invoices")).toBe(true);
    await expect(
      db()
        .update(s.materials)
        .set({ unit: "Pieces" })
        .where(eq(s.materials.id, material)),
    ).rejects.toThrow();
    await expect(
      db()
        .update(s.variants)
        .set({ size: "XL" })
        .where(eq(s.variants.id, variant)),
    ).rejects.toThrow();
    expect(
      (await checkConsistency()).find((c) => c.check === "stock_ledger")
        ?.violations,
    ).toBe(1);
  });
  it("requires an explicit operational warehouse when multiple warehouses exist", async () => {
    const [second] = await db()
      .insert(s.warehouses)
      .values({ name: "Second" })
      .returning();
    await expect(stock("5")).rejects.toThrow("primary operational warehouse");
    await db()
      .insert(s.settings)
      .values({ id: 1, name: "Company", primaryWarehouseId: warehouse })
      .onConflictDoUpdate({
        target: s.settings.id,
        set: { primaryWarehouseId: warehouse },
      });
    await stock("25");
    expect((await db().select().from(s.balances))[0].warehouseId).toBe(
      warehouse,
    );
    const mo = await production(10);
    await act("plan", { id: mo.id });
    await expect(saveMaster(actor,"settings",{name:"Company",currency:"UZS",timezone:"Asia/Tashkent",taxRate:"0",primaryWarehouseId:second.id})).rejects.toThrow("Release outstanding reservations");
    await expect(
      db()
        .update(s.settings)
        .set({ primaryWarehouseId: second.id })
        .where(eq(s.settings.id, 1)),
    ).rejects.toThrow();
  });
  it("picks and packs reserved goods, dispatches partial orders once, and never restores dispatched stock on cancellation", async () => {
    await act("adjust", {
      itemId: variant,
      kind: "variant",
      delta: "10",
      reason: "Finished opening stock",
    });
    await act("sale", {
      partyId: customer,
      currency: "UZS",
      lines: [{ itemId: variant, quantity: "10", price: "100", discount: "0" }],
    });
    const [o] = await db().select().from(s.sales);
    const [line] = await db().select().from(s.saleItems);
    await act("confirmSale", { id: o.id });
    await act("reserveSale", { id: o.id });
    const request = {
      orderId: o.id,
      address: "Customer warehouse, main receiving gate",
      carrier: "Carrier A",
      vehicle: "TRUCK-1",
      driver: "Driver A",
      lines: [{ saleItemId: line.id, quantity: 6 }],
    };
    await act("createDelivery", request);
    const [d] = await db().select().from(s.deliveryOrders);
    const [item] = await db().select().from(s.deliveryItems);
    await expect(
      act("createDelivery", {
        ...request,
        lines: [{ saleItemId: line.id, quantity: 5 }],
      }),
    ).rejects.toThrow("uncommitted");
    await expect(
      act("ship", { id: o.id, lines: [{ id: line.id, quantity: 5 }] }),
    ).rejects.toThrow("picking list");
    await expect(act("dispatchDelivery", { id: d.id })).rejects.toThrow(
      "packed",
    );
    await expect(
      act("recordDeliveryPacking", {
        id: d.id,
        lineId: item.id,
        picked: 7,
        packed: 7,
        notes: "Counted",
      }),
    ).rejects.toThrow("planned");
    await act("recordDeliveryPacking", {
      id: d.id,
      lineId: item.id,
      picked: 6,
      packed: 6,
      notes: "Six garments checked and packed",
    });
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, variant))
      )[0].onHand,
    ).toBe("10.0000");
    const key = randomUUID();
    await act("dispatchDelivery", { id: d.id }, key);
    await act("dispatchDelivery", { id: d.id }, key);
    await act("dispatchDelivery", { id: d.id });
    expect((await db().select().from(s.shipments)).length).toBe(1);
    expect((await db().select().from(s.sales))[0].status).toBe(
      "Partially Shipped",
    );
    await expect(
      act("cancelDelivery", {
        id: d.id,
        notes: "Attempted cancellation after departure",
      }),
    ).rejects.toThrow("already left");
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, variant))
      )[0].onHand,
    ).toBe("4.0000");
    await act("updateDeliveryStatus", {
      id: d.id,
      status: "In Transit",
      tracking: "TRACK-1",
      notes: "Carrier collected six units",
    });
    const objects = new Map<string, Buffer>();
    const store: BrandingStorage = {
      put: async (p, b) => {
        objects.set(p, Buffer.from(b));
      },
      read: async (p) => Buffer.from(objects.get(p)!),
      remove: async (p) => {
        objects.delete(p);
      },
    };
    const proof = {
      name: "signed-pod.png",
      mime: "image/png",
      data: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrZkAAAAASUVORK5CYII=",
        "base64",
      ),
    };
    const fileId = await uploadDeliveryProof(
      actor,
      d.id,
      proof,
      "Signed by receiving manager",
      store,
    );
    expect(
      (
        await readDeliveryProof(
          { ...actor, role: "sales" },
          d.id,
          fileId,
          store,
        )
      ).bytes.equals(proof.data),
    ).toBe(true);
    await expect(
      uploadDeliveryProof(actor, d.id, proof, "Duplicate proof", store),
    ).rejects.toThrow("already attached");
    expect(objects.size).toBe(1);
    await expect(
      readDeliveryProof({ ...actor, role: "viewer" }, d.id, fileId, store),
    ).rejects.toThrow("permission");
    await expect(
      readDeliveryProof(actor, randomUUID(), fileId, store),
    ).rejects.toThrow("File not found");
    const pathname = Array.from(objects.keys())[0];
    objects.set(pathname, Buffer.from("tampered"));
    await expect(readDeliveryProof(actor, d.id, fileId, store)).rejects.toThrow(
      "integrity",
    );
    await act("updateDeliveryStatus", {
      id: d.id,
      status: "Delivered",
      notes: "Receiving manager confirmed six garments",
    });
    await act("createDelivery", {
      ...request,
      lines: [{ saleItemId: line.id, quantity: 4 }],
    });
    const cancelled = (await db().select().from(s.deliveryOrders)).find(
      (v) => v.status === "Picking",
    )!;
    await act("cancelDelivery", {
      id: cancelled.id,
      notes: "Reissue packing document",
    });
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, variant))
      )[0].reserved,
    ).toBe("4.0000");
    await act("createDelivery", {
      ...request,
      lines: [{ saleItemId: line.id, quantity: 4 }],
    });
    const final = (await db().select().from(s.deliveryOrders)).find(
      (v) => v.status === "Picking",
    )!;
    const [finalItem] = await db()
      .select()
      .from(s.deliveryItems)
      .where(eq(s.deliveryItems.deliveryId, final.id));
    await act("recordDeliveryPacking", {
      id: final.id,
      lineId: finalItem.id,
      picked: 4,
      packed: 4,
      notes: "Final four packed",
    });
    await act("dispatchDelivery", { id: final.id });
    expect((await db().select().from(s.sales))[0].status).toBe("Shipped");
    expect(
      (
        await db()
          .select()
          .from(s.balances)
          .where(eq(s.balances.variantId, variant))
      )[0].onHand,
    ).toBe("0.0000");
    await act("invoice", { id: o.id, dueDate: "2099-01-01", taxRate: "0" });
    expect((await db().select().from(s.invoices))[0].total).toBe("1000.00");
  });
  it("can replace a future price version withdrawn before its start date", async () => {
    const rule = {
      name: "Future standard",
      kind: "Standard",
      variantId: variant,
      currency: "UZS",
      startDate: "2098-01-01",
      endDate: "2099-12-31",
      minimum: 1,
      tiers: [{ minQty: 1, mode: "Price", value: "100" }],
    };
    await act("savePricingRule", rule);
    const [old] = await db().select().from(s.pricingRules);
    await act("approvePricingRule", { id: old.id });
    await act("retirePricingRule", {
      id: old.id,
      effectiveDate: pricingDay(),
      reason: "Withdraw future release",
    });
    await act("savePricingRule", {
      ...rule,
      name: "Current replacement",
      startDate: "2020-01-01",
    });
    const replacement = (await db().select().from(s.pricingRules)).find(
      (r) => r.status === "Draft",
    )!;
    await act("approvePricingRule", { id: replacement.id });
    expect(
      (await db().select().from(s.pricingRules)).filter(
        (r) => r.status === "Approved",
      ).length,
    ).toBe(2);
  });
  it("requires administrator authorization for manual pricing exceptions and records catalog price changes", async () => {
    await act("sale", {
      partyId: customer,
      currency: "UZS",
      lines: [{ itemId: variant, quantity: "2", price: "1", discount: "0" }],
    });
    const [o] = await db().select().from(s.sales);
    await expect(
      execute(
        { ...actor, role: "sales" },
        "confirmSale",
        { id: o.id },
        randomUUID(),
      ),
    ).rejects.toThrow("administrator");
    expect((await db().select().from(s.sales))[0].status).toBe("Draft");
    await act("confirmSale", { id: o.id });
    expect((await db().select().from(s.sales))[0].pricingApprovedBy).toBe(
      actor.id,
    );
    const [v] = await db()
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, variant));
    await saveMaster(
      actor,
      "variants",
      {
        productId: v.productId,
        sku: v.sku,
        size: v.size,
        color: v.color,
        fabric: v.fabric ?? "",
        cost: v.cost,
        price: "125",
      },
      v.id,
    );
    const events = await db()
      .select()
      .from(s.audit)
      .where(eq(s.audit.action, "catalog-price-change"));
    expect(events.length).toBe(1);
    expect((events[0].details as Record<string, unknown>).before).toBe(
      "100.00",
    );
  });
  it("approves B2B quotations and freezes converted sales and invoice amounts across price changes", async () => {
    const input = {
      name: "Jacket wholesale",
      kind: "Volume",
      variantId: variant,
      currency: "UZS",
      startDate: "2020-01-01",
      endDate: "2099-12-31",
      minimum: 1,
      tiers: [
        { minQty: 1, mode: "Price", value: "180000" },
        { minQty: 50, mode: "Price", value: "165000" },
        { minQty: 200, mode: "Price", value: "150000" },
      ],
    };
    await act("savePricingRule", input);
    const [r] = await db().select().from(s.pricingRules);
    await expect(
      execute(
        { ...actor, role: "sales" },
        "approvePricingRule",
        { id: r.id },
        randomUUID(),
      ),
    ).rejects.toThrow("permission");
    await act("approvePricingRule", { id: r.id });
    await act("savePricingRule", { ...input, name: "Conflicting duplicate" });
    const other = (await db().select().from(s.pricingRules)).find(
      (p) => p.status === "Draft",
    )!;
    await expect(act("approvePricingRule", { id: other.id })).rejects.toThrow(
      "Overlapping",
    );
    await act("createQuotation", {
      customerId: customer,
      currency: "UZS",
      validUntil: "2027-01-01",
      lines: [{ itemId: variant, quantity: 50 }],
    });
    const [q] = await db().select().from(s.quotations);
    expect(q.total).toBe("8250000.00");
    await act("approveQuotation", { id: q.id });
    const key = randomUUID();
    await act("convertQuotation", { id: q.id }, key);
    await act("convertQuotation", { id: q.id }, key);
    const [order] = await db().select().from(s.sales);
    const [line] = await db().select().from(s.saleItems);
    expect(line.price).toBe("165000.00");
    expect(line.pricingSnapshot.quotationId).toBe(q.id);
    await act("confirmSale", { id: order.id });
    await expect(
      db()
        .update(s.saleItems)
        .set({ price: "1" })
        .where(eq(s.saleItems.id, line.id)),
    ).rejects.toThrow();
    await act("retirePricingRule", {
      id: r.id,
      effectiveDate: pricingDay(),
      reason: "New wholesale terms",
    });
    await act("savePricingRule", {
      ...input,
      startDate: pricingDay(),
      tiers: [{ minQty: 1, mode: "Price", value: "190000" }],
    });
    const fresh = (await db().select().from(s.pricingRules)).find(
      (p) => p.status === "Draft" && p.name === input.name,
    )!;
    await act("approvePricingRule", { id: fresh.id });
    expect((await db().select().from(s.sales))[0].total).toBe("8250000.00");
    await act("adjust", {
      itemId: variant,
      kind: "variant",
      delta: "50",
      reason: "Finished test garments",
    });
    await act("reserveSale", { id: order.id });
    await act("ship", { id: order.id, lines: [{ id: line.id, quantity: 50 }] });
    await act("invoice", { id: order.id, dueDate: "2027-01-01", taxRate: "0" });
    const [invoice] = await db().select().from(s.invoices);
    expect(invoice.total).toBe("8250000.00");
    await expect(
      db()
        .update(s.invoices)
        .set({ total: "1" })
        .where(eq(s.invoices.id, invoice.id)),
    ).rejects.toThrow();
  });
  it("preserves routing versions and constrains labor to predecessor accepted output", async () => {
    const [v] = await db()
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, variant));
    await act("saveRouting", {
      productId: v.productId,
      steps: [
        { name: "Sewing", minutes: "25" },
        { name: "Inspection", minutes: "5" },
      ],
    });
    await stock();
    const mo = await production(10);
    const [fixed] = await db()
      .select()
      .from(s.orderRoutings)
      .where(eq(s.orderRoutings.orderId, mo.id));
    await act("saveRouting", {
      productId: v.productId,
      steps: [{ name: "Sewing", minutes: "30" }],
    });
    expect((await db().select().from(s.orderRoutings))[0].steps).toEqual(
      fixed.steps,
    );
    const [employee] = await db()
      .insert(s.employees)
      .values({ name: "Operator" })
      .returning();
    await act("plan", { id: mo.id });
    await act("start", { id: mo.id });
    await expect(
      act("startOperation", {
        id: mo.id,
        sequence: 1,
        employeeId: employee.id,
      }),
    ).rejects.toThrow();
    const key = randomUUID(),
      start = { id: mo.id, sequence: 0, employeeId: employee.id };
    await act("startOperation", start, key);
    await act("startOperation", start, key);
    expect((await db().select().from(s.laborEntries)).length).toBe(1);
    await expect(
      act("finishOperation", {
        id: mo.id,
        sequence: 0,
        completed: 11,
        rejected: 0,
      }),
    ).rejects.toThrow("applicable");
    await act("finishOperation", {
      id: mo.id,
      sequence: 0,
      completed: 3,
      rejected: 0,
    });
    await expect(
      act("startOperation", {
        id: mo.id,
        sequence: 1,
        employeeId: employee.id,
      }),
    ).rejects.toThrow();
    await act("startOperation", start);
    await act("finishOperation", {
      id: mo.id,
      sequence: 0,
      completed: 5,
      rejected: 2,
    });
    await expect(
      act("record", { id: mo.id, completed: 8, defective: 2 }),
    ).rejects.toThrow("operations");
    await act("startOperation", {
      id: mo.id,
      sequence: 1,
      employeeId: employee.id,
    });
    await expect(
      act("finishOperation", {
        id: mo.id,
        sequence: 1,
        completed: 9,
        rejected: 0,
      }),
    ).rejects.toThrow("applicable");
    await act("finishOperation", {
      id: mo.id,
      sequence: 1,
      completed: 8,
      rejected: 0,
    });
    await expect(
      act("record", { id: mo.id, completed: 9, defective: 1 }),
    ).rejects.toThrow("operations");
    await act("record", { id: mo.id, completed: 8, defective: 2 });
    await act("complete", { id: mo.id, approved: 8 });
    const logs = await db().select().from(s.laborEntries);
    expect(logs.every((e) => e.endedAt && e.endedAt >= e.startedAt)).toBe(true);
    await expect(
      db()
        .update(s.laborEntries)
        .set({ completed: 100 })
        .where(eq(s.laborEntries.id, logs[0].id)),
    ).rejects.toThrow();
    await expect(
      db()
        .update(s.orderRoutings)
        .set({ steps: [] })
        .where(eq(s.orderRoutings.id, fixed.id)),
    ).rejects.toThrow();
  });
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
