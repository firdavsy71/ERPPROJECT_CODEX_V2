import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { discountedLineTotal } from "@/lib/money";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Context = {
  actorId: string;
  balance: (variantId: string) => Promise<typeof s.balances.$inferSelect>;
  post: (
    balance: typeof s.balances.$inferSelect,
    quantity: number,
    reason: string,
    suffix: string,
  ) => Promise<typeof s.movements.$inferSelect>;
};
const D = Decimal.clone({ precision: 40 });
const n = (v: Decimal.Value) => new D(v);
const qty = z.coerce.number().int().positive().max(1000000),
  count = z.coerce.number().int().nonnegative().max(1000000),
  notes = z.string().trim().min(5).max(3000),
  reference = z
    .string()
    .trim()
    .min(1)
    .max(150)
    .transform((v) => v.toUpperCase());
export const returnReasons = [
  "Incorrect size",
  "Incorrect color",
  "Manufacturing defect",
  "Incorrect delivery",
  "Customer cancellation",
  "Other",
] as const;
export async function invoiceReturnPosition(tx: Tx, invoiceId: string) {
  const [i] = await tx
    .select()
    .from(s.invoices)
    .where(eq(s.invoices.id, invoiceId));
  if (!i) throw new Error("Invoice not found");
  const [credits, refunds] = await Promise.all([
    tx
      .select()
      .from(s.returnCreditNotes)
      .where(eq(s.returnCreditNotes.invoiceId, invoiceId)),
    tx
      .select()
      .from(s.returnRefunds)
      .where(eq(s.returnRefunds.invoiceId, invoiceId)),
  ]);
  const credited = credits.reduce((q, r) => q.add(r.amount), n(0)),
    refunded = refunds.reduce((q, r) => q.add(r.amount), n(0)),
    adjusted = n(i.total).minus(credited),
    netPaid = n(i.paid).minus(refunded);
  return {
    invoice: i,
    credited: credited.toFixed(2),
    refunded: refunded.toFixed(2),
    adjusted: adjusted.toFixed(2),
    netPaid: netPaid.toFixed(2),
    due: D.max(adjusted.minus(netPaid), 0).toFixed(2),
    creditBalance: D.max(netPaid.minus(adjusted), 0).toFixed(2),
  };
}
async function refreshInvoice(tx: Tx, invoiceId: string) {
  const p = await invoiceReturnPosition(tx, invoiceId);
  await tx
    .update(s.invoices)
    .set({
      status: n(p.due).isZero()
        ? "Paid"
        : n(p.netPaid).gt(0)
          ? "Partially Paid"
          : "Unpaid",
    })
    .where(eq(s.invoices.id, invoiceId));
  if (n(p.due).isZero())
    await tx
      .update(s.sales)
      .set({ status: "Completed" })
      .where(eq(s.sales.id, p.invoice.orderId));
}
async function origin(tx: Tx, item: typeof s.returnItems.$inferSelect) {
  const [shipment] = await tx
    .select()
    .from(s.shipmentItems)
    .where(eq(s.shipmentItems.id, item.shipmentItemId));
  const [line] = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.id, shipment.saleItemId));
  return { shipment, line };
}
async function receivedQty(tx: Tx, lineId: string) {
  return (
    await tx
      .select()
      .from(s.returnReceipts)
      .where(eq(s.returnReceipts.returnItemId, lineId))
  ).reduce((q, r) => q + r.quantity, 0);
}
async function inspectedQty(tx: Tx, lineId: string) {
  const rows = await tx
    .select({ inspection: s.returnInspections })
    .from(s.returnInspections)
    .innerJoin(
      s.returnReceipts,
      eq(s.returnInspections.receiptId, s.returnReceipts.id),
    )
    .where(eq(s.returnReceipts.returnItemId, lineId));
  return rows.reduce(
    (q, r) => q + r.inspection.sellable + r.inspection.quarantined,
    0,
  );
}
export async function isShipmentDelivered(tx: Tx, shipmentId: string) {
  const [d] = await tx
    .select()
    .from(s.deliveryOrders)
    .where(eq(s.deliveryOrders.shipmentId, shipmentId));
  if (d) return d.status === "Delivered";
  return (
    (
      await tx
        .select()
        .from(s.legacyDeliveryConfirmations)
        .where(eq(s.legacyDeliveryConfirmations.shipmentId, shipmentId))
    ).length > 0
  );
}
export async function returnClaimed(tx: Tx, shipmentItemId: string) {
  const rows = await tx
    .select({ item: s.returnItems, rma: s.returnOrders })
    .from(s.returnItems)
    .innerJoin(s.returnOrders, eq(s.returnItems.returnId, s.returnOrders.id))
    .where(eq(s.returnItems.shipmentItemId, shipmentItemId));
  let total = 0;
  for (const r of rows) {
    if (["Rejected", "Cancelled"].includes(r.rma.status)) continue;
    total += r.rma.intakeClosed
      ? await receivedQty(tx, r.item.id)
      : r.item.quantity;
  }
  return total;
}
async function updateReturnState(tx: Tx, returnId: string) {
  const [r] = await tx
    .select()
    .from(s.returnOrders)
    .where(eq(s.returnOrders.id, returnId));
  if (!["Receiving", "Inspected"].includes(r.status)) return;
  const items = await tx
    .select()
    .from(s.returnItems)
    .where(eq(s.returnItems.returnId, returnId));
  let received = 0,
    inspected = 0,
    requested = 0,
    processed = 0;
  for (const l of items) {
    received += await receivedQty(tx, l.id);
    inspected += await inspectedQty(tx, l.id);
    requested += l.quantity;
    processed += (
      await tx
        .select()
        .from(s.returnSettlements)
        .where(eq(s.returnSettlements.returnItemId, l.id))
    )
      .filter((v) => v.status === "Processed")
      .reduce((q, v) => q + v.quantity, 0);
  }
  const closed =
    r.intakeClosed || (received === requested && inspected === received);
  if (closed && received > 0 && inspected === received)
    await tx
      .update(s.returnOrders)
      .set({
        intakeClosed: true,
        status: processed === received ? "Completed" : "Inspected",
      })
      .where(eq(s.returnOrders.id, returnId));
}
/** Cumulative allocation assigns invoice rounding cents deterministically, then prorates credited units. */
export async function returnCreditAmount(
  tx: Tx,
  invoiceId: string,
  saleItemId: string,
  quantity: number,
) {
  const [i] = await tx
    .select()
    .from(s.invoices)
    .where(eq(s.invoices.id, invoiceId));
  const lines = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, i.orderId))
    .orderBy(s.saleItems.id);
  const weights = lines.map((l) =>
    n(discountedLineTotal(l.quantity, l.price, l.discount)).add(
      l.brandingTotal,
    ),
  );
  const total = weights.reduce((q, v) => q.add(v), n(0));
  const index = lines.findIndex((l) => l.id === saleItemId);
  if (index < 0) throw new Error("Invoice line mismatch");
  const credits = await tx
    .select()
    .from(s.returnCreditNotes)
    .where(eq(s.returnCreditNotes.saleItemId, saleItemId));
  const previous = credits.reduce((q, c) => q + c.quantity, 0);
  if (previous + quantity > lines[index].quantity)
    throw new Error("Credit exceeds original invoiced units");
  if (total.isZero()) return "0.00";
  const before = weights.slice(0, index).reduce((q, w) => q.add(w), n(0));
  const allocation = n(i.total)
    .mul(before.add(weights[index]))
    .div(total)
    .toDecimalPlaces(2)
    .minus(n(i.total).mul(before).div(total).toDecimalPlaces(2));
  return allocation
    .mul(previous + quantity)
    .div(lines[index].quantity)
    .toDecimalPlaces(2)
    .minus(
      allocation.mul(previous).div(lines[index].quantity).toDecimalPlaces(2),
    )
    .toFixed(2);
}
export async function requireReplacementBranding(tx: Tx, orderId: string) {
  const [settlement] = await tx
    .select()
    .from(s.returnSettlements)
    .where(eq(s.returnSettlements.replacementOrderId, orderId));
  if (!settlement) return;
  const [item] = await tx
    .select()
    .from(s.returnItems)
    .where(eq(s.returnItems.id, settlement.returnItemId));
  const { line } = await origin(tx, item);
  if (
    !(
      await tx
        .select()
        .from(s.brandingRequests)
        .where(eq(s.brandingRequests.saleItemId, line.id))
    ).length
  )
    return;
  const replacements = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, orderId));
  for (const l of replacements)
    if (
      !(
        await tx
          .select()
          .from(s.brandingRequests)
          .where(eq(s.brandingRequests.saleItemId, l.id))
      ).length
    )
      throw new Error(
        "This replacement requires customer branding approval for its new sales line before confirmation",
      );
}
export async function returnsAction(
  tx: Tx,
  action: string,
  input: unknown,
  c: Context,
) {
  if (action === "confirmLegacyShipmentDelivery") {
    const v = z.object({ shipmentId: z.uuid(), notes }).parse(input);
    if (
      (
        await tx
          .select()
          .from(s.deliveryOrders)
          .where(eq(s.deliveryOrders.shipmentId, v.shipmentId))
      ).length
    )
      throw new Error(
        "Use the managed delivery status workflow for this shipment",
      );
    await tx
      .insert(s.legacyDeliveryConfirmations)
      .values({ ...v, createdBy: c.actorId });
    return;
  }
  if (action === "createReturn") {
    const v = z
      .object({
        invoiceId: z.uuid(),
        notes,
        lines: z
          .array(
            z.object({
              shipmentItemId: z.uuid(),
              quantity: qty,
              reason: z.enum(returnReasons),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    if (new Set(v.lines.map((l) => l.shipmentItemId)).size !== v.lines.length)
      throw new Error("Each delivered shipment line must appear once");
    const [invoice] = await tx
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, v.invoiceId));
    if (!invoice) throw new Error("Original invoice not found");
    const [rma] = await tx
      .insert(s.returnOrders)
      .values({
        number: `RMA-${randomUUID().slice(0, 12).toUpperCase()}`,
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        notes: v.notes,
        createdBy: c.actorId,
      })
      .returning();
    for (const l of v.lines) {
      const [si] = await tx
        .select()
        .from(s.shipmentItems)
        .where(eq(s.shipmentItems.id, l.shipmentItemId));
      const [ship] = si
        ? await tx
            .select()
            .from(s.shipments)
            .where(eq(s.shipments.id, si.shipmentId))
        : [];
      if (
        !si ||
        ship?.orderId !== invoice.orderId ||
        !(await isShipmentDelivered(tx, ship.id))
      )
        throw new Error(
          "Return requires a confirmed delivered shipment from the original invoiced sales order",
        );
      if (l.quantity + (await returnClaimed(tx, si.id)) > si.quantity)
        throw new Error(
          "Return exceeds delivered units after prior returns and open authorizations",
        );
      const [line] = await tx
        .select()
        .from(s.saleItems)
        .where(eq(s.saleItems.id, si.saleItemId));
      const [variant] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, line.variantId));
      const [deliveredItem] = await tx
        .select({ label: s.deliveryItems.productSnapshot })
        .from(s.deliveryItems)
        .innerJoin(
          s.deliveryOrders,
          eq(s.deliveryItems.deliveryId, s.deliveryOrders.id),
        )
        .where(
          and(
            eq(s.deliveryOrders.shipmentId, ship.id),
            eq(s.deliveryItems.saleItemId, line.id),
          ),
        );
      await tx.insert(s.returnItems).values({
        ...l,
        returnId: rma.id,
        productSnapshot:
          deliveredItem?.label ??
          `${variant.sku} · ${variant.size} / ${variant.color}`,
      });
    }
    await tx.insert(s.returnEvents).values({
      returnId: rma.id,
      action: "Requested",
      notes: v.notes,
      createdBy: c.actorId,
    });
    return;
  }
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const [rma] = await tx
    .select()
    .from(s.returnOrders)
    .where(eq(s.returnOrders.id, id))
    .for("update");
  if (!rma) throw new Error("Return authorization not found");
  const event = async (action: string, notes: string) =>
    tx
      .insert(s.returnEvents)
      .values({ returnId: id, action, notes, createdBy: c.actorId });
  if (["approveReturn", "rejectReturn", "cancelReturn"].includes(action)) {
    const { notes: note } = z.object({ notes }).parse(input);
    if (
      (action === "approveReturn" && rma.status !== "Requested") ||
      (action !== "approveReturn" &&
        !["Requested", "Approved"].includes(rma.status))
    )
      throw new Error("Return is not eligible for this review action");
    const items = await tx
      .select()
      .from(s.returnItems)
      .where(eq(s.returnItems.returnId, id));
    for (const l of items)
      if ((await receivedQty(tx, l.id)) > 0)
        throw new Error("Received goods cannot be cancelled or rejected");
    const status =
      action === "approveReturn"
        ? "Approved"
        : action === "rejectReturn"
          ? "Rejected"
          : "Cancelled";
    await tx
      .update(s.returnOrders)
      .set({
        status,
        ...(status === "Approved" ? { approvedBy: c.actorId } : {}),
      })
      .where(eq(s.returnOrders.id, id));
    await event(status, note);
    return;
  }
  if (action === "receiveReturn") {
    if (!["Approved", "Receiving"].includes(rma.status) || rma.intakeClosed)
      throw new Error("Return must be approved with intake still open");
    const v = z
      .object({
        returnItemId: z.uuid(),
        quantity: qty,
        actualVariantId: z.uuid().optional().or(z.literal("")),
        reference,
        notes,
      })
      .parse(input);
    const [l] = await tx
      .select()
      .from(s.returnItems)
      .where(
        and(
          eq(s.returnItems.id, v.returnItemId),
          eq(s.returnItems.returnId, id),
        ),
      );
    if (!l || v.quantity + (await receivedQty(tx, l.id)) > l.quantity)
      throw new Error("Receipt exceeds authorized return quantity");
    const { line } = await origin(tx, l);
    const [original] = await tx
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, line.variantId));
    const [actual] = await tx
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, v.actualVariantId || line.variantId));
    if (
      !actual ||
      (actual.id !== original.id &&
        l.reason !== "Incorrect delivery" &&
        (!["Incorrect size", "Incorrect color"].includes(l.reason) ||
          actual.productId !== original.productId))
    )
      throw new Error(
        "Observed return SKU differs from the approved reason; sales must authorize the incorrect delivery/size/color first",
      );
    await tx.insert(s.returnReceipts).values({
      ...v,
      actualVariantId: actual.id,
      actualProductSnapshot: `${actual.sku} · ${actual.size} / ${actual.color}`,
      createdBy: c.actorId,
    });
    await tx
      .update(s.returnOrders)
      .set({ status: "Receiving" })
      .where(eq(s.returnOrders.id, id));
    await event(
      "Received pending inspection",
      `${v.reference}: ${v.quantity} units. ${v.notes}`,
    );
    return;
  }
  if (action === "inspectReturn") {
    const v = z
      .object({
        receiptId: z.uuid(),
        sellable: count,
        quarantined: count,
        condition: z.enum([
          "Unworn / sellable",
          "Damaged",
          "Manufacturing defect",
          "Used / needs review",
        ]),
        notes,
      })
      .parse(input);
    const [receipt] = await tx
      .select()
      .from(s.returnReceipts)
      .where(eq(s.returnReceipts.id, v.receiptId));
    const [l] = receipt
      ? await tx
          .select()
          .from(s.returnItems)
          .where(
            and(
              eq(s.returnItems.id, receipt.returnItemId),
              eq(s.returnItems.returnId, id),
            ),
          )
      : [];
    if (!receipt || !l || v.sellable + v.quarantined !== receipt.quantity)
      throw new Error(
        "Inspection must account for every physically received unit",
      );
    if (v.sellable > 0 && v.condition !== "Unworn / sellable")
      throw new Error(
        "Only sellable-condition goods can be restocked; quarantine the rest",
      );
    if (
      (
        await tx
          .select()
          .from(s.returnInspections)
          .where(eq(s.returnInspections.receiptId, receipt.id))
      ).length
    )
      throw new Error("Receipt has already been inspected");
    const m = v.sellable
      ? await c.post(
          await c.balance(receipt.actualVariantId),
          v.sellable,
          "RMA inspection: sellable return restocked",
          receipt.id,
        )
      : undefined;
    await tx
      .insert(s.returnInspections)
      .values({ ...v, movementId: m?.id, createdBy: c.actorId });
    await event(
      "Inspected",
      `${v.sellable} restocked, ${v.quarantined} quarantined. ${v.notes}`,
    );
    await updateReturnState(tx, id);
    return;
  }
  if (action === "closeReturnIntake") {
    if (rma.status !== "Receiving")
      throw new Error("Only open received returns can close intake");
    const { notes: note } = z.object({ notes }).parse(input);
    const items = await tx
      .select()
      .from(s.returnItems)
      .where(eq(s.returnItems.returnId, id));
    for (const l of items)
      if ((await receivedQty(tx, l.id)) !== (await inspectedQty(tx, l.id)))
        throw new Error("Inspect every received unit before closing intake");
    await tx
      .update(s.returnOrders)
      .set({ intakeClosed: true, status: "Inspected" })
      .where(eq(s.returnOrders.id, id));
    await event("Intake closed", note);
    await updateReturnState(tx, id);
    return;
  }
  if (action === "dispositionReturnQuarantine") {
    const v = z
      .object({
        inspectionId: z.uuid(),
        kind: z.enum(["Restock", "Scrap"]),
        quantity: qty,
        reference,
        notes,
      })
      .parse(input);
    const [i] = await tx
      .select()
      .from(s.returnInspections)
      .where(eq(s.returnInspections.id, v.inspectionId));
    const [receipt] = i
      ? await tx
          .select()
          .from(s.returnReceipts)
          .where(eq(s.returnReceipts.id, i.receiptId))
      : [];
    const [l] = receipt
      ? await tx
          .select()
          .from(s.returnItems)
          .where(
            and(
              eq(s.returnItems.id, receipt.returnItemId),
              eq(s.returnItems.returnId, id),
            ),
          )
      : [];
    if (!i || !l) throw new Error("Quarantine item not found for this return");
    const previous = await tx
      .select()
      .from(s.returnQuarantineDispositions)
      .where(eq(s.returnQuarantineDispositions.inspectionId, i.id));
    if (
      previous.reduce((q, p) => q + p.quantity, 0) + v.quantity >
      i.quarantined
    )
      throw new Error("Disposition exceeds quarantined quantity");
    const m =
      v.kind === "Restock"
        ? await c.post(
            await c.balance(receipt.actualVariantId),
            v.quantity,
            "RMA quarantine released after reinspection",
            i.id,
          )
        : undefined;
    await tx
      .insert(s.returnQuarantineDispositions)
      .values({ ...v, movementId: m?.id, createdBy: c.actorId });
    await event(
      "Quarantine disposition",
      `${v.kind}: ${v.quantity}. ${v.notes}`,
    );
    return;
  }
  if (action === "requestReturnSettlement") {
    const v = z
      .object({
        returnItemId: z.uuid(),
        kind: z.enum(["Credit", "Refund", "Exchange", "Replacement"]),
        quantity: qty,
        replacementVariantId: z.uuid().optional().or(z.literal("")),
        notes,
      })
      .parse(input);
    const [l] = await tx
      .select()
      .from(s.returnItems)
      .where(
        and(
          eq(s.returnItems.id, v.returnItemId),
          eq(s.returnItems.returnId, id),
        ),
      );
    if (!l) throw new Error("Return line not found");
    const existing = await tx
      .select()
      .from(s.returnSettlements)
      .where(eq(s.returnSettlements.returnItemId, l.id));
    if (
      existing
        .filter((e) => e.status !== "Rejected")
        .reduce((q, e) => q + e.quantity, 0) +
        v.quantity >
      (await inspectedQty(tx, l.id))
    )
      throw new Error(
        "Commercial request exceeds inspected units not already assigned a resolution",
      );
    const { line } = await origin(tx, l);
    if (["Exchange", "Replacement"].includes(v.kind)) {
      const [target] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, v.replacementVariantId || randomUUID()));
      const [original] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, line.variantId));
      if (
        !target ||
        target.productId !== original.productId ||
        (v.kind === "Replacement" && target.id !== original.id)
      )
        throw new Error(
          "Replacement must use the original variant; size/color exchange must use a variant of the same product",
        );
      const [p] = await tx
        .select()
        .from(s.products)
        .where(eq(s.products.id, target.productId));
      if (!p.active) throw new Error("Replacement product is archived");
    } else if (v.replacementVariantId)
      throw new Error(
        "Financial resolutions cannot include a replacement variant",
      );
    const estimate = ["Credit", "Refund"].includes(v.kind)
      ? await returnCreditAmount(tx, rma.invoiceId, line.id, v.quantity)
      : "0.00";
    await tx.insert(s.returnSettlements).values({
      ...v,
      replacementVariantId: v.replacementVariantId || null,
      amount: estimate,
      createdBy: c.actorId,
    });
    await event(
      "Commercial request",
      `${v.kind}: ${v.quantity} units. ${v.notes}`,
    );
    return;
  }
  if (
    [
      "approveReturnSettlement",
      "rejectReturnSettlement",
      "processReturnSettlement",
    ].includes(action)
  ) {
    const v = z
      .object({
        settlementId: z.uuid(),
        notes,
        reference: reference.optional().or(z.literal("")),
      })
      .parse(input);
    const [q] = await tx
      .select()
      .from(s.returnSettlements)
      .where(eq(s.returnSettlements.id, v.settlementId))
      .for("update");
    const [l] = q
      ? await tx
          .select()
          .from(s.returnItems)
          .where(
            and(
              eq(s.returnItems.id, q.returnItemId),
              eq(s.returnItems.returnId, id),
            ),
          )
      : [];
    if (!q || !l) throw new Error("Commercial request not found");
    if (action !== "processReturnSettlement") {
      if (!["Requested", "Approved"].includes(q.status))
        throw new Error("Only pending commercial requests can be reviewed");
      const status =
        action === "approveReturnSettlement" ? "Approved" : "Rejected";
      await tx
        .update(s.returnSettlements)
        .set({
          status,
          ...(status === "Approved" ? { approvedBy: c.actorId } : {}),
        })
        .where(eq(s.returnSettlements.id, q.id));
      await event(`Commercial ${status}`, v.notes);
      return;
    }
    if (q.status !== "Approved")
      throw new Error("Approve the commercial request before processing");
    const { line } = await origin(tx, l);
    let replacementOrderId: string | undefined,
      amount = q.amount;
    if (["Credit", "Refund"].includes(q.kind)) {
      amount = await returnCreditAmount(tx, rma.invoiceId, line.id, q.quantity);
      const p = await invoiceReturnPosition(tx, rma.invoiceId);
      if (q.kind === "Refund" && n(amount).gt(0) && (n(p.due).gt(0) || !v.reference))
        throw new Error(
          "Cash refunds require a fully settled invoice and an externally paid refund reference; otherwise issue credit",
        );
      await tx.insert(s.returnCreditNotes).values({
        number: `CN-${randomUUID().slice(0, 12).toUpperCase()}`,
        settlementId: q.id,
        invoiceId: rma.invoiceId,
        saleItemId: line.id,
        quantity: q.quantity,
        amount,
        createdBy: c.actorId,
      });
      if (q.kind === "Refund" && n(amount).gt(0)) {
        const after = await invoiceReturnPosition(tx, rma.invoiceId);
        if (n(amount).gt(after.creditBalance))
          throw new Error(
            "Refund exceeds the customer's available credit balance",
          );
        await tx.insert(s.returnRefunds).values({
          returnId: id,
          invoiceId: rma.invoiceId,
          reference: v.reference!,
          amount,
          notes: v.notes,
          createdBy: c.actorId,
        });
      }
      await refreshInvoice(tx, rma.invoiceId);
    } else {
      const [target] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, q.replacementVariantId!));
      const [original] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, line.variantId));
      const [product] = target
        ? await tx
            .select()
            .from(s.products)
            .where(eq(s.products.id, target.productId))
        : [];
      if (
        !target ||
        !product?.active ||
        target.productId !== original.productId ||
        (q.kind === "Replacement" && target.id !== original.id)
      )
        throw new Error(
          "Replacement variant is no longer eligible; reject this request and select a valid resolution",
        );
      const [sale] = await tx
        .select()
        .from(s.sales)
        .where(eq(s.sales.id, rma.orderId));
      const [order] = await tx
        .insert(s.sales)
        .values({
          number: `SO-${randomUUID().slice(0, 12).toUpperCase()}`,
          customerId: sale.customerId,
          currency: sale.currency,
          total: "0",
          pricingApprovedBy: c.actorId,
        })
        .returning();
      replacementOrderId = order.id;
      await tx.insert(s.saleItems).values({
        orderId: order.id,
        variantId: q.replacementVariantId!,
        quantity: q.quantity,
        price: "0",
        discount: "0",
        pricingSnapshot: {
          source: "Approved RMA replacement",
          returnId: id,
          settlementId: q.id,
          originalSaleItemId: line.id,
          invoiceId: rma.invoiceId,
        },
      });
    }
    await tx
      .update(s.returnSettlements)
      .set({
        status: "Processed",
        amount,
        ...(replacementOrderId ? { replacementOrderId } : {}),
      })
      .where(eq(s.returnSettlements.id, q.id));
    await event(
      "Commercial processed",
      `${q.kind}: ${q.quantity} units. ${v.notes}`,
    );
    await updateReturnState(tx, id);
    return;
  }
  if (action === "recordReturnRefund") {
    const v = z
      .object({
        amount: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,2})?$/)
          .refine((v) => n(v).gt(0)),
        reference,
        notes,
      })
      .parse(input);
    const p = await invoiceReturnPosition(tx, rma.invoiceId);
    if (n(v.amount).gt(p.creditBalance))
      throw new Error("Refund exceeds the customer's remaining credit balance");
    await tx.insert(s.returnRefunds).values({
      ...v,
      returnId: id,
      invoiceId: rma.invoiceId,
      createdBy: c.actorId,
    });
    await refreshInvoice(tx, rma.invoiceId);
    await event(
      "External refund recorded",
      `${v.reference}: ${v.amount}. ${v.notes}`,
    );
    return;
  }
  throw new Error("Unknown return action");
}
