import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import { invoiceReturnPosition } from "../src/services/returns";
import type { Actor } from "../src/lib/permissions";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor, customer: string, L: string, M: string;
const act = (action: BusinessAction, input: unknown, key = randomUUID()) =>
  execute(actor, action, input, key);
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(sql`truncate users,warehouses,products,customers cascade`);
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Administrator",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  const [c] = await db()
    .insert(s.customers)
    .values({ name: "Workwear customer" })
    .returning();
  customer = c.id;
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Jacket", sku: "JKT" })
    .returning();
  const variants = await db()
    .insert(s.variants)
    .values([
      { productId: p.id, sku: "JKT-L", size: "L", color: "Navy", price: "100" },
      { productId: p.id, sku: "JKT-M", size: "M", color: "Navy", price: "100" },
    ])
    .returning();
  L = variants.find((v) => v.size === "L")!.id;
  M = variants.find((v) => v.size === "M")!.id;
});
async function sale(
  input = [{ itemId: L, quantity: "5", price: "100", discount: "0" }],
  taxRate = "20",
  paid = false,
) {
  for (const l of input)
    await act("adjust", {
      itemId: l.itemId,
      kind: "variant",
      delta: l.quantity,
      reason: "Finished test goods",
    });
  await act("sale", { partyId: customer, currency: "UZS", lines: input });
  const orders = await db().select().from(s.sales);
  const order = orders.at(-1)!;
  await act("confirmSale", { id: order.id });
  await act("reserveSale", { id: order.id });
  const lines = await db()
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, order.id));
  await act("ship", {
    id: order.id,
    lines: lines.map((l) => ({ id: l.id, quantity: l.quantity })),
  });
  await act("invoice", { id: order.id, dueDate: "2099-01-01", taxRate });
  const [invoice] = await db()
    .select()
    .from(s.invoices)
    .where(eq(s.invoices.orderId, order.id));
  if (paid)
    await act("pay", {
      id: invoice.id,
      amount: invoice.total,
      reference: "ORIGINAL-PAYMENT",
    });
  const [shipment] = await db()
    .select()
    .from(s.shipments)
    .where(eq(s.shipments.orderId, order.id));
  const shipped = await db()
    .select()
    .from(s.shipmentItems)
    .where(eq(s.shipmentItems.shipmentId, shipment.id));
  return { order, invoice, shipment, shipped, lines };
}
async function request(
  invoiceId: string,
  shipmentItemId: string,
  quantity: number,
) {
  await act("createReturn", {
    invoiceId,
    notes: "Customer requests a return after delivery",
    lines: [{ shipmentItemId, quantity, reason: "Incorrect size" }],
  });
  const rmas = await db().select().from(s.returnOrders);
  const rma = rmas.at(-1)!;
  const [item] = await db()
    .select()
    .from(s.returnItems)
    .where(eq(s.returnItems.returnId, rma.id));
  return { rma, item };
}
async function inspect(
  id: string,
  itemId: string,
  quantity: number,
  sellable = quantity,
) {
  await act("approveReturn", {
    id,
    notes: "Sales manager reviewed original delivery",
  });
  await act("receiveReturn", {
    id,
    returnItemId: itemId,
    quantity,
    reference: "RETURN-RECEIPT",
    notes: "Goods physically received at main warehouse",
  });
  const [receipt] = await db()
    .select()
    .from(s.returnReceipts)
    .where(eq(s.returnReceipts.returnItemId, itemId));
  await act("inspectReturn", {
    id,
    receiptId: receipt.id,
    sellable,
    quarantined: quantity - sellable,
    condition: sellable ? "Unworn / sellable" : "Manufacturing defect",
    notes: "Condition and quantities physically inspected",
  });
  return receipt;
}
async function commercial(
  id: string,
  itemId: string,
  kind: string,
  quantity: number,
  replacementVariantId?: string,
) {
  await act("requestReturnSettlement", {
    id,
    returnItemId: itemId,
    kind,
    quantity,
    replacementVariantId,
    notes: "Customer commercial resolution request",
  });
  const rows = await db()
    .select()
    .from(s.returnSettlements)
    .where(eq(s.returnSettlements.returnItemId, itemId));
  const q = rows.at(-1)!;
  await act("approveReturnSettlement", {
    id,
    settlementId: q.id,
    notes: "Administrator approved requested commercial resolution",
  });
  return q;
}
it("holds return limits across prior RMAs, inspects before restock, quarantines defects and fulfills a size exchange through normal shipping", async () => {
  const o = await sale(undefined, "20", true);
  const origin = o.shipped[0];
  await expect(request(o.invoice.id, origin.id, 4)).rejects.toThrow(
    "delivered",
  );
  await act("confirmLegacyShipmentDelivery", {
    shipmentId: o.shipment.id,
    notes: "Customer delivery receipt verified",
  });
  const { rma, item } = await request(o.invoice.id, origin.id, 4);
  await expect(request(o.invoice.id, origin.id, 2)).rejects.toThrow(
    "exceeds delivered",
  );
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, L)))[0]
      .onHand,
  ).toBe("0.0000");
  await act("approveReturn", {
    id: rma.id,
    notes: "Authorized up to four units",
  });
  const receiving = {
    id: rma.id,
    returnItemId: item.id,
    quantity: 3,
    reference: "RET-1",
    notes: "Three units physically received",
  };
  await expect(
    execute(
      { ...actor, role: "sales" },
      "receiveReturn",
      receiving,
      randomUUID(),
    ),
  ).rejects.toThrow("permission");
  const key = randomUUID();
  await act("receiveReturn", receiving, key);
  await act("receiveReturn", receiving, key);
  await expect(act("receiveReturn", receiving)).rejects.toThrow();
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, L)))[0]
      .onHand,
  ).toBe("0.0000");
  const [receipt] = await db().select().from(s.returnReceipts);
  const iq = {
    id: rma.id,
    receiptId: receipt.id,
    sellable: 2,
    quarantined: 1,
    condition: "Unworn / sellable",
    notes: "Two unworn garments; one damaged garment quarantined",
  };
  const ik = randomUUID();
  await act("inspectReturn", iq, ik);
  await act("inspectReturn", iq, ik);
  await expect(act("inspectReturn", iq)).rejects.toThrow("already");
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, L)))[0]
      .onHand,
  ).toBe("2.0000");
  await act("closeReturnIntake", {
    id: rma.id,
    notes: "Customer confirms only three units will be returned",
  });
  await request(o.invoice.id, origin.id, 2);
  await expect(request(o.invoice.id, origin.id, 1)).rejects.toThrow(
    "prior returns",
  );
  await expect(
    act("requestReturnSettlement", {
      id: rma.id,
      returnItemId: item.id,
      kind: "Replacement",
      quantity: 1,
      replacementVariantId: M,
      notes: "Invalid replacement size",
    }),
  ).rejects.toThrow("original variant");
  const credit = await commercial(rma.id, item.id, "Credit", 1);
  await expect(
    execute(
      { ...actor, role: "sales" },
      "processReturnSettlement",
      {
        id: rma.id,
        settlementId: credit.id,
        notes: "Unauthorized finance action",
      },
      randomUUID(),
    ),
  ).rejects.toThrow("permission");
  await act("processReturnSettlement", {
    id: rma.id,
    settlementId: credit.id,
    notes: "Issue original-invoice credit",
  });
  const p = await db().transaction((tx) =>
    invoiceReturnPosition(tx, o.invoice.id),
  );
  expect(p.creditBalance).toBe("120.00");
  expect(p.invoice.total).toBe("600.00");
  await expect(
    act("recordReturnRefund", {
      id: rma.id,
      amount: "121",
      reference: "OVER",
      notes: "Excess refund not allowed",
    }),
  ).rejects.toThrow("credit balance");
  const refund = {
    id: rma.id,
    amount: "120",
    reference: "BANK-REFUND-1",
    notes: "External bank refund has been confirmed",
  };
  const fk = randomUUID();
  await act("recordReturnRefund", refund, fk);
  await act("recordReturnRefund", refund, fk);
  expect((await db().select().from(s.returnRefunds)).length).toBe(1);
  const exchange = await commercial(rma.id, item.id, "Exchange", 2, M);
  await act("processReturnSettlement", {
    id: rma.id,
    settlementId: exchange.id,
    notes: "Approved no-charge size exchange",
  });
  const [resolved] = await db()
    .select()
    .from(s.returnSettlements)
    .where(eq(s.returnSettlements.id, exchange.id));
  expect(resolved.replacementOrderId).toBeTruthy();
  expect((await db().select().from(s.shipments)).length).toBe(1);
  await expect(
    act("processReturnSettlement", {
      id: rma.id,
      settlementId: exchange.id,
      notes: "Duplicate processing attempt",
    }),
  ).rejects.toThrow("Approve");
  await act("confirmSale", { id: resolved.replacementOrderId });
  await act("adjust", {
    itemId: M,
    kind: "variant",
    delta: "2",
    reason: "Replacement size available",
  });
  await act("reserveSale", { id: resolved.replacementOrderId });
  const [replacement] = await db()
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, resolved.replacementOrderId!));
  await act("ship", {
    id: resolved.replacementOrderId,
    lines: [{ id: replacement.id, quantity: 2 }],
  });
  expect(
    (
      await db()
        .select()
        .from(s.returnOrders)
        .where(eq(s.returnOrders.id, rma.id))
    )[0].status,
  ).toBe("Completed");
  const [inspection] = await db()
    .select()
    .from(s.returnInspections)
    .where(eq(s.returnInspections.receiptId, receipt.id));
  await act("dispositionReturnQuarantine", {
    id: rma.id,
    inspectionId: inspection.id,
    kind: "Restock",
    quantity: 1,
    reference: "REINSPECTION-1",
    notes: "Passed documented reinspection after repair",
  });
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, L)))[0]
      .onHand,
  ).toBe("3.0000");
  await expect(
    db()
      .update(s.returnReceipts)
      .set({ quantity: 10 })
      .where(eq(s.returnReceipts.id, receipt.id)),
  ).rejects.toThrow();
});
it("credits unpaid invoices without generating cash refunds or permitting overpayment", async () => {
  const o = await sale();
  await act("confirmLegacyShipmentDelivery", {
    shipmentId: o.shipment.id,
    notes: "Delivery evidence confirmed",
  });
  const { rma, item } = await request(o.invoice.id, o.shipped[0].id, 2);
  await inspect(rma.id, item.id, 2);
  const refund = await commercial(rma.id, item.id, "Refund", 2);
  await expect(
    act("processReturnSettlement", {
      id: rma.id,
      settlementId: refund.id,
      reference: "NO-CASH",
      notes: "Cannot refund an unpaid invoice",
    }),
  ).rejects.toThrow("fully settled");
  expect((await db().select().from(s.returnCreditNotes)).length).toBe(0);
  await act("rejectReturnSettlement", {
    id: rma.id,
    settlementId: refund.id,
    notes: "Issue credit against debt instead",
  });
  const credit = await commercial(rma.id, item.id, "Credit", 2);
  await act("processReturnSettlement", {
    id: rma.id,
    settlementId: credit.id,
    notes: "Credit two invoiced units",
  });
  expect(
    (await db().transaction((tx) => invoiceReturnPosition(tx, o.invoice.id)))
      .due,
  ).toBe("360.00");
  await expect(
    act("pay", { id: o.invoice.id, amount: "361", reference: "OVER" }),
  ).rejects.toThrow("outstanding");
  await act("pay", {
    id: o.invoice.id,
    amount: "360",
    reference: "REMAINING-PAYMENT",
  });
  const p = await db().transaction((tx) =>
    invoiceReturnPosition(tx, o.invoice.id),
  );
  expect(p.due).toBe("0.00");
  expect(p.invoice.total).toBe("600.00");
  expect(p.invoice.paid).toBe("360.00");
  await expect(
    act("recordReturnRefund", {
      id: rma.id,
      amount: "1",
      reference: "NO-BALANCE",
      notes: "No overpayment exists",
    }),
  ).rejects.toThrow("credit balance");
});
it("restocks the physically observed size for an incorrect delivery instead of inventing original-SKU stock", async () => {
  const o = await sale();
  await act("confirmLegacyShipmentDelivery", {
    shipmentId: o.shipment.id,
    notes: "Actual delivery was confirmed",
  });
  const { rma, item } = await request(o.invoice.id, o.shipped[0].id, 1);
  await act("approveReturn", {
    id: rma.id,
    notes: "Incorrect size return authorized",
  });
  await act("receiveReturn", {
    id: rma.id,
    returnItemId: item.id,
    actualVariantId: M,
    quantity: 1,
    reference: "WRONG-SIZE",
    notes: "Physical returned garment is size M, not invoiced L",
  });
  const [p] = await db().select().from(s.returnReceipts);
  await act("inspectReturn", {
    id: rma.id,
    receiptId: p.id,
    sellable: 1,
    quarantined: 0,
    condition: "Unworn / sellable",
    notes: "Actual size M garment passed inspection",
  });
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, M)))[0]
      .onHand,
  ).toBe("1.0000");
  expect(
    (await db().select().from(s.balances).where(eq(s.balances.variantId, L)))[0]
      .onHand,
  ).toBe("0.0000");
  expect(p.actualProductSnapshot).toContain("JKT-M");
});
it("resolves a zero-value return without inventing an external cash refund",async()=>{
 const o=await sale([{itemId:L,quantity:"1",price:"0",discount:"0"}],"0");await act("confirmLegacyShipmentDelivery",{shipmentId:o.shipment.id,notes:"Zero-value order delivery confirmed"});const{rma,item}=await request(o.invoice.id,o.shipped[0].id,1);await inspect(rma.id,item.id,1);const q=await commercial(rma.id,item.id,"Refund",1);await act("processReturnSettlement",{id:rma.id,settlementId:q.id,reference:"",notes:"No cash movement for zero-value goods"});expect((await db().select().from(s.returnCreditNotes))[0].amount).toBe("0.00");expect((await db().select().from(s.returnRefunds)).length).toBe(0);
});
it("allocates tax and partial-credit rounding cents without exceeding the original invoice", async () => {
  const o = await sale(
    [
      { itemId: L, quantity: "3", price: "0.05", discount: "33.33" },
      { itemId: M, quantity: "1", price: "0.05", discount: "0" },
    ],
    "10",
  );
  expect(o.invoice.total).toBe("0.17");
  await act("confirmLegacyShipmentDelivery", {
    shipmentId: o.shipment.id,
    notes: "All invoiced units were delivered",
  });
  for (const shipped of o.shipped) {
    const source = o.lines.find((l) => l.id === shipped.saleItemId)!;
    const { rma, item } = await request(
      o.invoice.id,
      shipped.id,
      source.quantity,
    );
    await inspect(rma.id, item.id, source.quantity);
    for (const q of source.quantity === 3 ? [1, 2] : [1]) {
      const request = await commercial(rma.id, item.id, "Credit", q);
      await act("processReturnSettlement", {
        id: rma.id,
        settlementId: request.id,
        notes: "Issue exact prorated credit",
      });
    }
  }
  const p = await db().transaction((tx) =>
    invoiceReturnPosition(tx, o.invoice.id),
  );
  expect(p.credited).toBe("0.17");
  expect(p.due).toBe("0.00");
  expect(p.invoice.total).toBe("0.17");
});
