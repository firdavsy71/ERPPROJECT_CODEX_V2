import { describe, expect, it } from "vitest";
import { assertTransferAction, planTransferDispatch, planTransferReceipt, type TransferBalance } from "../src/services/transfers";

const source = "00000000-0000-4000-8000-000000000001";
const destination = "00000000-0000-4000-8000-000000000002";
const balanceId = "00000000-0000-4000-8000-000000000003";
const itemId = "00000000-0000-4000-8000-000000000004";
const materialId = "00000000-0000-4000-8000-000000000005";
const balance: TransferBalance = { id: balanceId, warehouseId: source, materialId, variantId: null, onHand: "100", reserved: "20", held: "30", rollTracked: false };
const dispatch = (quantity: string, stock = balance) => planTransferDispatch({ sourceWarehouseId: source, destinationWarehouseId: destination, lines: [{ balanceId, quantity }] }, [stock]);

describe("two-stage transfer planning safeguards", () => {
  it("excludes quality holds and production reservations from dispatch availability", () => {
    expect(dispatch("50").lines[0].quantity).toBe("50.0000");
    expect(() => dispatch("50.0001")).toThrow("unreserved");
    expect(() => dispatch("1", { ...balance, warehouseId: destination })).toThrow("source warehouse");
    expect(() => planTransferDispatch({ sourceWarehouseId: source, destinationWarehouseId: source, lines: [{ balanceId, quantity: "1" }] }, [balance])).toThrow("must differ");
  });
  it("prevents duplicate lines, fractional garments and unsupported roll traceability", () => {
    expect(() => dispatch("1", { ...balance, rollTracked: true })).toThrow("traceability");
    expect(() => dispatch("0.5", { ...balance, materialId: null, variantId: materialId })).toThrow("whole units");
    expect(() => planTransferDispatch({ sourceWarehouseId: source, destinationWarehouseId: destination, lines: [{ balanceId, quantity: "1" }, { balanceId, quantity: "1" }] }, [balance])).toThrow("only once");
  });
  it("tracks exact partial receipts and refuses over-receipt or reused references", () => {
    const partial = planTransferReceipt("Dispatched", { reference: " GRN-1 ", lines: [{ itemId, quantity: "0.1001" }] }, [{ id: itemId, quantity: "0.3003", received: "0" }], []);
    expect(partial.status).toBe("Partially Received");
    expect(partial.lines[0].outstanding).toBe("0.2002");
    const complete = planTransferReceipt(partial.status, { reference: "GRN-2", lines: [{ itemId, quantity: "0.2002" }] }, [{ id: itemId, quantity: "0.3003", received: partial.lines[0].received }], [partial.reference]);
    expect(complete.status).toBe("Received");
    expect(complete.lines[0].received).toBe("0.3003");
    expect(() => planTransferReceipt("Partially Received", { reference: "grn-1", lines: [{ itemId, quantity: "0.1" }] }, [{ id: itemId, quantity: "1", received: "0" }], [" GRN-1 "])).toThrow("already");
    expect(() => planTransferReceipt("Dispatched", { reference: "GRN-3", lines: [{ itemId, quantity: "2" }] }, [{ id: itemId, quantity: "1", received: "0" }], [])).toThrow("exceeds");
  });
  it("permits cancellation only before dispatch and rejects duplicate dispatch/completed receipts", () => {
    expect(() => assertTransferAction("Draft", "cancel")).not.toThrow();
    for (const status of ["Dispatched", "Partially Received", "Received"] as const)
      expect(() => assertTransferAction(status, "cancel")).toThrow("cannot restore");
    expect(() => assertTransferAction("Dispatched", "dispatch")).toThrow("Only draft");
    expect(() => assertTransferAction("Received", "receive")).toThrow("Only dispatched");
    expect(() => assertTransferAction("Cancelled", "receive")).toThrow();
  });
});
