import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import * as s from "../src/db/schema";
import type { Actor } from "../src/lib/permissions";

const mocks = vi.hoisted(() => ({ actor: null as Actor | null, db: vi.fn(), position: vi.fn() }));
vi.mock("@/auth", () => ({ currentActor: async () => mocks.actor }));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/services/returns", () => ({ invoiceReturnPosition: mocks.position }));
vi.mock("@/components/forms", () => ({ ActionForm: () => null }));
vi.mock("@/components/data-table", () => ({ DataTable: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, redirect: () => { throw new Error("login"); } }));
import Page from "../src/app/(erp)/returns/[id]/page";

const id = "00000000-0000-4000-8000-000000000001";
const serialize = (tree: React.ReactNode) => JSON.stringify(tree, (_key, value) =>
  React.isValidElement(value) ? value.props : value,
);
let queried: unknown[];
beforeEach(() => {
  vi.stubGlobal("React", React);
  queried = [];
  mocks.position.mockReset().mockResolvedValue({ credited: "777.77", refunded: "777.77", due: "777.77", creditBalance: "777.77" });
  const rows = new Map<unknown, Record<string, unknown>[]>([
    [s.returnOrders, [{ id, invoiceId: id, orderId: id, number: "RMA", status: "Receiving", intakeClosed: false }]],
    [s.returnItems, [{ id, returnId: id, quantity: 1, productSnapshot: "Jacket" }]],
    [s.returnSettlements, [{ id, returnItemId: id, status: "Requested", kind: "Credit", quantity: 1, amount: "777.77", notes: "PRIVATE-BANK" }]],
    [s.returnEvents, [{ id, action: "Refund recorded", notes: "PRIVATE-BANK", createdAt: new Date() }]],
    [s.invoices, [{ number: "INV" }]], [s.sales, [{ number: "SO", currency: "UZS" }]],
    [s.returnCreditNotes, [{ number: "CN", amount: "777.77", createdAt: new Date() }]],
    [s.returnRefunds, [{ reference: "PRIVATE-BANK", amount: "777.77", createdAt: new Date() }]],
  ]);
  mocks.db.mockImplementation(() => ({
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      queried.push(table);
      const values = (rows.get(table) ?? []).map(row => fields ? Object.fromEntries(Object.keys(fields).map(key => [key, row[key]])) : row);
      const result = Promise.resolve(values);
      return Object.assign(result, { where: () => result, orderBy: () => result });
    } }),
  }));
});

it.each(["production", "inventory"] as const)("keeps operational return access without financial queries or client props for %s", async role => {
  mocks.actor = { id, role };
  const tree = await Page({ params: Promise.resolve({ id }) });
  const serialized = serialize(tree);
  expect(serialized).toContain("Authorized, received and inspected quantities");
  expect(serialized).toContain("Commercial resolution");
  expect(serialized).not.toContain("777.77");
  expect(serialized).not.toContain("PRIVATE-BANK");
  expect(queried).not.toContain(s.invoices);
  expect(queried).not.toContain(s.returnCreditNotes);
  expect(queried).not.toContain(s.returnRefunds);
  expect(mocks.position).not.toHaveBeenCalled();
});

it.each(["sales", "admin"] as const)("preserves financial detail for %s", async role => {
  mocks.actor = { id, role };
  const serialized = serialize(await Page({ params: Promise.resolve({ id }) }));
  expect(serialized).toContain("777.77");
  expect(serialized).toContain("PRIVATE-BANK");
  expect(mocks.position).toHaveBeenCalled();
});
