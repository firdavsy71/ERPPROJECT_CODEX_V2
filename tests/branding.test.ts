import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import { approvedSpec } from "./spec-fixture";
import {
  blankBranding,
  customizationPrice,
  type BrandingDocument,
} from "../src/lib/branding";
import {
  saveBranding,
  transitionBranding,
  copyBranding,
  getBranding,
  uploadBrandingFile,
  readBrandingFile,
  removeBrandingFile,
} from "../src/services/branding";
import {
  privateBrandingStorage,
  type BrandingStorage,
} from "../src/services/branding-storage";
import { execute } from "../src/services/operations";
import type { Actor } from "../src/lib/permissions";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
let actor: Actor,
  lineId: string,
  specId: string,
  orderId: string,
  variantId: string,
  bomId: string,
  materialId: string,
  store: BrandingStorage,
  objects: Map<string, Buffer>;
const logo = {
  name: "company-logo.png",
  mime: "image/png",
  data: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
const proof = {
  name: "customer-proof.pdf",
  mime: "application/pdf",
  data: Buffer.from("%PDF-1.7\nProof fixture for service tests\n%%EOF"),
};
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
const act = (action: Parameters<typeof execute>[1], data: unknown) =>
  execute(actor, action, data, randomUUID());
function doc(): BrandingDocument {
  return {
    ...blankBranding,
    productionInstructions:
      "Apply the approved company logo 90 mm below the left shoulder seam.",
    customerInstructions: "Use approved corporate artwork only",
    placements: [
      {
        technique: "Embroidery",
        location: "Left chest",
        logoAssetId: "",
        widthMm: "80",
        heightMm: "40",
        colors: "White",
        thread: "Polyester 40 white",
        applicationInstructions: "Use backing and satin stitch; inspect edges",
        positionInstructions: "90 mm below shoulder seam",
        unitPrice: "2.50",
        setupPrice: "10",
      },
    ],
  };
}
const input = (document = doc()) => ({
  saleItemId: lineId,
  specificationId: specId,
  title: "Customer uniform branding",
  changeNote: "Initial customer request",
  document,
});
beforeEach(async () => {
  await db().execute(
    sql`truncate users,warehouses,products,materials,customers cascade`,
  );
  objects = new Map();
  store = {
    put: async (p, b) => {
      if (objects.has(p)) throw new Error("Overwrite refused");
      objects.set(p, Buffer.from(b));
    },
    read: async (p) => {
      const bytes = objects.get(p);
      if (!bytes) throw new Error("Missing file");
      return Buffer.from(bytes);
    },
    remove: async (p) => {
      objects.delete(p);
    },
  };
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Sales administrator",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Work jacket", sku: "JKT" })
    .returning();
  const [v] = await db()
    .insert(s.variants)
    .values({ productId: p.id, sku: "JKT-L", size: "L", color: "Navy" })
    .returning();
  variantId = v.id;
  specId = await approvedSpec(actor, p.id, v.id);
  const [c] = await db()
    .insert(s.customers)
    .values({ name: "Industrial customer" })
    .returning();
  await act("sale", {
    partyId: c.id,
    currency: "USD",
    lines: [{ itemId: variantId, quantity: "10", price: "100", discount: "0" }],
  });
  const [line] = await db().select().from(s.saleItems);
  lineId = line.id;
  orderId = line.orderId;
  const [m] = await db()
    .insert(s.materials)
    .values({ name: "Fabric", sku: "FAB", unit: "Meters" })
    .returning();
  materialId = m.id;
  await act("bom", {
    variantId,
    laborCost: "0",
    specificationId: specId,
    items: [{ materialId, quantity: "2.5" }],
  });
  const [bom] = await db().select().from(s.boms);
  bomId = bom.id;
});
async function prepared() {
  const id = await saveBranding(actor, input());
  const logoId = await uploadBrandingFile(actor, id, logo, "Logo", 0, store);
  const document = doc();
  document.placements[0].logoAssetId = logoId;
  await saveBranding(actor, { ...input(document), revision: 0 }, id);
  await uploadBrandingFile(actor, id, proof, "Design proof", 1, store);
  return id;
}
async function approved() {
  const id = await prepared();
  await transitionBranding(actor, id, "submit");
  await transitionBranding(actor, id, "approve", {
    customerApprover: "Customer purchasing director",
    approvalReference: "Customer approval email CASE-001",
  });
  return id;
}
it("calculates decimal decoration, setup, fabric and tape pricing exactly", () => {
  const d = doc();
  d.placements[0].unitPrice = "0.10";
  d.placements[0].setupPrice = "0.03";
  d.fabricSurcharge = "0.02";
  d.reflectiveSurcharge = "0.01";
  expect(customizationPrice(d, 3)).toEqual({
    perUnit: "0.13",
    setup: "0.03",
    total: "0.42",
  });
});
it("requires current proof and attached logos before approval and confirmation", async () => {
  const id = await saveBranding(actor, input());
  await expect(transitionBranding(actor, id, "submit")).rejects.toThrow(
    "proof",
  );
  await expect(act("confirmSale", { id: orderId })).rejects.toThrow("branding");
  await uploadBrandingFile(actor, id, proof, "Design proof", 0, store);
  await expect(transitionBranding(actor, id, "submit")).rejects.toThrow("logo");
  expect((await db().select().from(s.sales))[0].total).toBe("1000.00");
});
it("applies customization cost once", async () => {
  const id = await approved();
  const [line] = await db().select().from(s.saleItems);
  expect(line.brandingTotal).toBe("35.00");
  expect((await db().select().from(s.sales))[0].total).toBe("1035.00");
  await expect(
    transitionBranding(actor, id, "approve", {
      customerApprover: "Director",
      approvalReference: "Approval twice",
    }),
  ).rejects.toThrow("transition");
  expect((await db().select().from(s.sales))[0].total).toBe("1035.00");
});
it("invalidates stale proofs and rejects optimistic edit conflicts", async () => {
  const id = await prepared();
  await expect(
    uploadBrandingFile(actor, id, proof, "Design proof", 1, store),
  ).rejects.toThrow("Unlink the current draft proof");
  const current = await getBranding(actor, id);
  await saveBranding(
    actor,
    {
      ...input(current!.version.document),
      revision: 1,
      title: "Changed proof layout",
    },
    id,
  );
  await expect(transitionBranding(actor, id, "submit")).rejects.toThrow(
    "current draft revision",
  );
  await expect(
    saveBranding(actor, { ...input(), revision: 1 }, id),
  ).rejects.toThrow("changed");
  await uploadBrandingFile(actor, id, proof, "Design proof", 2, store);
  await transitionBranding(actor, id, "submit");
  await expect(
    transitionBranding(actor, id, "approve", {
      customerApprover: "A",
      approvalReference: "x",
    }),
  ).rejects.toThrow("customer approver");
});
it("freezes approved documents, metadata and file links at the database layer", async () => {
  const id = await approved();
  const design = await getBranding(actor, id);
  await expect(
    saveBranding(actor, { ...input(), revision: 1 }, id),
  ).rejects.toThrow("draft");
  await expect(
    db()
      .update(s.brandingVersions)
      .set({ title: "Tampered" })
      .where(eq(s.brandingVersions.id, id)),
  ).rejects.toThrow();
  await expect(
    db().delete(s.brandingFiles).where(eq(s.brandingFiles.versionId, id)),
  ).rejects.toThrow();
  await expect(
    db()
      .update(s.brandingAssets)
      .set({ name: "Replaced" })
      .where(eq(s.brandingAssets.id, design!.files[0].assetId)),
  ).rejects.toThrow();
  await expect(
    removeBrandingFile(actor, id, design!.files[0].id),
  ).rejects.toThrow("immutable");
});
it("creates new draft revisions without copying stale proofs or changing approved production", async () => {
  const first = await approved();
  await act("confirmSale", { id: orderId });
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 4 });
  const [oldOrder] = await db().select().from(s.manufacturing);
  expect(oldOrder.brandingVersionId).toBe(first);
  const next = await copyBranding(actor, first);
  const revision = await getBranding(actor, next);
  expect(revision!.version.version).toBe(2);
  expect(revision!.version.status).toBe("Draft");
  expect(revision!.files.map((f) => f.purpose)).toEqual(["Logo"]);
  const document = revision!.version.document;
  document.placements[0].location = "Back";
  await saveBranding(actor, { ...input(document), revision: 0 }, next);
  await uploadBrandingFile(actor, next, proof, "Design proof", 1, store);
  await transitionBranding(actor, next, "submit");
  await transitionBranding(actor, next, "approve", {
    customerApprover: "Customer director",
    approvalReference: "New customer approval CASE-002",
  });
  expect(
    (
      await db()
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, oldOrder.id))
    )[0].brandingVersionId,
  ).toBe(first);
  await expect(
    db()
      .update(s.manufacturing)
      .set({ brandingVersionId: next })
      .where(eq(s.manufacturing.id, oldOrder.id)),
  ).rejects.toThrow();
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 6 });
  const orders = await db().select().from(s.manufacturing);
  expect(orders.some((o) => o.brandingVersionId === next)).toBe(true);
  await expect(
    act("manufacture", { bomId, saleItemId: lineId, quantity: 1 }),
  ).rejects.toThrow("exceeds");
});
it("freezes confirmed-order pricing while allowing same-price instruction revisions", async () => {
  const first = await approved();
  await act("confirmSale", { id: orderId });
  const next = await copyBranding(actor, first);
  const v = await getBranding(actor, next);
  const document = v!.version.document;
  document.placements[0].unitPrice = "3";
  await saveBranding(actor, { ...input(document), revision: 0 }, next);
  await uploadBrandingFile(actor, next, proof, "Design proof", 1, store);
  await transitionBranding(actor, next, "submit");
  await expect(
    transitionBranding(actor, next, "approve", {
      customerApprover: "Customer director",
      approvalReference: "Email approval CASE-003",
    }),
  ).rejects.toThrow("prices are frozen");
  expect((await db().select().from(s.sales))[0].total).toBe("1035.00");
  expect(
    (await db().select().from(s.brandingRequests))[0].approvedVersionId,
  ).toBe(first);
});
it("handles rejection and revision without altering historical customer approvals", async () => {
  const first = await prepared();
  await transitionBranding(actor, first, "submit");
  await transitionBranding(actor, first, "reject", {
    note: "Customer requests smaller back logo",
  });
  const revised = await copyBranding(actor, first);
  expect((await getBranding(actor, first))!.version.status).toBe("Rejected");
  expect((await getBranding(actor, revised))!.version.status).toBe("Draft");
});
it("enforces private file permissions, ownership and hash integrity", async () => {
  const id = await prepared();
  const design = await getBranding(actor, id);
  const file = design!.files.find((f) => f.purpose === "Logo")!;
  const read = await readBrandingFile(actor, id, file.id, store);
  expect(read.bytes).toEqual(logo.data);
  await expect(
    readBrandingFile({ ...actor, role: "viewer" }, id, file.id, store),
  ).rejects.toThrow("permission");
  await expect(
    saveBranding({ ...actor, role: "production" }, input()),
  ).rejects.toThrow("permission");
  await expect(
    readBrandingFile(actor, randomUUID(), file.id, store),
  ).rejects.toThrow("not found");
  const [asset] = await db()
    .select()
    .from(s.brandingAssets)
    .where(eq(s.brandingAssets.id, file.assetId));
  objects.set(asset.pathname, Buffer.from("changed"));
  await expect(readBrandingFile(actor, id, file.id, store)).rejects.toThrow(
    "integrity",
  );
});
it("cleans an uncommitted upload without deleting any linked private object", async () => {
  const id = await saveBranding(actor, input());
  const race: BrandingStorage = {
    ...store,
    put: async (p, b, m) => {
      await store.put(p, b, m);
      await saveBranding(actor, { ...input(), revision: 0 }, id);
    },
  };
  await expect(
    uploadBrandingFile(actor, id, logo, "Logo", 0, race),
  ).rejects.toThrow("changed during upload");
  expect(objects.size).toBe(0);
  expect(await db().select().from(s.brandingAssets)).toHaveLength(0);
});
it("requires completed branded production and branding QC before customized shipment", async () => {
  const id = await approved();
  await act("confirmSale", { id: orderId });
  await act("adjust", {
    kind: "variant",
    itemId: variantId,
    delta: "10",
    reason: "Generic unbranded opening inventory",
  });
  await act("reserveSale", { id: orderId });
  await expect(
    act("ship", { id: orderId, lines: [{ id: lineId, quantity: 10 }] }),
  ).rejects.toThrow("branded production");
  await act("adjust", {
    kind: "material",
    itemId: materialId,
    delta: "100",
    reason: "Fabric opening inventory",
  });
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 10 });
  const [order] = await db().select().from(s.manufacturing);
  await act("plan", { id: order.id });
  await act("start", { id: order.id });
  await act("record", { id: order.id, completed: 10, defective: 0 });
  const completed = {
    id: order.id,
    approved: 10,
    qualityResults: [{ check: "Visual finish", result: "Pass", notes: "" }],
  };
  await expect(act("complete", completed)).rejects.toThrow("branding");
  await act("complete", { ...completed, brandingCheck: "Pass" });
  await act("ship", { id: orderId, lines: [{ id: lineId, quantity: 10 }] });
  const [qc] = await db().select().from(s.inspections);
  expect(qc.brandingVersionId).toBe(id);
  expect(qc.brandingCheck).toBe("Pass");
  await act("invoice", { id: orderId, dueDate: "2027-01-01", taxRate: "12" });
  expect((await db().select().from(s.invoices))[0].total).toBe("1159.20");
});
it("does not silently fall back to public or local storage when Blob is unconfigured", async () => {
  const before = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    await expect(
      privateBrandingStorage.put(
        `branding/${randomUUID()}/${randomUUID()}`,
        logo.data,
        logo.mime,
      ),
    ).rejects.toThrow("not configured");
  } finally {
    if (before) process.env.BLOB_READ_WRITE_TOKEN = before;
  }
});
it("allows replacement production for rejected garments without double charging customization", async () => {
  await approved();
  await act("confirmSale", { id: orderId });
  await act("adjust", {
    kind: "material",
    itemId: materialId,
    delta: "100",
    reason: "Fabric opening stock",
  });
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 10 });
  const [first] = await db().select().from(s.manufacturing);
  await act("plan", { id: first.id });
  await act("start", { id: first.id });
  await act("record", { id: first.id, completed: 8, defective: 2 });
  await act("complete", {
    id: first.id,
    approved: 8,
    brandingCheck: "Pass",
    qualityResults: [
      {
        check: "Visual finish",
        result: "Pass",
        notes: "Two defective units excluded",
      },
    ],
  });
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 2 });
  await expect(
    act("manufacture", { bomId, saleItemId: lineId, quantity: 1 }),
  ).rejects.toThrow("exceeds");
  expect((await db().select().from(s.sales))[0].total).toBe("1035.00");
});
it("supports all requested decoration methods, placements, fabric colors and tape configurations", async () => {
  const d = doc();
  d.fabricColor = "Safety orange";
  d.fabricColorStandard = "RAL 2005";
  d.fabricSurcharge = "1.25";
  d.reflectiveSurcharge = "0.75";
  d.reflectiveTape = [
    {
      location: "Chest and sleeves",
      widthMm: "50",
      color: "Silver",
      configuration: "Two horizontal bands with 50 mm separation",
    },
  ];
  d.placements.push(
    {
      ...d.placements[0],
      technique: "Screen printing",
      location: "Back",
      thread: "",
      applicationInstructions:
        "Water-based white ink, cure per manufacturer specification",
      unitPrice: "3",
      setupPrice: "15",
    },
    {
      ...d.placements[0],
      technique: "Heat transfer",
      location: "Right sleeve",
      thread: "",
      applicationInstructions:
        "150 C / 15 seconds / medium pressure, cold peel",
      unitPrice: "1.50",
      setupPrice: "0",
    },
  );
  const id = await saveBranding(actor, input(d));
  const v = await getBranding(actor, id);
  expect(v!.version.document.placements.map((p) => p.technique)).toEqual([
    "Embroidery",
    "Screen printing",
    "Heat transfer",
  ]);
  expect(v!.version.total).toBe("115.00");
});
it("allows sales staff to record customer approval and production staff to read fixed instructions", async () => {
  const id = await prepared();
  await transitionBranding({ ...actor, role: "sales" }, id, "submit");
  await expect(
    transitionBranding({ ...actor, role: "production" }, id, "approve", {
      customerApprover: "Customer director",
      approvalReference: "Customer approval email",
    }),
  ).rejects.toThrow("permission");
  await transitionBranding({ ...actor, role: "sales" }, id, "approve", {
    customerApprover: "Customer director",
    approvalReference: "Customer approval email",
  });
  expect(
    (await getBranding({ ...actor, role: "production" }, id))!.version.document
      .productionInstructions,
  ).toContain("company logo");
});
it("prevents adding branding after production has already been assigned to an unbranded sales line", async () => {
  await act("manufacture", { bomId, saleItemId: lineId, quantity: 1 });
  await expect(saveBranding(actor, input())).rejects.toThrow(
    "before creating linked manufacturing",
  );
});
it("prevents cross-request assets from being used as another customer proof", async () => {
  const first = await prepared();
  const firstDesign = await getBranding(actor, first);
  const [customer] = await db().select().from(s.customers);
  await act("sale", {
    partyId: customer.id,
    currency: "USD",
    lines: [{ itemId: variantId, quantity: "2", price: "100", discount: "0" }],
  });
  const lines = await db().select().from(s.saleItems);
  const other = lines.find((l) => l.id !== lineId)!;
  const second = await saveBranding(actor, {
    ...input(),
    saleItemId: other.id,
  });
  await expect(
    db().insert(s.brandingFiles).values({
      versionId: second,
      assetId: firstDesign!.files[0].assetId,
      purpose: "Logo",
    }),
  ).rejects.toThrow();
});
