import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { execute, type BusinessAction } from "../src/services/operations";
import { getDocument } from "../src/services/documents";
import { renderDocumentPdf } from "../src/services/document-pdf";
import { approvedSpec,validDocument } from "./spec-fixture";
import {saveSpecification,transitionSpecification,uploadSpecificationAttachment} from "../src/services/specifications";
import sharp from "sharp";
import type { Actor } from "../src/lib/permissions";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor,
  customer: string,
  product: string,
  variant: string,
  supplier: string,
  material: string;
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
    sql`truncate users,warehouses,products,customers,suppliers,materials,company_settings cascade`,
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
  await db()
    .insert(s.settings)
    .values({
      id: 1,
      name: "Original company",
      currency: "UZS",
      timezone: "Asia/Tashkent",
      taxRate: "0",
      taxId: "ORIGINAL-TAX",
    });
  [customer] = (
    await db()
      .insert(s.customers)
      .values({ name: "Original customer", address: "Original address" })
      .returning()
  ).map((x) => x.id);
  [supplier] = (
    await db()
      .insert(s.suppliers)
      .values({ name: "Original supplier" })
      .returning()
  ).map((x) => x.id);
  [material] = (
    await db()
      .insert(s.materials)
      .values({ name: "Original fabric", sku: "FAB", unit: "Meters" })
      .returning()
  ).map((x) => x.id);
  [product] = (
    await db()
      .insert(s.products)
      .values({ name: "Original jacket", sku: "JKT" })
      .returning()
  ).map((x) => x.id);
  [variant] = (
    await db()
      .insert(s.variants)
      .values({
        productId: product,
        sku: "JKT-L",
        size: "L",
        color: "Navy",
        price: "100",
      })
      .returning()
  ).map((x) => x.id);
});
it("freezes sales, invoice and purchase documents when transactions become effective", async () => {
  await act("adjust", {
    kind: "variant",
    itemId: variant,
    delta: "2",
    reason: "Opening stock",
  });
  await act("sale", {
    partyId: customer,
    currency: "UZS",
    lines: [{ itemId: variant, quantity: "2", price: "100", discount: "0" }],
  });
  const [sale] = await db().select().from(s.sales);
  await act("confirmSale", { id: sale.id });
  await db()
    .update(s.customers)
    .set({ name: "Changed customer" })
    .where(eq(s.customers.id, customer));
  await db()
    .update(s.products)
    .set({ name: "Changed jacket" })
    .where(eq(s.products.id, product));
  await db()
    .update(s.settings)
    .set({ name: "Changed company" })
    .where(eq(s.settings.id, 1));
  const old = await getDocument(actor, "sales-order", sale.id);
  expect(old?.source).toBe("snapshot");
  expect(old?.data.party?.name).toBe("Original customer");
  expect(old?.data.company.name).toBe("Original company");
  expect(old?.data.rows[0].description).toContain("Original jacket");
  await act("reserveSale", { id: sale.id });
  const [line] = await db().select().from(s.saleItems);
  await act("ship", { id: sale.id, lines: [{ id: line.id, quantity: 2 }] });
  await act("invoice", { id: sale.id, dueDate: "2099-01-01", taxRate: "12" });
  const [invoice] = await db().select().from(s.invoices);
  const doc = await getDocument(actor, "invoice", invoice.id);
  expect(doc?.data.company.name).toBe("Changed company");
  expect(doc?.data.totals.at(-1)?.value).toBe("224.00");
  await db()
    .update(s.settings)
    .set({ name: "Third company" })
    .where(eq(s.settings.id, 1));
  expect(
    (await getDocument(actor, "invoice", invoice.id))?.data.company.name,
  ).toBe("Changed company");
  const pdf = await renderDocumentPdf(doc!.data, doc!.source, "ru");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(1000);
  await expect(
    getDocument({ id: actor.id, role: "viewer" }, "invoice", invoice.id),
  ).rejects.toThrow("permission");
  const [snapshot] = await db()
    .select()
    .from(s.documentSnapshots)
    .where(eq(s.documentSnapshots.entityId, invoice.id));
  await expect(
    db()
      .update(s.documentSnapshots)
      .set({ payload: {} })
      .where(eq(s.documentSnapshots.id, snapshot.id)),
  ).rejects.toThrow();
  await act("purchase", {
    partyId: supplier,
    currency: "USD",
    date: "2099-01-01",
    lines: [{ itemId: material, quantity: "10", price: "5" }],
  });
  const [po] = await db().select().from(s.purchases);
  await act("orderPurchase", { id: po.id });
  const purchase = await getDocument(actor, "purchase-order", po.id);
  expect(purchase?.data.currency).toBe("USD");
  expect(purchase?.data.rows[0].price).toBe("5.00");
  const [poLine] = await db().select().from(s.purchaseItems);
  await act("receive", {
    id: po.id,
    lines: [{ id: poLine.id, quantity: "3" }],
  });
  const [receipt] = await db().select().from(s.receipts);
  expect(
    (await getDocument(actor, "material-receipt", receipt.id))?.data.rows[0]
      .quantity,
  ).toBe("3.0000");
});
it("makes historical limitations explicit and captures approved technical sheets", async () => {
  await act("sale", {
    partyId: customer,
    currency: "UZS",
    lines: [{ itemId: variant, quantity: "1", price: "100", discount: "0" }],
  });
  const [draft] = await db().select().from(s.sales);
  expect((await getDocument(actor, "sales-order", draft.id))?.source).toBe(
    "live",
  );
  const spec = await approvedSpec(actor, product, variant);
  const doc = await getDocument(actor, "technical-specification", spec);
  expect(doc?.source).toBe("snapshot");
  expect(doc?.data.sections.length).toBeGreaterThan(5);
  await expect(
    getDocument(
      { id: actor.id, role: "sales" },
      "technical-specification",
      spec,
    ),
  ).rejects.toThrow("permission");
});
it("captures quotations, dispatched packing and production requirements at their transitions", async () => {
  await act("createQuotation", {
    customerId: customer,
    currency: "UZS",
    validUntil: "2099-01-01",
    lines: [{ itemId: variant, quantity: 2 }],
  });
  const [q] = await db().select().from(s.quotations);
  await act("approveQuotation", { id: q.id });
  expect((await getDocument(actor, "quotation", q.id))?.source).toBe(
    "snapshot",
  );
  await act("adjust", {
    kind: "variant",
    itemId: variant,
    delta: "2",
    reason: "Finished goods",
  });
  await act("sale", {
    partyId: customer,
    currency: "UZS",
    lines: [{ itemId: variant, quantity: "2", price: "100", discount: "0" }],
  });
  const [o] = await db().select().from(s.sales);
  const [l] = await db().select().from(s.saleItems);
  await act("confirmSale", { id: o.id });
  await act("reserveSale", { id: o.id });
  await act("createDelivery", {
    orderId: o.id,
    address: "Customer receiving gate",
    carrier: "Carrier",
    lines: [{ saleItemId: l.id, quantity: 2 }],
  });
  const [delivery] = await db().select().from(s.deliveryOrders);
  const [item] = await db().select().from(s.deliveryItems);
  expect(await getDocument(actor, "delivery-note", delivery.id)).toBeNull();
  await act("recordDeliveryPacking", {
    id: delivery.id,
    lineId: item.id,
    picked: 2,
    packed: 2,
    notes: "Checked",
  });
  await act("dispatchDelivery", { id: delivery.id });
  const packing = await getDocument(actor, "packing-list", delivery.id),
    note = await getDocument(actor, "delivery-note", delivery.id);
  expect(packing?.source).toBe("snapshot");
  expect(note?.data.rows[0].quantity).toBe("2");
  await db()
    .update(s.customers)
    .set({ name: "Later change" })
    .where(eq(s.customers.id, customer));
  expect(
    (await getDocument(actor, "delivery-note", delivery.id))?.data.party?.name,
  ).toBe("Original customer");
  await approvedSpec(actor, product, variant);
  await act("bom", {
    variantId: variant,
    laborCost: "0",
    items: [{ materialId: material, quantity: "2.5" }],
  });
  const [bom] = await db().select().from(s.boms);
  await act("adjust", {
    kind: "material",
    itemId: material,
    delta: "20",
    reason: "Available fabric",
  });
  await act("manufacture", { bomId: bom.id, quantity: 4 });
  const [mo] = await db().select().from(s.manufacturing);
  await act("plan", { id: mo.id });
  const production = await getDocument(actor, "manufacturing-order", mo.id),
    requirements = await getDocument(actor, "material-requirements", mo.id);
  expect(production?.source).toBe("snapshot");
  expect(requirements?.data.rows[0].quantity).toBe("10.0000");
});
it("pins technical attachments and embeds them in the PDF", async()=>{
  const id=await saveSpecification(actor,{productId:product,title:"Technical jacket",changeNote:"Initial",document:validDocument(),variants:[{variantId:variant,fabricConsumption:"2.5",consumptionUnit:"Meters",instructions:"",measurements:[]}]});
  const png=await sharp({create:{width:20,height:20,channels:3,background:"#125d50"}}).png().toBuffer();
  await uploadSpecificationAttachment(actor,id,{name:"drawing.png",mime:"image/png",data:png},"Technical drawing");
  await transitionSpecification(actor,id,"submit","");await transitionSpecification(actor,id,"approve","Reviewed");
  const result=await getDocument(actor,"technical-specification",id);
  expect(result?.data.attachments?.[0].name).toBe("drawing.png");
  const pdf=await renderDocumentPdf(result!.data,result!.source,"en",[{name:"drawing.png",mime:"image/png",data:png}]);
  expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.includes(Buffer.from("/EmbeddedFiles"))).toBe(true);
});
