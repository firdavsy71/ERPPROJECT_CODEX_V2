import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/lib/permissions";
import * as React from "react";
import * as s from "../src/db/schema";

const mocks = vi.hoisted(() => ({ actor: null as Actor | null, db: vi.fn() }));
vi.mock("@/auth", () => ({ currentActor: async () => mocks.actor }));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/components/forms", () => ({ ActionForm: () => null }));
vi.mock("@/components/data-table", () => ({ DataTable: () => null }));
vi.mock("@/components/enable-empty-roll-tracking", () => ({ EnableEmptyRollTracking: () => null }));
vi.mock("@/components/fabric-receipt", () => ({ FabricReceipt: () => null }));

import OperationsPage from "../src/app/(erp)/production-operations/page";
import OperationDetail from "../src/app/(erp)/production-operations/[id]/page";
import CuttingPage from "../src/app/(erp)/cutting/page";
import CuttingDetail from "../src/app/(erp)/cutting/[id]/page";
import RollsPage from "../src/app/(erp)/fabric-rolls/page";
import RollDetail from "../src/app/(erp)/fabric-rolls/[id]/page";
import ReceiptPage from "../src/app/(erp)/fabric-rolls/receive/[id]/page";

const detailParams = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };
const pages = [
  ["operation list", () => OperationsPage()],
  ["operation detail", () => OperationDetail(detailParams)],
  ["cutting list", () => CuttingPage()],
  ["cutting detail", () => CuttingDetail(detailParams)],
  ["roll list", () => RollsPage()],
  ["roll detail", () => RollDetail(detailParams)],
] as const;

beforeEach(() => {
  mocks.actor = null;
  mocks.db.mockReset();
  mocks.db.mockImplementation(() => { throw new Error("unexpected database access"); });
});

describe("production and traceability page authorization", () => {
  it.each(pages)("requires authentication before querying %s", async (_name, page) => {
    await expect(page()).rejects.toThrow("redirect:/login");
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(pages)("rejects viewer and sales roles before querying %s", async (_name, page) => {
    for (const role of ["viewer", "sales"] as const) {
      mocks.actor = { id: "test-user", role };
      await expect(page()).rejects.toThrow("not-found");
      expect(mocks.db).not.toHaveBeenCalled();
    }
  });
  it("selects the configured operational warehouse for roll registration and purchase receipts", async () => {
    vi.stubGlobal("React", React);
    mocks.actor = { id: "test-user", role: "inventory" };
    const rows = new Map<unknown, unknown[]>([
      [s.fabricRolls, []],
      [s.warehouses, [{ id: "first" }, { id: "configured" }]],
      [s.settings, [{ primaryWarehouseId: "configured" }]],
      [s.materials, [{ id: "fabric", name: "Fabric", unit: "Meters" }]],
      [s.balances, [
        { id: "balance-first", warehouseId: "first", materialId: "fabric", rollTracked: false, onHand: "8", reserved: "0" },
        { id: "balance-configured", warehouseId: "configured", materialId: "fabric", rollTracked: true, onHand: "25", reserved: "0" },
      ]],
      [s.purchases, [{ id: "purchase", number: "PO-1", status: "Ordered" }]],
      [s.purchaseItems, [{ id: "purchase-line", materialId: "fabric", quantity: "30", received: "0" }]],
    ]);
    mocks.db.mockImplementation(() => ({ select: () => ({ from: (table: unknown) => {
      const result = Promise.resolve(rows.get(table) ?? []);
      return Object.assign(result, { where: () => result, orderBy: () => result });
    } }) }));
    // Server-rendered props are the actual choices given to the mutation forms.
    function findProps(node: React.ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
      if (!React.isValidElement<Record<string, unknown>>(node)) return undefined;
      if (match(node.props)) return node.props;
      for (const child of React.Children.toArray(node.props.children as React.ReactNode)) {
        const found = findProps(child, match);
        if (found) return found;
      }
    }
    try {
      const page = await RollsPage();
      const register = findProps(page, (props) => props.label === "Register rolls");
      expect(register?.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "materialId", options: [{ value: "fabric", label: "Fabric · 25 m on hand · 0 m reserved" }] }),
      ]));
      const receipt = findProps(await ReceiptPage(detailParams), (props) => props.orderId === "00000000-0000-4000-8000-000000000001");
      expect(receipt?.lines).toEqual([{ id: "purchase-line", label: "Fabric · 30 m remaining" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
