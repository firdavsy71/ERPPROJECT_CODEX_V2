import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { db, localClient } from "../src/db";
import * as s from "../src/db/schema";
import {
  saveSpecification,
  transitionSpecification,
  copySpecification,
  getSpecification,
  uploadSpecificationAttachment,
  removeSpecificationAttachment,
} from "../src/services/specifications";
import { execute } from "../src/services/operations";
import { validDocument, approvedSpec } from "./spec-fixture";
import type { Actor } from "../src/lib/permissions";
import { garmentTypes, effectiveMeasurements } from "../src/lib/specification";
process.env.PGLITE_DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
it("supports six garment families and variant-specific consumption, measurements and instructions", async () => {
  for (const garmentType of garmentTypes) {
    const value = input();
    value.document.garmentType = garmentType;
    value.variants[0].fabricConsumption = "3.75";
    value.variants[0].instructions = "Use winter lining for this variant";
    const id = await saveSpecification(actor, {
      ...value,
      variants: [
        {
          ...value.variants[0],
          measurements: [
            {
              point: "Chest half width",
              size: "L",
              target: "65",
              tolerance: "1",
              unit: "cm",
            },
          ],
        },
      ],
    });
    const saved = await getSpecification(id);
    expect(saved!.version.document.garmentType).toBe(garmentType);
    expect(saved!.variants[0].fabricConsumption).toBe("3.7500");
    expect(saved!.variants[0].instructions).toContain("winter lining");
    expect(
      effectiveMeasurements(saved!.version.document, saved!.variants[0])[0]
        .target,
    ).toBe("65");
  }
});
it("serializes concurrent version creation and rejects duplicate QC criteria", async () => {
  const ids = await Promise.all([
    saveSpecification(actor, input()),
    saveSpecification(actor, input()),
  ]);
  const versions = await Promise.all(ids.map(getSpecification));
  expect(versions.map((v) => v!.version.version).sort()).toEqual([1, 2]);
  const v = input();
  v.document.qualityChecks = ["Visual finish", "Visual finish"];
  await expect(saveSpecification(actor, v)).rejects.toThrow("unique");
});
let actor: Actor,
  productId: string,
  variantId: string,
  bomId: string,
  materialId: string;
