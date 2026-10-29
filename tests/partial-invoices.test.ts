import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { allocateInvoicePortion, type InvoiceAllocationLine } from "../src/services/invoicing";

describe("partial invoice cumulative monetary allocation (not invoice issuance)", () => {
  it("allocates merchandise plus frozen branding and tax cents across three separate invoices", () => {
    const amounts = [0, 1, 2].map((billedQuantity) => allocateInvoicePortion({
      orderSubtotal: "0.16", taxRate: "12",
      lines: [{ id: "jacket", quantity: 3, subtotal: "0.16", billedQuantity, billQuantity: 1 }],
    }));
    expect(amounts.map((p) => p.subtotal)).toEqual(["0.05", "0.06", "0.05"]);
    expect(amounts.map((p) => p.tax)).toEqual(["0.01", "0.00", "0.01"]);
    expect(amounts.reduce((sum, p) => sum.add(p.total), new Decimal(0)).toFixed(2)).toBe("0.18");
  });

  it("preserves the same whole-order total regardless of invoice grouping and input line order", () => {
    const order: InvoiceAllocationLine[] = [
      { id: "b", quantity: 7, subtotal: "100.01", billedQuantity: 0, billQuantity: 0 },
      { id: "a", quantity: 3, subtotal: "10.00", billedQuantity: 0, billQuantity: 0 },
    ];
    const first = allocateInvoicePortion({ orderSubtotal: "110.01", taxRate: "12", lines: order.map(l => ({ ...l, billQuantity: 1 })) });
    const rest = allocateInvoicePortion({ orderSubtotal: "110.01", taxRate: "12", lines: [...order].reverse().map(l => ({ ...l, billedQuantity: 1, billQuantity: l.quantity - 1 })) });
    const all = allocateInvoicePortion({ orderSubtotal: "110.01", taxRate: "12", lines: order.map(l => ({ ...l, billQuantity: l.quantity })) });
    for (const key of ["subtotal", "tax", "total"] as const)
      expect(new Decimal(first[key]).add(rest[key]).toFixed(2)).toBe(all[key]);
    expect(all.total).toBe("123.21");
    expect([...first.lines, ...rest.lines].every(l => new Decimal(l.tax).gte(0))).toBe(true);
  });

  it("supports zero-priced and fully discounted orders without fabricating tax or payments", () => {
    const portion = allocateInvoicePortion({ orderSubtotal: "0", taxRate: "12", lines: [{ id: "replacement", subtotal: "0", quantity: 2, billedQuantity: 1, billQuantity: 1 }] });
    expect(portion).toMatchObject({ subtotal: "0.00", tax: "0.00", total: "0.00" });
  });

  it("rejects overbilling, inconsistent snapshots, duplicates and empty allocations", () => {
    const base = { orderSubtotal: "10", taxRate: "12", lines: [{ id: "a", subtotal: "10", quantity: 2, billedQuantity: 0, billQuantity: 1 }] };
    expect(() => allocateInvoicePortion({ ...base, lines: [{ ...base.lines[0], billedQuantity: 2 }] })).toThrow("exceeds");
    expect(() => allocateInvoicePortion({ ...base, orderSubtotal: "11" })).toThrow("reconcile");
    expect(() => allocateInvoicePortion({ ...base, lines: [...base.lines, ...base.lines] })).toThrow("duplicate");
    expect(() => allocateInvoicePortion({ ...base, lines: [{ ...base.lines[0], billQuantity: 0 }] })).toThrow("at least");
    expect(() => allocateInvoicePortion({ ...base, taxRate: "101" })).toThrow();
    expect(() => allocateInvoicePortion({ ...base, lines: [{ ...base.lines[0], billQuantity: -1 }] })).toThrow();
  });

  it("keeps large monetary inputs exact without IEEE754 loss", () => {
    expect(allocateInvoicePortion({ orderSubtotal: "90071992547409.91", taxRate: "0", lines: [{ id: "a", subtotal: "90071992547409.91", quantity: 1, billedQuantity: 0, billQuantity: 1 }] }).total).toBe("90071992547409.91");
  });
});
