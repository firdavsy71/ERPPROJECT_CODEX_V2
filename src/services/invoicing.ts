import Decimal from "decimal.js";
import { z } from "zod";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
const lineSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().positive().max(2147483647),
  subtotal: money,
  billedQuantity: z.number().int().nonnegative(),
  billQuantity: z.number().int().nonnegative(),
});

export type InvoiceAllocationLine = z.infer<typeof lineSchema>;
export type InvoicePortion = {
  lines: { id: string; quantity: number; subtotal: string; tax: string; total: string }[];
  subtotal: string;
  tax: string;
  total: string;
};

/**
 * Monetary calculation only: callers must obtain quantities from persisted
 * shipment allocations under the sales-order lock. This does not issue invoices.
 * Every call supplies the complete frozen order, including lines billed earlier.
 */
export function allocateInvoicePortion(input: {
  orderSubtotal: string;
  taxRate: string;
  lines: InvoiceAllocationLine[];
}): InvoicePortion {
  const v = z.object({
    orderSubtotal: money,
    taxRate: money.refine((rate) => new D(rate).lte(100), "Tax rate cannot exceed 100"),
    lines: z.array(lineSchema).min(1),
  }).parse(input);
  const lines = [...v.lines].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(lines.map((line) => line.id)).size !== lines.length)
    throw new Error("Invoice allocation contains duplicate sales lines");
  const orderSubtotal = new D(v.orderSubtotal);
  if (!lines.reduce((sum, line) => sum.add(line.subtotal), new D(0)).eq(orderSubtotal))
    throw new Error("Frozen sales-line amounts do not reconcile with the order subtotal");
  const orderTax = orderSubtotal.mul(v.taxRate).div(100).toDecimalPlaces(2);
  let cumulativeBase = new D(0), priorTax = new D(0);
  const result: InvoicePortion["lines"] = [];
  for (const line of lines) {
    const endQuantity = line.billedQuantity + line.billQuantity;
    if (endQuantity > line.quantity)
      throw new Error("Invoice quantity exceeds original sales-line quantity");
    cumulativeBase = cumulativeBase.add(line.subtotal);
    const cumulativeTax = orderSubtotal.isZero()
      ? new D(0)
      : orderTax.mul(cumulativeBase).div(orderSubtotal).toDecimalPlaces(2);
    const lineTax = cumulativeTax.minus(priorTax);
    priorTax = cumulativeTax;
    if (!line.billQuantity) continue;
    const portion = (amount: Decimal.Value) => new D(amount)
      .mul(endQuantity).div(line.quantity).toDecimalPlaces(2)
      .minus(new D(amount).mul(line.billedQuantity).div(line.quantity).toDecimalPlaces(2));
    const subtotal = portion(line.subtotal), tax = portion(lineTax);
    result.push({ id: line.id, quantity: line.billQuantity,
      subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: subtotal.add(tax).toFixed(2) });
  }
  if (!result.length) throw new Error("Select at least one unit to invoice");
  const subtotal = result.reduce((sum, line) => sum.add(line.subtotal), new D(0));
  const tax = result.reduce((sum, line) => sum.add(line.tax), new D(0));
  return { lines: result, subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: subtotal.add(tax).toFixed(2) };
}