beforeAll(async () => {
  await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await localClient()?.close();
});
beforeEach(async () => {
  await db().execute(sql`truncate users,warehouses,products,materials cascade`);
  const [u] = await db()
    .insert(s.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "test",
      role: "admin",
    })
    .returning();
  actor = { id: u.id, role: "admin" };
  await db().insert(s.warehouses).values({ name: "Main" });
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Jacket", sku: "JKT" })
    .returning();
  productId = p.id;
  const [v] = await db()
    .insert(s.variants)
    .values({ productId, sku: "JKT-L", size: "L", color: "Navy" })
    .returning();
  variantId = v.id;
  const [m] = await db()
    .insert(s.materials)
    .values({ name: "Fabric", sku: "FAB", unit: "Meters" })
    .returning();
  materialId = m.id;
  await execute(
    actor,
    "bom",
    { variantId, laborCost: "0", items: [{ materialId, quantity: "2.5" }] },
    randomUUID(),
  );
  const [b] = await db().select().from(s.boms);
  bomId = b.id;
});
const input = () => ({
  productId,
  title: "Engineering sheet",
  changeNote: "Initial issue",
  document: validDocument(),
  variants: [
    {
      variantId,
      fabricConsumption: "2.5",
      consumptionUnit: "Meters",
      instructions: "",
      measurements: [],
    },
  ],
});
it("rejects invalid fabric composition and unrelated variants", async () => {
  const v = input();
  v.document.fabrics[0].composition[0].percent = "64";
  await expect(saveSpecification(actor, v)).rejects.toThrow();
  const [p] = await db()
    .insert(s.products)
    .values({ name: "Other", sku: "OTH" })
    .returning();
  const [other] = await db()
    .insert(s.variants)
    .values({ productId: p.id, sku: "OTH-L", size: "L", color: "Black" })
    .returning();
  await expect(
    saveSpecification(actor, {
      ...input(),
      variants: [{ ...input().variants[0], variantId: other.id }],
    }),
  ).rejects.toThrow("does not belong");
  expect(await db().select().from(s.specifications)).toHaveLength(0);
});
it("enforces permissions and a complete approval workflow", async () => {
  await expect(
    saveSpecification({ ...actor, role: "viewer" }, input()),
  ).rejects.toThrow("permission");
  const id = await saveSpecification({ ...actor, role: "production" }, input());
  await expect(
    transitionSpecification(actor, id, "approve", ""),
  ).rejects.toThrow("In Review");
  await transitionSpecification(
    { ...actor, role: "production" },
    id,
    "submit",
    "",
  );
  await expect(
    transitionSpecification(
      { ...actor, role: "production" },
      id,
      "approve",
      "",
    ),
  ).rejects.toThrow("permission");
  await transitionSpecification(
    actor,
    id,
    "reject",
    "Change pocket construction",
  );
  expect((await getSpecification(id))!.version.status).toBe("Rejected");
  await expect(
    saveSpecification(actor, { ...input(), revision: 0 }, id),
  ).rejects.toThrow("draft");
});
it("detects stale draft edits and incomplete review submissions", async () => {
  const v = input();
  v.document.measurements = [];
  const id = await saveSpecification(actor, v);
  await expect(
    transitionSpecification(actor, id, "submit", ""),
  ).rejects.toThrow("measurements");
  await saveSpecification(actor, { ...input(), revision: 0 }, id);
  await expect(
    saveSpecification(actor, { ...input(), revision: 0 }, id),
  ).rejects.toThrow("changed");
});
it("freezes approved versions and child records at the database layer", async () => {
  const id = await approvedSpec(actor, productId, variantId);
  await expect(
    saveSpecification(actor, { ...input(), revision: 0 }, id),
  ).rejects.toThrow("draft");
  await expect(
    db()
      .update(s.specifications)
      .set({ title: "Tampered" })
      .where(eq(s.specifications.id, id)),
  ).rejects.toThrow();
  await expect(
    db().delete(s.specifications).where(eq(s.specifications.id, id)),
  ).rejects.toThrow();
  await expect(
    db()
      .update(s.specificationVariants)
      .set({ fabricConsumption: "999" })
      .where(eq(s.specificationVariants.specificationId, id)),
  ).rejects.toThrow();
  await expect(
    db()
      .delete(s.specificationVariants)
      .where(eq(s.specificationVariants.specificationId, id)),
  ).rejects.toThrow();
});
it("stores real drawing attachments, copies them and prevents changes after approval", async () => {
  const id = await saveSpecification(actor, input());
  const png = {
    name: "drawing.png",
    mime: "image/png",
    data: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrZkAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  await uploadSpecificationAttachment(actor, id, png, "Technical drawing");
  await expect(
    uploadSpecificationAttachment(
      actor,
      id,
      { ...png, data: Buffer.from("<script>bad</script>") },
      "Technical drawing",
    ),
  ).rejects.toThrow("valid");
  await expect(
    uploadSpecificationAttachment(
      actor,
      id,
      { ...png, data: Buffer.alloc(2097153) },
      "Technical drawing",
    ),
  ).rejects.toThrow("2 MiB");
  const [file] = await db().select().from(s.specificationAttachments);
  expect(Buffer.from(file.data, "base64")).toEqual(png.data);
  await transitionSpecification(actor, id, "submit", "");
  await transitionSpecification(actor, id, "approve", "");
  await expect(
    uploadSpecificationAttachment(actor, id, png, "Reference image"),
  ).rejects.toThrow("draft");
  await expect(
    removeSpecificationAttachment(actor, id, file.id),
  ).rejects.toThrow("draft");
  await expect(
    db()
      .delete(s.specificationAttachments)
      .where(eq(s.specificationAttachments.id, file.id)),
  ).rejects.toThrow();
  const copied = await copySpecification(actor, id);
  const next = await getSpecification(copied);
  expect(next!.version.version).toBe(2);
  expect(next!.version.status).toBe("Draft");
  expect(next!.attachments).toHaveLength(1);
  await removeSpecificationAttachment(actor, copied, next!.attachments[0].id);
  expect((await getSpecification(id))!.attachments).toHaveLength(1);
});
it("requires approved matching versions and pins production across revisions", async () => {
  await expect(
    execute(actor, "manufacture", { bomId, quantity: 2 }, randomUUID()),
  ).rejects.toThrow("approved");
  const id = await approvedSpec(actor, productId, variantId);
  await execute(actor, "manufacture", { bomId, quantity: 2 }, randomUUID());
  const [order] = await db().select().from(s.manufacturing);
  expect(order.specificationId).toBe(id);
  const next = await copySpecification(actor, id);
  await transitionSpecification(actor, next, "submit", "");
  await transitionSpecification(actor, next, "approve", "");
  await expect(
    db()
      .update(s.manufacturing)
      .set({ specificationId: next })
      .where(eq(s.manufacturing.id, order.id)),
  ).rejects.toThrow();
  expect((await db().select().from(s.manufacturing))[0].specificationId).toBe(
    id,
  );
  await expect(
    db().insert(s.manufacturing).values({
      number: "BAD",
      variantId,
      bomId,
      warehouseId: order.warehouseId,
      quantity: 1,
    }),
  ).rejects.toThrow();
});
it("stores checklist outcomes against the pinned version and blocks failed QC from accepting units", async () => {
  const id = await approvedSpec(actor, productId, variantId);
  const act = (action: Parameters<typeof execute>[1], v: unknown) =>
    execute(actor, action, v, randomUUID());
  await act("adjust", {
    kind: "material",
    itemId: materialId,
    delta: "100",
    reason: "Opening test stock",
  });
  await act("manufacture", { bomId, quantity: 2, specificationId: id });
  const [order] = await db().select().from(s.manufacturing);
  await act("plan", { id: order.id });
  await act("start", { id: order.id });
  await act("record", { id: order.id, completed: 2, defective: 0 });
  await expect(
    act("complete", {
      id: order.id,
      approved: 2,
      qualityResults: [
        { check: "Visual finish", result: "Fail", notes: "Bad stitching" },
      ],
    }),
  ).rejects.toThrow("must pass");
  expect(await db().select().from(s.inspections)).toHaveLength(0);
  await act("complete", {
    id: order.id,
    approved: 2,
    qualityResults: [
      {
        check: "Visual finish",
        result: "Pass",
        notes: "Checked seams and measurements",
      },
    ],
  });
  const [qc] = await db().select().from(s.inspections);
  expect(qc.specificationId).toBe(id);
  expect(qc.specificationResults![0].result).toBe("Pass");
});
