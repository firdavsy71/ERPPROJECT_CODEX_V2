import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { authorize, type Actor } from "@/lib/permissions";
import {
  effectiveMeasurements,
  specificationInput,
  type SpecDocument,
} from "@/lib/specification";
import { z } from "zod";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
async function locked(tx: Tx, id: string) {
  z.uuid().parse(id);
  const [v] = await tx
    .select()
    .from(s.specifications)
    .where(eq(s.specifications.id, id))
    .for("update");
  if (!v) throw new Error("Specification not found");
  return v;
}
export async function saveSpecification(
  actor: Actor,
  input: unknown,
  id?: string,
  transaction?: Tx,
) {
  authorize(actor, "specifications");
  const v = specificationInput.parse(input);
  const persist = async (tx: Tx) => {
    const [product] = await tx
      .select()
      .from(s.products)
      .where(eq(s.products.id, v.productId))
      .for("update");
    if (!product?.active) throw new Error("Select an active product");
    let versionId = id;
    if (id) {
      const current = await locked(tx, id);
      if (current.status !== "Draft")
        throw new Error("Only draft specifications can be edited");
      if (current.productId !== v.productId)
        throw new Error("Product cannot be changed");
      if (current.revision !== v.revision)
        throw new Error("This draft changed. Reload before editing.");
      await tx
        .update(s.specifications)
        .set({
          title: v.title,
          changeNote: v.changeNote,
          document: v.document,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.specifications.id, id));
      await tx
        .delete(s.specificationVariants)
        .where(eq(s.specificationVariants.specificationId, id));
    } else {
      const [latest] = await tx
        .select()
        .from(s.specifications)
        .where(eq(s.specifications.productId, v.productId))
        .orderBy(desc(s.specifications.version))
        .limit(1);
      const [created] = await tx
        .insert(s.specifications)
        .values({
          productId: v.productId,
          title: v.title,
          changeNote: v.changeNote,
          document: v.document,
          version: (latest?.version ?? 0) + 1,
          createdBy: actor.id,
          productSnapshot: { name: product.name, sku: product.sku },
        })
        .returning();
      versionId = created.id;
    }
    if (new Set(v.variants.map((r) => r.variantId)).size !== v.variants.length)
      throw new Error("Duplicate variant");
    for (const item of v.variants) {
      const [variant] = await tx
        .select()
        .from(s.variants)
        .where(
          and(
            eq(s.variants.id, item.variantId),
            eq(s.variants.productId, product.id),
          ),
        );
      if (!variant) throw new Error("Variant does not belong to this product");
      if (item.measurements.some((m) => m.size !== variant.size))
        throw new Error("Variant measurement size must match the variant");
      await tx.insert(s.specificationVariants).values({
        ...item,
        specificationId: versionId!,
        snapshot: {
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
        },
      });
    }
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: id ? "specification.edit" : "specification.create",
      entityId: versionId!,
    });
    return versionId!;
  };
  return transaction ? persist(transaction) : db().transaction(persist);
}
export async function transitionSpecification(
  actor: Actor,
  id: string,
  action: "submit" | "approve" | "reject",
  note: string,
) {
  authorize(actor, action === "submit" ? "specifications" : "settings");
  z.enum(["submit", "approve", "reject"]).parse(action);
  z.string().max(5000).parse(note);
  await db().transaction(async (tx) => {
    const current = await locked(tx, id);
    const expected = action === "submit" ? "Draft" : "In Review";
    if (current.status !== expected)
      throw new Error(`Only ${expected} specifications allow this action`);
    if (action !== "reject") {
      const rows = await tx
        .select()
        .from(s.specificationVariants)
        .where(eq(s.specificationVariants.specificationId, id));
      const d = current.document;
      if (
        !d.construction ||
        !d.manufacturingInstructions ||
        !d.fabrics.length ||
        !d.seams.length ||
        !d.qualityChecks.length ||
        !rows.length
      )
        throw new Error(
          "Add fabric, construction, manufacturing instructions, seams, quality checks and at least one variant before review",
        );
      if (rows.some((r) => !effectiveMeasurements(d, r).length))
        throw new Error(
          "Every covered variant needs measurements for its size",
        );
    }
    if (action === "reject" && !note.trim())
      throw new Error("Provide a rejection reason");
    await tx
      .update(s.specifications)
      .set({
        status:
          action === "submit"
            ? "In Review"
            : action === "approve"
              ? "Approved"
              : "Rejected",
        reviewNote: note,
        updatedAt: new Date(),
        ...(action === "approve"
          ? { approvedBy: actor.id, approvedAt: new Date() }
          : {}),
      })
      .where(eq(s.specifications.id, id));
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: `specification.${action}`,
      entityId: id,
      details: { note },
    });
  });
}
export async function copySpecification(actor: Actor, id: string) {
  authorize(actor, "specifications");
  const source = await getSpecification(id);
  if (!source) throw new Error("Specification not found");
  return db().transaction(async (tx) => {
    await tx
      .select()
      .from(s.products)
      .where(eq(s.products.id, source.version.productId))
      .for("update");
    const current = await locked(tx, id);
    const sourceVariants = await tx
      .select()
      .from(s.specificationVariants)
      .where(eq(s.specificationVariants.specificationId, id));
    const newId = await saveSpecification(
      actor,
      {
        productId: current.productId,
        title: current.title,
        changeNote: `Revision based on v${current.version}`,
        document: current.document,
        variants: sourceVariants,
      },
      undefined,
      tx,
    );
    const files = await tx
      .select()
      .from(s.specificationAttachments)
      .where(eq(s.specificationAttachments.specificationId, id));
    for (const f of files)
      await tx.insert(s.specificationAttachments).values({
        specificationId: newId,
        name: f.name,
        kind: f.kind,
        mime: f.mime,
        bytes: f.bytes,
        data: f.data,
        createdBy: actor.id,
      });
    return newId;
  });
}
export async function getSpecification(id: string) {
  z.uuid().parse(id);
  const [version] = await db()
    .select()
    .from(s.specifications)
    .where(eq(s.specifications.id, id));
  if (!version) return null;
  const [variants, attachments, history] = await Promise.all([
    db()
      .select()
      .from(s.specificationVariants)
      .where(eq(s.specificationVariants.specificationId, id)),
    db()
      .select({
        id: s.specificationAttachments.id,
        name: s.specificationAttachments.name,
        mime: s.specificationAttachments.mime,
        kind: s.specificationAttachments.kind,
        bytes: s.specificationAttachments.bytes,
      })
      .from(s.specificationAttachments)
      .where(eq(s.specificationAttachments.specificationId, id)),
    db()
      .select()
      .from(s.specifications)
      .where(eq(s.specifications.productId, version.productId))
      .orderBy(desc(s.specifications.version)),
  ]);
  return { version, variants, attachments, history };
}
export function validateAttachment(file: {
  name: string;
  mime: string;
  data: Buffer;
}) {
  if (file.data.length === 0 || file.data.length > 2097152)
    throw new Error("Attachment must be between 1 byte and 2 MiB");
  const png = file.data
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    file.data[0] === 255 && file.data[1] === 216 && file.data[2] === 255;
  const pdf = file.data.subarray(0, 5).toString() === "%PDF-";
  if (!(
    (file.mime === "image/png" && png) ||
    (file.mime === "image/jpeg" && jpeg) ||
    (file.mime === "application/pdf" && pdf)
  ))
    throw new Error("Upload a valid PNG, JPEG or PDF file");
  if (!file.name || file.name.length > 200 || /[\r\n/\\]/.test(file.name))
    throw new Error("Invalid file name");
}
export async function uploadSpecificationAttachment(
  actor: Actor,
  id: string,
  file: { name: string; mime: string; data: Buffer },
  kind: string,
) {
  authorize(actor, "specifications");
  validateAttachment(file);
  z.enum(["Technical drawing", "Reference image", "Supporting document"]).parse(
    kind,
  );
  await db().transaction(async (tx) => {
    const v = await locked(tx, id);
    if (v.status !== "Draft")
      throw new Error("Attachments can only change on drafts");
    const count = await tx
      .select({ id: s.specificationAttachments.id })
      .from(s.specificationAttachments)
      .where(eq(s.specificationAttachments.specificationId, id));
    if (count.length >= 12)
      throw new Error("Maximum 12 attachments per version");
    await tx.insert(s.specificationAttachments).values({
      specificationId: id,
      name: file.name,
      mime: file.mime,
      kind,
      bytes: file.data.length,
      data: file.data.toString("base64"),
      createdBy: actor.id,
    });
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: "specification.attachment",
      entityId: id,
    });
  });
}
export async function removeSpecificationAttachment(
  actor: Actor,
  id: string,
  attachmentId: string,
) {
  authorize(actor, "specifications");
  z.uuid().parse(attachmentId);
  await db().transaction(async (tx) => {
    const v = await locked(tx, id);
    if (v.status !== "Draft")
      throw new Error("Attachments can only change on drafts");
    await tx
      .delete(s.specificationAttachments)
      .where(
        and(
          eq(s.specificationAttachments.id, attachmentId),
          eq(s.specificationAttachments.specificationId, id),
        ),
      );
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: "specification.removeAttachment",
      entityId: id,
    });
  });
}
export async function resolveApprovedSpecification(
  tx: Tx,
  variantId: string,
  specificationId?: string,
) {
  const [row] = await tx
    .select({ specification: s.specifications })
    .from(s.specificationVariants)
    .innerJoin(
      s.specifications,
      eq(s.specifications.id, s.specificationVariants.specificationId),
    )
    .where(
      and(
        eq(s.specificationVariants.variantId, variantId),
        eq(s.specifications.status, "Approved"),
        ...(specificationId ? [eq(s.specifications.id, specificationId)] : []),
      ),
    )
    .orderBy(desc(s.specifications.version))
    .limit(1);
  if (!row)
    throw new Error(
      "An approved technical specification covering this variant is required",
    );
  return row.specification;
}
export function resolvedInstructions(
  document: SpecDocument,
  instructions: string,
) {
  return instructions || document.manufacturingInstructions;
}
