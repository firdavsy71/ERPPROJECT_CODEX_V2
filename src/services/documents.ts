import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { discountedLineTotal } from "@/lib/money";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export const documentKinds = [
  "quotation",
  "sales-order",
  "invoice",
  "packing-list",
  "delivery-note",
  "purchase-order",
  "material-receipt",
  "manufacturing-order",
  "technical-specification",
  "material-requirements",
] as const;
export type DocumentKind = (typeof documentKinds)[number];
const permissions: Record<DocumentKind, string> = {
  quotation: "quotations",
  "sales-order": "sales",
  invoice: "invoices",
  "packing-list": "shipping.read",
  "delivery-note": "shipping.read",
  "purchase-order": "purchases",
  "material-receipt": "purchases",
  "manufacturing-order": "manufacturing",
  "technical-specification": "specifications",
  "material-requirements": "manufacturing",
};
export type DocumentData = {
  kind: DocumentKind;
  title: string;
  number: string;
  createdAt: string;
  status: string;
  company: {
    name: string;
    address: string;
    taxId: string;
    registration: string;
    bank: string;
    email: string;
    phone: string;
    timezone: string;
    logo?: { mime: string; data: string };
  };
  party?: {
    name: string;
    address: string;
    taxId: string;
    email: string;
    phone: string;
  };
  currency?: string;
  rows: {
    description: string;
    quantity?: string;
    price?: string;
    discount?: string;
    total?: string;
  }[];
  facts: { label: string; value: string }[];
  sections: { title: string; content: string }[];
  totals: { label: string; value: string; monetary?: boolean }[];
  attachments?: { id: string; name: string; kind: string; mime: string }[];
};
const titles: Record<DocumentKind, string> = {
  quotation: "Sales quotation",
  "sales-order": "Sales order confirmation",
  invoice: "Customer invoice",
  "packing-list": "Packing list",
  "delivery-note": "Delivery note",
  "purchase-order": "Purchase order",
  "material-receipt": "Material receipt",
  "manufacturing-order": "Manufacturing order",
  "technical-specification": "Product technical specification",
  "material-requirements": "Production material requirements",
};
const date = (v: Date) => v.toISOString();
const D = Decimal.clone({ precision: 40 });
async function company(tx: Tx) {
  const [c] = await tx.select().from(s.settings).limit(1);
  const [logo] = await tx.select().from(s.companyLogo).limit(1);
  return {
    name: c?.name ?? "",
    address: c?.address ?? "",
    taxId: c?.taxId ?? "",
    registration: c?.registrationNumber ?? "",
    bank: c?.bankDetails ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    timezone: c?.timezone ?? "Asia/Tashkent",
    ...(logo ? { logo: { mime: logo.mime, data: logo.data } } : {}),
  };
}
function customer(c: typeof s.customers.$inferSelect | undefined) {
  return c
    ? {
        name: c.name,
        address: c.address ?? "",
        taxId: c.taxId ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
      }
    : undefined;
}
function supplier(c: typeof s.suppliers.$inferSelect | undefined) {
  return c
    ? {
        name: c.name,
        address: c.address ?? "",
        taxId: "",
        email: c.email ?? "",
        phone: c.phone ?? "",
      }
    : undefined;
}
async function product(tx: Tx, variantId: string) {
  const [v] = await tx
    .select()
    .from(s.variants)
    .where(eq(s.variants.id, variantId));
  const [p] = v
    ? await tx.select().from(s.products).where(eq(s.products.id, v.productId))
    : [];
  return v ? `${p?.name ?? ""} · ${v.sku} · ${v.size} / ${v.color}` : "";
}
function flatten(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(flatten).join("\n");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${flatten(v)}`)
      .join(" · ");
  return String(value);
}
export async function buildDocument(
  tx: Tx,
  kind: DocumentKind,
  id: string,
): Promise<DocumentData | null> {
  const c = await company(tx);
  const base = (
    number: string,
    createdAt: Date,
    status: string,
  ): DocumentData => ({
    kind,
    title: titles[kind],
    number,
    createdAt: date(createdAt),
    status,
    company: c,
    rows: [],
    facts: [],
    sections: [],
    totals: [],
  });
  if (kind === "quotation") {
    const [q] = await tx
      .select()
      .from(s.quotations)
      .where(eq(s.quotations.id, id));
    if (!q) return null;
    const [party] = await tx
      .select()
      .from(s.customers)
      .where(eq(s.customers.id, q.customerId));
    const doc = base(q.number, q.createdAt, q.status);
    doc.party = customer(party);
    doc.currency = q.currency;
    for (const l of q.lines)
      doc.rows.push({
        description: await product(tx, l.itemId),
        quantity: String(l.quantity),
        price: l.price,
        discount: l.discount,
        total: discountedLineTotal(l.quantity, l.price, l.discount),
      });
    doc.facts.push({ label: "Valid until", value: q.validUntil });
    doc.totals.push({ label: "Total", value: q.total, monetary: true });
    if (q.notes) doc.sections.push({ title: "Notes", content: q.notes });
    return doc;
  }
  if (kind === "sales-order" || kind === "invoice") {
    const [inv] =
      kind === "invoice"
        ? await tx.select().from(s.invoices).where(eq(s.invoices.id, id))
        : [];
    if (kind === "invoice" && !inv) return null;
    const [o] = await tx
      .select()
      .from(s.sales)
      .where(eq(s.sales.id, inv?.orderId ?? id));
    if (!o) return null;
    const [party] = await tx
      .select()
      .from(s.customers)
      .where(eq(s.customers.id, o.customerId));
    const items = await tx
      .select()
      .from(s.saleItems)
      .where(eq(s.saleItems.orderId, o.id));
    const doc = base(
      inv?.number ?? o.number,
      inv?.createdAt ?? o.createdAt,
      inv?.status ?? o.status,
    );
    doc.party = customer(party);
    doc.currency = o.currency;
    for (const l of items)
      doc.rows.push({
        description: await product(tx, l.variantId),
        quantity: String(l.quantity),
        price: l.price,
        discount: l.discount,
        total: new D(discountedLineTotal(l.quantity, l.price, l.discount))
          .add(l.brandingTotal)
          .toFixed(2),
      });
    if (inv) {
      doc.facts.push(
        { label: "Sales order", value: o.number },
        { label: "Due date", value: inv.dueDate },
        { label: "Tax rate", value: `${inv.taxRate}%` },
      );
      doc.totals.push(
        { label: "Subtotal", value: inv.subtotal, monetary: true },
        {
          label: "Tax",
          value: new D(inv.total).minus(inv.subtotal).toFixed(2),
          monetary: true,
        },
        { label: "Total", value: inv.total, monetary: true },
      );
    } else {
      if (o.deliveryDate)
        doc.facts.push({ label: "Expected delivery", value: o.deliveryDate });
      doc.totals.push({ label: "Total", value: o.total, monetary: true });
    }
    return doc;
  }
  if (kind === "packing-list" || kind === "delivery-note") {
    const [d] = await tx
      .select()
      .from(s.deliveryOrders)
      .where(eq(s.deliveryOrders.id, id));
    if (!d || (kind === "delivery-note" && !d.shipmentId)) return null;
    const [order] = await tx
      .select()
      .from(s.sales)
      .where(eq(s.sales.id, d.orderId));
    const items = await tx
      .select()
      .from(s.deliveryItems)
      .where(eq(s.deliveryItems.deliveryId, d.id));
    const doc = base(d.number, d.dispatchedAt ?? d.createdAt, d.status);
    doc.party = {
      name: d.customerName,
      address: d.address,
      taxId: "",
      email: "",
      phone: "",
    };
    doc.facts.push(
      { label: "Sales order", value: order?.number ?? "" },
      { label: "Carrier", value: d.carrier },
      { label: "Vehicle", value: d.vehicle },
      { label: "Driver", value: d.driver },
      { label: "Tracking", value: d.tracking },
    );
    doc.facts.push({
      label: "Quantities",
      value: d.shipmentId ? "Dispatched" : "Packed so far — not yet dispatched",
    });
    for (const i of items)
      doc.rows.push({
        description: i.productSnapshot,
        quantity: String(i.packed),
      });
    if (d.notes) doc.sections.push({ title: "Instructions", content: d.notes });
    return doc;
  }
  if (kind === "purchase-order" || kind === "material-receipt") {
    const [receipt] =
      kind === "material-receipt"
        ? await tx.select().from(s.receipts).where(eq(s.receipts.id, id))
        : [];
    if (kind === "material-receipt" && !receipt) return null;
    const [o] = await tx
      .select()
      .from(s.purchases)
      .where(eq(s.purchases.id, receipt?.orderId ?? id));
    if (!o) return null;
    const [sp] = await tx
      .select()
      .from(s.suppliers)
      .where(eq(s.suppliers.id, o.supplierId));
    const doc = base(
      receipt ? receipt.id : o.number,
      receipt?.createdAt ?? o.orderedAt ?? o.createdAt,
      receipt ? "Received" : o.status,
    );
    doc.party = supplier(sp);
    doc.currency = o.currency;
    if (receipt) {
      const lines = await tx
        .select()
        .from(s.purchaseReceiptItems)
        .where(eq(s.purchaseReceiptItems.receiptId, id));
      for (const l of lines) {
        const [m] = await tx
          .select()
          .from(s.materials)
          .where(eq(s.materials.id, l.materialId));
        doc.rows.push({
          description: `${m?.name ?? ""} · ${m?.sku ?? ""} · ${m?.unit ?? ""}`,
          quantity: l.quantity,
          price: l.unitPrice ?? undefined,
          total: l.unitPrice
            ? new D(l.quantity).mul(l.unitPrice).toFixed(2)
            : undefined,
        });
      }
      doc.facts.push({ label: "Purchase order", value: o.number });
    } else {
      const lines = await tx
        .select()
        .from(s.purchaseItems)
        .where(eq(s.purchaseItems.orderId, o.id));
      for (const l of lines) {
        const [m] = await tx
          .select()
          .from(s.materials)
          .where(eq(s.materials.id, l.materialId));
        doc.rows.push({
          description: `${m?.name ?? ""} · ${m?.sku ?? ""} · ${m?.unit ?? ""}`,
          quantity: l.quantity,
          price: l.price,
          total: new D(l.quantity).mul(l.price).toFixed(2),
        });
      }
      if (o.expectedDate)
        doc.facts.push({ label: "Expected date", value: o.expectedDate });
      doc.totals.push({ label: "Total", value: o.total, monetary: true });
    }
    return doc;
  }
  if (kind === "manufacturing-order" || kind === "material-requirements") {
    const [o] = await tx
      .select()
      .from(s.manufacturing)
      .where(eq(s.manufacturing.id, id));
    if (!o) return null;
    const doc = base(o.number, o.createdAt, o.status);
    doc.facts.push(
      { label: "Product", value: await product(tx, o.variantId) },
      { label: "Quantity", value: String(o.quantity) },
    );
    if (o.dueDate) doc.facts.push({ label: "Due date", value: o.dueDate });
    if (o.notes)
      doc.sections.push({ title: "Production notes", content: o.notes });
    if (o.specificationId) {
      const [spec] = await tx
        .select()
        .from(s.specifications)
        .where(eq(s.specifications.id, o.specificationId));
      if (spec) {
        doc.facts.push({
          label: "Approved specification",
          value: `${spec.title} · v${spec.version}`,
        });
        if(kind==="manufacturing-order") doc.sections.push({title:"Manufacturing instructions",content:spec.document.manufacturingInstructions});
      }
    }
    if(kind==="manufacturing-order" && o.brandingVersionId) {
      const [branding]=await tx.select().from(s.brandingVersions).where(eq(s.brandingVersions.id,o.brandingVersionId));
      if(branding) {
        const b=branding.document;
        doc.sections.push({title:`Approved branding · ${branding.title} v${branding.version}`,content:flatten({
          customerInstructions:b.customerInstructions,productionInstructions:b.productionInstructions,
          fabricColor:b.fabricColor,fabricColorStandard:b.fabricColorStandard,reflectiveTape:b.reflectiveTape,
          placements:b.placements.map(p=>({technique:p.technique,location:p.location,logoAssetId:p.logoAssetId,widthMm:p.widthMm,heightMm:p.heightMm,colors:p.colors,thread:p.thread,applicationInstructions:p.applicationInstructions,positionInstructions:p.positionInstructions})),
        })});
      }
    }
    const reservations = await tx
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, id));
    for (const r of reservations) {
      const [balance] = await tx
        .select()
        .from(s.balances)
        .where(eq(s.balances.id, r.balanceId));
      const [m] = balance?.materialId
        ? await tx
            .select()
            .from(s.materials)
            .where(eq(s.materials.id, balance.materialId))
        : [];
      doc.rows.push({
        description: `${m?.name ?? ""} · ${m?.sku ?? ""} · ${m?.unit ?? ""}`,
        quantity: r.quantity,
      });
    }
    if (!reservations.length && o.status === "Draft") {
      const items = await tx
        .select()
        .from(s.bomItems)
        .where(eq(s.bomItems.bomId, o.bomId));
      for (const i of items) {
        const [m] = await tx
          .select()
          .from(s.materials)
          .where(eq(s.materials.id, i.materialId));
        doc.rows.push({
          description: `${m?.name ?? ""} · ${m?.sku ?? ""} · ${m?.unit ?? ""}`,
          quantity: new D(i.quantity).mul(o.quantity).toFixed(4),
        });
      }
      doc.facts.push({
        label: "Material quantities",
        value: "Calculated from draft BOM; not reserved",
      });
    }
    return doc;
  }
  const [v] = await tx
    .select()
    .from(s.specifications)
    .where(eq(s.specifications.id, id));
  if (!v) return null;
  const variants = await tx
    .select()
    .from(s.specificationVariants)
    .where(eq(s.specificationVariants.specificationId, id));
  const attachments = await tx
    .select({
      id: s.specificationAttachments.id,
      name: s.specificationAttachments.name,
      kind: s.specificationAttachments.kind,
      mime: s.specificationAttachments.mime,
    })
    .from(s.specificationAttachments)
    .where(eq(s.specificationAttachments.specificationId, id));
  const doc = base(
    `${v.productSnapshot.sku} · v${v.version}`,
    v.createdAt,
    v.status,
  );
  doc.facts.push(
    {
      label: "Product",
      value: `${v.productSnapshot.name} · ${v.productSnapshot.sku}`,
    },
    { label: "Specification", value: v.title },
    { label: "Version", value: String(v.version) },
  );
  for (const [key, value] of Object.entries(v.document))
    doc.sections.push({ title: key, content: flatten(value) });
  for (const variant of variants)
    doc.sections.push({
      title: `Variant ${variant.snapshot.sku} · ${variant.snapshot.size} / ${variant.snapshot.color}`,
      content: flatten({
        measurements: variant.measurements,
        fabricConsumption: variant.fabricConsumption,
        consumptionUnit: variant.consumptionUnit,
        instructions: variant.instructions,
      }),
    });
  doc.attachments = attachments;
  return doc;
}
export async function captureDocument(
  tx: Tx,
  kind: DocumentKind,
  id: string,
  actorId: string,
) {
  const data = await buildDocument(tx, kind, id);
  if (!data) throw new Error("Unable to capture document.");
  await tx
    .insert(s.documentSnapshots)
    .values({
      kind,
      entityId: id,
      payload: data as unknown as Record<string, unknown>,
      createdBy: actorId,
    })
    .onConflictDoNothing();
}
export async function getDocument(
  actor: Actor,
  kind: DocumentKind,
  id: string,
) {
  authorize(actor, permissions[kind]);
  const [snapshot] = await db()
    .select()
    .from(s.documentSnapshots)
    .where(
      and(
        eq(s.documentSnapshots.kind, kind),
        eq(s.documentSnapshots.entityId, id),
      ),
    );
  if (snapshot)
    return {
      data: snapshot.payload as unknown as DocumentData,
      source: "snapshot" as const,
    };
  const data = await db().transaction((tx) => buildDocument(tx, kind, id));
  return data ? { data, source: "live" as const } : null;
}
export async function captureOperationDocuments(
  tx: Tx,
  action: string,
  input: unknown,
  key: string,
  actorId: string,
) {
  const id = (input as { id?: string })?.id;
  if (!id) return;
  if (action === "approveQuotation")
    await captureDocument(tx, "quotation", id, actorId);
  else if (action === "confirmSale")
    await captureDocument(tx, "sales-order", id, actorId);
  else if (action === "orderPurchase")
    await captureDocument(tx, "purchase-order", id, actorId);
  else if (action === "plan") {
    await captureDocument(tx, "manufacturing-order", id, actorId);
    await captureDocument(tx, "material-requirements", id, actorId);
  } else if (action === "dispatchDelivery") {
    await captureDocument(tx, "packing-list", id, actorId);
    await captureDocument(tx, "delivery-note", id, actorId);
  } else if (action === "receive") {
    const [r] = await tx
      .select()
      .from(s.receipts)
      .where(eq(s.receipts.operationKey, key));
    if (r) await captureDocument(tx, "material-receipt", r.id, actorId);
  } else if (action === "invoice") {
    const [i] = await tx
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.orderId, id));
    if (i) await captureDocument(tx, "invoice", i.id, actorId);
  }
}
