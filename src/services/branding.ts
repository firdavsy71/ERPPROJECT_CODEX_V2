import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { brandingInput, customizationPrice } from "@/lib/branding";
import { discountedLineTotal } from "@/lib/money";
import {
  resolveApprovedSpecification,
  validateAttachment,
} from "./specifications";
import {
  privateBrandingStorage,
  type BrandingStorage,
} from "./branding-storage";
import { lockOperationalWarehouse as lockWarehouse } from "./operational-warehouse";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const finalStatuses = ["Shipped", "Completed", "Cancelled"];
async function lineContext(tx: Tx, saleItemId: string) {
  const [line] = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.id, saleItemId));
  if (!line) throw new Error("Sales line not found");
  const [order] = await tx
    .select()
    .from(s.sales)
    .where(eq(s.sales.id, line.orderId))
    .for("update");
  const [variant] = await tx
    .select()
    .from(s.variants)
    .where(eq(s.variants.id, line.variantId));
  const [product] = await tx
    .select()
    .from(s.products)
    .where(eq(s.products.id, variant.productId));
  const [customer] = await tx
    .select()
    .from(s.customers)
    .where(eq(s.customers.id, order.customerId));
  return { line, order, variant, product, customer };
}
async function lockVersion(tx: Tx, id: string) {
  z.uuid().parse(id);
  const [read] = await tx
    .select()
    .from(s.brandingVersions)
    .where(eq(s.brandingVersions.id, id));
  if (!read) throw new Error("Branding version not found");
  const [request] = await tx
    .select()
    .from(s.brandingRequests)
    .where(eq(s.brandingRequests.id, read.requestId))
    .for("update");
  const [version] = await tx
    .select()
    .from(s.brandingVersions)
    .where(eq(s.brandingVersions.id, id))
    .for("update");
  return { request, version };
}
async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  id: string,
  details?: Record<string, unknown>,
) {
  await tx.insert(s.audit).values({
    actorId: actor.id,
    action: `branding.${action}`,
    entityId: id,
    details,
  });
}
async function saveInTransaction(
  tx: Tx,
  actor: Actor,
  input: unknown,
  id?: string,
) {
  const v = brandingInput.parse(input);
  const c = await lineContext(tx, v.saleItemId);
  if (finalStatuses.includes(c.order.status))
    throw new Error("Closed orders cannot receive new branding revisions");
  await resolveApprovedSpecification(tx, c.line.variantId, v.specificationId);
  let [request] = await tx
    .select()
    .from(s.brandingRequests)
    .where(eq(s.brandingRequests.saleItemId, c.line.id))
    .for("update");
  if (!request) {
    if (c.order.status !== "Draft")
      throw new Error("Request branding before confirming the sales order");
    const manufacturing = await tx
      .select({ id: s.manufacturing.id })
      .from(s.manufacturing)
      .where(eq(s.manufacturing.saleItemId, c.line.id));
    if (manufacturing.length)
      throw new Error(
        "Request branding before creating linked manufacturing orders",
      );
    [request] = await tx
      .insert(s.brandingRequests)
      .values({ saleItemId: c.line.id, createdBy: actor.id })
      .returning();
  }
  const price = customizationPrice(v.document, c.line.quantity);
  if (id) {
    const current = await lockVersion(tx, id);
    if (current.version.requestId !== request.id)
      throw new Error("Sales line cannot change");
    if (current.version.status !== "Draft")
      throw new Error("Only draft designs can be edited");
    if (current.version.revision !== v.revision)
      throw new Error("This draft changed. Reload before editing");
    await tx
      .update(s.brandingVersions)
      .set({
        title: v.title,
        changeNote: v.changeNote,
        document: v.document,
        specificationId: v.specificationId,
        revision: current.version.revision + 1,
        perUnit: price.perUnit,
        setup: price.setup,
        total: price.total,
        updatedAt: new Date(),
      })
      .where(eq(s.brandingVersions.id, id));
    await audit(tx, actor, "edit", id);
    return id;
  }
  const [latest] = await tx
    .select()
    .from(s.brandingVersions)
    .where(eq(s.brandingVersions.requestId, request.id))
    .orderBy(desc(s.brandingVersions.version))
    .limit(1);
  const [created] = await tx
    .insert(s.brandingVersions)
    .values({
      requestId: request.id,
      version: (latest?.version ?? 0) + 1,
      title: v.title,
      changeNote: v.changeNote,
      document: v.document,
      specificationId: v.specificationId,
      perUnit: price.perUnit,
      setup: price.setup,
      total: price.total,
      snapshot: {
        customerId: c.customer.id,
        customer: c.customer.name,
        orderId: c.order.id,
        order: c.order.number,
        productId: c.product.id,
        product: c.product.name,
        variantId: c.variant.id,
        sku: c.variant.sku,
        size: c.variant.size,
        color: c.variant.color,
        quantity: c.line.quantity,
        currency: c.order.currency,
      },
      createdBy: actor.id,
    })
    .returning();
  await audit(tx, actor, "create", created.id);
  return created.id;
}
export async function saveBranding(actor: Actor, input: unknown, id?: string) {
  authorize(actor, "branding");
  if (id) z.uuid().parse(id);
  return db().transaction(async (tx) => {
    await lockWarehouse(tx);
    return saveInTransaction(tx, actor, input, id);
  });
}
export async function copyBranding(actor: Actor, id: string) {
  authorize(actor, "branding");
  return db().transaction(async (tx) => {
    await lockWarehouse(tx);
    const { version, request } = await lockVersion(tx, id);
    const copied = await saveInTransaction(tx, actor, {
      saleItemId: request.saleItemId,
      specificationId: version.specificationId,
      title: version.title,
      changeNote: `Revision of v${version.version}`,
      document: version.document,
    });
    const files = await tx
      .select()
      .from(s.brandingFiles)
      .where(eq(s.brandingFiles.versionId, id));
    for (const f of files.filter((f) => f.purpose !== "Design proof"))
      await tx
        .insert(s.brandingFiles)
        .values({ versionId: copied, assetId: f.assetId, purpose: f.purpose });
    await audit(tx, actor, "copy", copied, { sourceVersion: id });
    return copied;
  });
}
async function readyForReview(
  tx: Tx,
  v: typeof s.brandingVersions.$inferSelect,
) {
  const files = await tx
    .select()
    .from(s.brandingFiles)
    .where(eq(s.brandingFiles.versionId, v.id));
  const d = v.document;
  if (
    !d.productionInstructions ||
    (!d.placements.length && !d.fabricColor && !d.reflectiveTape.length)
  )
    throw new Error(
      "Add customization requirements and exact production instructions",
    );
  if (
    !files.some(
      (f) => f.purpose === "Design proof" && f.proofRevision === v.revision,
    )
  )
    throw new Error(
      "Upload a design proof for the current draft revision. Editing a draft invalidates older proofs.",
    );
  const logos = new Set(
    files.filter((f) => f.purpose === "Logo").map((f) => f.assetId),
  );
  if (d.placements.some((p) => !logos.has(p.logoAssetId)))
    throw new Error("Every placement must reference an attached company logo");
  await resolveApprovedSpecification(
    tx,
    v.snapshot.variantId,
    v.specificationId,
  );
}
export async function transitionBranding(
  actor: Actor,
  id: string,
  action: "submit" | "approve" | "reject",
  input: unknown = {},
) {
  authorize(actor, action === "submit" ? "branding" : "branding.approve");
  z.enum(["submit", "approve", "reject"]).parse(action);
  const data = z
    .object({
      note: z.string().trim().max(5000).default(""),
      customerApprover: z.string().trim().max(200).default(""),
      approvalReference: z.string().trim().max(2000).default(""),
    })
    .parse(input);
  await db().transaction(async (tx) => {
    await lockWarehouse(tx);
    const { version: v, request } = await lockVersion(tx, id);
    const c = await lineContext(tx, request.saleItemId);
    if (finalStatuses.includes(c.order.status))
      throw new Error("Order is closed");
    if (v.status !== (action === "submit" ? "Draft" : "In Review"))
      throw new Error("Invalid design approval transition");
    if (action !== "reject") await readyForReview(tx, v);
    if (action === "approve") {
      if (data.customerApprover.length < 3 || data.approvalReference.length < 5)
        throw new Error(
          "Record the customer approver and their approval reference (email / signed proof / ticket)",
        );
      if (
        v.snapshot.quantity !== c.line.quantity ||
        v.snapshot.currency !== c.order.currency
      )
        throw new Error(
          "Order quantity or currency changed; create a new design revision",
        );
      if (c.order.status !== "Draft" && request.approvedVersionId) {
        const [previous] = await tx
          .select()
          .from(s.brandingVersions)
          .where(eq(s.brandingVersions.id, request.approvedVersionId));
        if (previous.perUnit !== v.perUnit || previous.setup !== v.setup)
          throw new Error(
            "Confirmed order prices are frozen. Use a separate draft order for pricing amendments",
          );
      } else if (c.order.status !== "Draft")
        throw new Error(
          "First design approval must happen before order confirmation",
        );
      await tx
        .update(s.brandingVersions)
        .set({
          status: "Approved",
          approvedBy: actor.id,
          approvedAt: new Date(),
          customerApprover: data.customerApprover,
          approvalReference: data.approvalReference,
          reviewNote: data.note,
          updatedAt: new Date(),
        })
        .where(eq(s.brandingVersions.id, id));
      await tx
        .update(s.brandingRequests)
        .set({ approvedVersionId: id })
        .where(eq(s.brandingRequests.id, request.id));
      if (c.order.status === "Draft") {
        await tx
          .update(s.saleItems)
          .set({ brandingTotal: v.total })
          .where(eq(s.saleItems.id, c.line.id));
        const lines = await tx
          .select()
          .from(s.saleItems)
          .where(eq(s.saleItems.orderId, c.order.id));
        const total = lines
          .reduce(
            (sum, l) =>
              sum
                .add(discountedLineTotal(l.quantity, l.price, l.discount))
                .add(l.brandingTotal),
            new Decimal(0),
          )
          .toFixed(2);
        await tx
          .update(s.sales)
          .set({ total })
          .where(eq(s.sales.id, c.order.id));
      }
    } else {
      if (action === "reject" && !data.note)
        throw new Error("Provide a rejection reason");
      await tx
        .update(s.brandingVersions)
        .set({
          status: action === "submit" ? "In Review" : "Rejected",
          reviewNote: data.note,
          updatedAt: new Date(),
        })
        .where(eq(s.brandingVersions.id, id));
    }
    await audit(tx, actor, action, id, {
      customerApprover: data.customerApprover,
      reference: data.approvalReference,
      note: data.note,
    });
  });
}
export async function getBranding(actor: Actor, id: string) {
  authorize(actor, "branding.read");
  z.uuid().parse(id);
  const [version] = await db()
    .select()
    .from(s.brandingVersions)
    .where(eq(s.brandingVersions.id, id));
  if (!version) return null;
  const [request] = await db()
    .select()
    .from(s.brandingRequests)
    .where(eq(s.brandingRequests.id, version.requestId));
  const [files, history] = await Promise.all([
    db()
      .select({
        id: s.brandingFiles.id,
        purpose: s.brandingFiles.purpose,
        proofRevision: s.brandingFiles.proofRevision,
        assetId: s.brandingAssets.id,
        name: s.brandingAssets.name,
        mime: s.brandingAssets.mime,
        bytes: s.brandingAssets.bytes,
        sha256: s.brandingAssets.sha256,
        createdAt: s.brandingAssets.createdAt,
      })
      .from(s.brandingFiles)
      .innerJoin(
        s.brandingAssets,
        eq(s.brandingAssets.id, s.brandingFiles.assetId),
      )
      .where(eq(s.brandingFiles.versionId, id)),
    db()
      .select()
      .from(s.brandingVersions)
      .where(eq(s.brandingVersions.requestId, version.requestId))
      .orderBy(desc(s.brandingVersions.version)),
  ]);
  return { version, request, files, history };
}
export async function uploadBrandingFile(
  actor: Actor,
  id: string,
  file: { name: string; mime: string; data: Buffer },
  purpose: string,
  revision: number,
  storage: BrandingStorage = privateBrandingStorage,
) {
  authorize(actor, "branding");
  validateAttachment(file);
  z.enum(["Logo", "Design proof", "Reference"]).parse(purpose);
  z.number().int().nonnegative().parse(revision);
  const context = await getBranding(actor, id);
  if (
    !context ||
    context.version.status !== "Draft" ||
    context.version.revision !== revision
  )
    throw new Error("Reload the current draft before uploading");
  if (context.files.length >= 12)
    throw new Error("Maximum 12 files per version");
  if (
    purpose === "Design proof" &&
    context.files.some(
      (f) => f.purpose === "Design proof" && f.proofRevision === revision,
    )
  )
    throw new Error(
      "Unlink the current draft proof before uploading its replacement",
    );
  const assetId = randomUUID(),
    pathname = `branding/${context.request.id}/${assetId}`,
    sha256 = createHash("sha256").update(file.data).digest("hex");
  await storage.put(pathname, file.data, file.mime);
  try {
    await db().transaction(async (tx) => {
      await lockWarehouse(tx);
      const { version, request } = await lockVersion(tx, id);
      if (version.status !== "Draft" || version.revision !== revision)
        throw new Error("Design changed during upload; reload and retry");
      const files = await tx
        .select()
        .from(s.brandingFiles)
        .where(eq(s.brandingFiles.versionId, id));
      if (files.length >= 12) throw new Error("Maximum 12 files per version");
      if (
        purpose === "Design proof" &&
        files.some(
          (f) => f.purpose === "Design proof" && f.proofRevision === revision,
        )
      )
        throw new Error(
          "Unlink the current draft proof before uploading its replacement",
        );
      const c = await lineContext(tx, request.saleItemId);
      if (finalStatuses.includes(c.order.status))
        throw new Error("Order is closed");
      await tx.insert(s.brandingAssets).values({
        id: assetId,
        requestId: request.id,
        pathname,
        name: file.name,
        mime: file.mime,
        bytes: file.data.length,
        sha256,
        createdBy: actor.id,
      });
      await tx.insert(s.brandingFiles).values({
        versionId: id,
        assetId,
        purpose,
        proofRevision: purpose === "Design proof" ? revision : null,
      });
      await audit(tx, actor, "upload", id, { assetId, purpose });
    });
  } catch (error) {
    // A lost commit acknowledgement must never cause deletion of a linked or approved object.
    try {
      const [committed] = await db()
        .select({ id: s.brandingAssets.id })
        .from(s.brandingAssets)
        .where(eq(s.brandingAssets.id, assetId));
      if (!committed) await storage.remove(pathname);
    } catch {
      /* Leave an inaccessible private orphan if commit state cannot be established. */
    }
    throw error;
  }
  return assetId;
}
export async function removeBrandingFile(
  actor: Actor,
  id: string,
  fileId: string,
) {
  authorize(actor, "branding");
  z.uuid().parse(fileId);
  await db().transaction(async (tx) => {
    await lockWarehouse(tx);
    const { version } = await lockVersion(tx, id);
    if (version.status !== "Draft")
      throw new Error("Approved and submitted files are immutable");
    const [file] = await tx
      .select()
      .from(s.brandingFiles)
      .where(
        and(eq(s.brandingFiles.id, fileId), eq(s.brandingFiles.versionId, id)),
      );
    if (!file) throw new Error("File not found");
    if (version.document.placements.some((p) => p.logoAssetId === file.assetId))
      throw new Error(
        "Remove this logo from placement requirements before unlinking it",
      );
    await tx.delete(s.brandingFiles).where(eq(s.brandingFiles.id, fileId));
    await audit(tx, actor, "unlink", id, { fileId });
  });
}
export async function readBrandingFile(
  actor: Actor,
  id: string,
  fileId: string,
  storage: BrandingStorage = privateBrandingStorage,
) {
  authorize(actor, "branding.read");
  z.uuid().parse(id);
  z.uuid().parse(fileId);
  const [row] = await db()
    .select({ asset: s.brandingAssets })
    .from(s.brandingFiles)
    .innerJoin(
      s.brandingAssets,
      eq(s.brandingAssets.id, s.brandingFiles.assetId),
    )
    .where(
      and(eq(s.brandingFiles.id, fileId), eq(s.brandingFiles.versionId, id)),
    );
  if (!row) throw new Error("File not found");
  const bytes = await storage.read(row.asset.pathname);
  if (
    bytes.length !== row.asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== row.asset.sha256
  )
    throw new Error(
      "File integrity check failed. Production must use the approved original.",
    );
  return { asset: row.asset, bytes };
}
export async function resolveBrandingForManufacturing(
  tx: Tx,
  saleItemId?: string,
  selectedVersion?: string,
) {
  if (!saleItemId) {
    if (selectedVersion)
      throw new Error("Branding requires a linked sales line");
    return null;
  }
  const [request] = await tx
    .select()
    .from(s.brandingRequests)
    .where(eq(s.brandingRequests.saleItemId, saleItemId));
  if (!request) {
    if (selectedVersion)
      throw new Error("Branding version does not belong to this sales line");
    return null;
  }
  const id = selectedVersion || request.approvedVersionId;
  if (!id)
    throw new Error("Approve the customer branding proof before manufacturing");
  const [v] = await tx
    .select()
    .from(s.brandingVersions)
    .where(
      and(
        eq(s.brandingVersions.id, id),
        eq(s.brandingVersions.requestId, request.id),
        eq(s.brandingVersions.status, "Approved"),
      ),
    );
  if (!v)
    throw new Error("Select an approved branding version for this sales line");
  return v;
}
export async function checkBrandingBeforeConfirmation(tx: Tx, orderId: string) {
  const pending = await tx
    .select({
      id: s.brandingRequests.id,
      version: s.brandingVersions,
      quantity: s.saleItems.quantity,
      charge: s.saleItems.brandingTotal,
      currency: s.sales.currency,
    })
    .from(s.brandingRequests)
    .innerJoin(s.saleItems, eq(s.saleItems.id, s.brandingRequests.saleItemId))
    .innerJoin(s.sales, eq(s.sales.id, s.saleItems.orderId))
    .leftJoin(
      s.brandingVersions,
      eq(s.brandingVersions.id, s.brandingRequests.approvedVersionId),
    )
    .where(eq(s.saleItems.orderId, orderId));
  if (
    pending.some(
      (r) =>
        !r.version ||
        r.version.status !== "Approved" ||
        r.version.snapshot.quantity !== r.quantity ||
        r.version.snapshot.currency !== r.currency ||
        r.version.total !== r.charge,
    )
  )
    throw new Error(
      "Approve all requested branding designs before confirming this order",
    );
}
export async function checkBrandedShipment(
  tx: Tx,
  line: typeof s.saleItems.$inferSelect,
  quantity: number,
) {
  const [request] = await tx
    .select()
    .from(s.brandingRequests)
    .where(eq(s.brandingRequests.saleItemId, line.id));
  if (!request) return;
  if (!request.approvedVersionId) throw new Error("Branding is not approved");
  const produced = await tx
    .select({ completed: s.manufacturing.completed })
    .from(s.manufacturing)
    .innerJoin(
      s.brandingVersions,
      eq(s.brandingVersions.id, s.manufacturing.brandingVersionId),
    )
    .where(
      and(
        eq(s.manufacturing.saleItemId, line.id),
        eq(s.brandingVersions.requestId, request.id),
        eq(s.manufacturing.status, "Completed"),
      ),
    );
  if (produced.reduce((n, p) => n + p.completed, 0) < line.shipped + quantity)
    throw new Error(
      "Complete linked branded production before shipping customized units",
    );
}
