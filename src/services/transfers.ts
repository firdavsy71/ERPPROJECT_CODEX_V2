import Decimal from "decimal.js";
import { z } from "zod";
import { quantity } from "@/lib/validation";

const Arithmetic = Decimal.clone({ precision: 40 });
const n = (value: Decimal.Value) => new Arithmetic(value);
export type TransferStatus = "Draft" | "Dispatched" | "Partially Received" | "Received" | "Cancelled";
export type TransferBalance = {
  id: string;
  warehouseId: string;
  materialId: string | null;
  variantId: string | null;
  onHand: string;
  reserved: string;
  held: string;
  rollTracked: boolean;
};
export type TransferLine = { id: string; quantity: string; received: string };

/** Pure guards for the future posting adapter. These helpers never change stock. */
export function assertTransferAction(status: TransferStatus, action: "dispatch" | "receive" | "cancel") {
  if (action === "dispatch" && status !== "Draft")
    throw new Error("Only draft transfers can be dispatched.");
  if (action === "cancel" && status !== "Draft")
    throw new Error("Dispatched goods require a documented receipt or reverse transfer; cancellation cannot restore stock.");
  if (action === "receive" && !["Dispatched", "Partially Received"].includes(status))
    throw new Error("Only dispatched transfers can be received.");
}

export function planTransferDispatch(input: unknown, balances: TransferBalance[]) {
  const v = z.object({
    sourceWarehouseId: z.uuid(),
    destinationWarehouseId: z.uuid(),
    lines: z.array(z.object({ balanceId: z.uuid(), quantity })).min(1).max(100),
  }).parse(input);
  if (v.sourceWarehouseId === v.destinationWarehouseId)
    throw new Error("Source and destination warehouses must differ.");
  if (new Set(v.lines.map(line => line.balanceId)).size !== v.lines.length)
    throw new Error("Each source stock balance must appear only once.");
  const planned = v.lines.map(line => {
    const balance = balances.find(b => b.id === line.balanceId);
    if (!balance || balance.warehouseId !== v.sourceWarehouseId)
      throw new Error("Select stock from the source warehouse.");
    if (Boolean(balance.materialId) === Boolean(balance.variantId))
      throw new Error("A source stock balance must identify exactly one material or product variant.");
    if (balance.rollTracked)
      throw new Error("Roll-tracked transfers require the segment traceability posting adapter.");
    if (balance.variantId && !n(line.quantity).isInteger())
      throw new Error("Finished garment quantities must be whole units.");
    const available = n(balance.onHand).minus(balance.reserved).minus(balance.held);
    if (available.lt(line.quantity))
      throw new Error("Transfer quantity exceeds unreserved, released stock.");
    return { balanceId: balance.id, materialId: balance.materialId, variantId: balance.variantId, quantity: n(line.quantity).toFixed(4) };
  });
  return { sourceWarehouseId: v.sourceWarehouseId, destinationWarehouseId: v.destinationWarehouseId, lines: planned };
}

export function planTransferReceipt(
  status: TransferStatus,
  input: unknown,
  lines: TransferLine[],
  priorReferences: string[],
) {
  assertTransferAction(status, "receive");
  const v = z.object({
    reference: z.string().trim().min(1).max(200),
    lines: z.array(z.object({ itemId: z.uuid(), quantity })).min(1).max(100),
  }).parse(input);
  const reference = v.reference.toUpperCase();
  if (priorReferences.some(prior => prior.trim().toUpperCase() === reference))
    throw new Error("This transfer receipt reference has already been recorded.");
  if (new Set(v.lines.map(line => line.itemId)).size !== v.lines.length)
    throw new Error("Each transfer line must appear only once per receipt.");
  const received = new Map(lines.map(line => [line.id, n(line.received)]));
  for (const row of v.lines) {
    const line = lines.find(line => line.id === row.itemId);
    if (!line) throw new Error("Select a line from this transfer.");
    const cumulative = n(line.received).add(row.quantity);
    if (cumulative.gt(line.quantity))
      throw new Error("Receipt exceeds the outstanding transferred quantity.");
    received.set(line.id, cumulative);
  }
  const totals = lines.map(line => ({
    id: line.id,
    received: received.get(line.id)!.toFixed(4),
    outstanding: n(line.quantity).minus(received.get(line.id)!).toFixed(4),
  }));
  const nextStatus: TransferStatus = totals.every(line => n(line.outstanding).isZero()) ? "Received" : "Partially Received";
  return { reference, status: nextStatus, lines: totals, receiptLines: v.lines.map(line => ({ ...line, quantity: n(line.quantity).toFixed(4) })) };
}
