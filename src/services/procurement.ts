import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { amount } from "@/lib/validation";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const d = (value: Decimal.Value) => new D(value);
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const qty = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);
const note = z.string().trim().min(1).max(2000);
type Item = typeof s.purchaseReceiptItems.$inferSelect;
type Context = {
  actorId: string;
  reject: (item: Item, quantity: string, rollId?: string) => Promise<string>;
};

/** Allocate each expense by received supplier value, with cumulative cent rounding. */
export function allocateByValue(
  amount: string,
  items: { id: string; quantity: string; unitPrice: string }[],
) {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const bases = sorted.map((i) =>
    d(i.quantity).mul(i.unitPrice).toDecimalPlaces(2),
  );
  const total = bases.reduce((a, b) => a.add(b), d(0));
  if (total.lte(0))
    throw new Error(
      "Positive known received supplier value is required for cost allocation.",
    );
  let cumulative = d(0),
    prior = d(0);
  return sorted.map((item, index) => {
    cumulative = cumulative.add(bases[index]);
    const allocated = d(amount).mul(cumulative).div(total).toDecimalPlaces(2);
    const result = {
      receiptItemId: item.id,
      amount: allocated.minus(prior).toFixed(2),
    };
    prior = allocated;
    return result;
  });
}
export async function procurementAction(
  tx: Tx,
  action: string,
  input: unknown,
  c: Context,
) {
  if (action === "recordProcurementExpense") {
    const v = z
      .object({
        receiptId: z.uuid(),
        kind: z.enum(["Freight", "Customs", "Handling", "Other"]),
        reference: z.string().trim().min(1).max(200),
        amount: amount.refine((v) => d(v).gt(0)),
        notes: note,
      })
      .parse(input);
    const [receipt] = await tx
      .select()
      .from(s.receipts)
      .where(eq(s.receipts.id, v.receiptId))
      .for("update");
    if (!receipt) throw new Error("Receipt not found.");
    const [order] = await tx
      .select()
      .from(s.purchases)
      .where(eq(s.purchases.id, receipt.orderId));
    const items = await tx
      .select()
      .from(s.purchaseReceiptItems)
      .where(eq(s.purchaseReceiptItems.receiptId, receipt.id));
    if (
      !items.length ||
      items.some((i) => i.unitPrice === null || i.currency !== order.currency)
    )
      throw new Error(
        "All receipt lines need verified original prices in the order currency.",
      );
    const allocations = allocateByValue(
      v.amount,
      items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice!,
      })),
    );
    const [expense] = await tx
      .insert(s.procurementExpenses)
      .values({
        receiptId: receipt.id,
        kind: v.kind,
        reference: v.reference,
        amount: v.amount,
        currency: order.currency,
        notes: v.notes,
        actorId: c.actorId,
      })
      .returning();
    await tx
      .insert(s.procurementAllocations)
      .values(allocations.map((a) => ({ ...a, expenseId: expense.id })));
    return;
  }
  const { receiptItemId } = z.object({ receiptItemId: z.uuid() }).parse(input);
  const [item] = await tx
    .select()
    .from(s.purchaseReceiptItems)
    .where(eq(s.purchaseReceiptItems.id, receiptItemId))
    .for("update");
  if (!item) throw new Error("Receipt line not found.");
  const [receipt] = await tx
    .select()
    .from(s.receipts)
    .where(eq(s.receipts.id, item.receiptId));
  const [order] = await tx
    .select()
    .from(s.purchases)
    .where(eq(s.purchases.id, receipt.orderId));
  if (action === "recordSupplierIncident") {
    const v = z.object({ description: note }).parse(input);
    await tx
      .insert(s.supplierIncidents)
      .values({
        supplierId: order.supplierId,
        receiptItemId: item.id,
        description: v.description,
        actorId: c.actorId,
      });
  } else if (action === "inspectProcurement") {
    const v = z
      .object({
        accepted: qty,
        rejected: qty,
        rollId: z.uuid().optional().or(z.literal("")),
        notes: note,
      })
      .parse(input);
    const inspected = await tx
      .select()
      .from(s.procurementInspections)
      .where(eq(s.procurementInspections.receiptItemId, item.id));
    const previous = inspected.reduce(
      (sum, i) => sum.add(i.accepted).add(i.rejected),
      d(0),
    );
    const total = d(v.accepted).add(v.rejected);
    if (total.lte(0) || previous.add(total).gt(item.quantity))
      throw new Error(
        "Inspection quantities exceed the uninspected received quantity.",
      );
    if (d(v.rejected).isZero() && v.rollId)
      throw new Error("Choose a roll only when rejecting material.");
    const movementId = d(v.rejected).gt(0)
      ? await c.reject(item, v.rejected, v.rollId || undefined)
      : null;
    const [inspection] = await tx
      .insert(s.procurementInspections)
      .values({
        receiptItemId: item.id,
        accepted: v.accepted,
        rejected: v.rejected,
        notes: v.notes,
        rollId: v.rollId || null,
        movementId,
        actorId: c.actorId,
      })
      .returning();
    if (d(v.rejected).gt(0))
      await tx
        .insert(s.supplierIncidents)
        .values({
          supplierId: order.supplierId,
          receiptItemId: item.id,
          inspectionId: inspection.id,
          description: v.notes,
          actorId: c.actorId,
        });
  } else throw new Error("Unknown procurement action.");
}
export function receiptLineCost(
  item: Item,
  allocations: { receiptItemId: string; amount: string }[],
) {
  if (item.unitPrice === null) return null;
  const base = d(item.quantity).mul(item.unitPrice).toDecimalPlaces(2);
  const expenses = allocations
    .filter((a) => a.receiptItemId === item.id)
    .reduce((sum, a) => sum.add(a.amount), d(0));
  return {
    base: base.toFixed(2),
    expenses: expenses.toFixed(2),
    landed: base.add(expenses).toFixed(2),
    landedPerUnit: base.add(expenses).div(item.quantity).toFixed(4),
  };
}
export function inspectionTotals(
  item: Item,
  inspections: { receiptItemId: string; accepted: string; rejected: string }[],
) {
  const rows = inspections.filter((i) => i.receiptItemId === item.id);
  const accepted = rows.reduce((n, i) => n.add(i.accepted), d(0));
  const rejected = rows.reduce((n, i) => n.add(i.rejected), d(0));
  return {
    accepted: accepted.toFixed(4),
    rejected: rejected.toFixed(4),
    uninspected: d(item.quantity).minus(accepted).minus(rejected).toFixed(4),
  };
}
