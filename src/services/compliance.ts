import { randomUUID, createHash } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { validateAttachment } from "@/services/specifications";
import { businessDate } from "@/i18n/format";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export const evidenceKinds = [
  "Certificate",
  "Testing report",
  "Material certification",
  "Supplier declaration",
] as const;
const description = z.string().trim().min(1).max(1000);
const uuid = z.uuid();
const certificateFields = z
  .object({
    productId: uuid,
    specificationId: uuid.optional().or(z.literal("")),
    standardId: uuid,
    certificateNumber: z.string().trim().min(1).max(200),
    issuer: z.string().trim().min(1).max(200),
    issueDate: z.iso.date(),
    expiryDate: z.iso.date(),
    scope: description,
  })
  .refine((v) => v.expiryDate >= v.issueDate, {
    message: "Expiration date must not precede issue date",
  });
type Version = typeof s.certifications.$inferSelect;
export function complianceStatus(
  version: Version,
  versions: Version[],
  today = businessDate(new Date()),
) {
  if (version.status === "Draft") return "Draft";
  const effective = versions
    .filter(
      (v) =>
        v.groupId === version.groupId &&
        v.status !== "Draft" &&
        v.issueDate <= today,
    )
    .sort((a, b) => b.version - a.version)[0];
  if (version.issueDate > today)
    return version.status === "Revoked" ? "Revoked" : "Not yet valid";
  if (effective?.id !== version.id) return "Superseded";
  if (version.status === "Revoked") return "Revoked";
  if (version.expiryDate < today) return "Expired";
  return "Certified";
}
export function expiresSoon(
  version: Version,
  versions: Version[],
  today = businessDate(new Date()),
  days = 30,
) {
  if (complianceStatus(version, versions, today) !== "Certified") return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return version.expiryDate <= limit.toISOString().slice(0, 10);
}
async function locked(tx: Tx, id: string) {
  const [v] = await tx
    .select()
    .from(s.certifications)
    .where(eq(s.certifications.id, id))
    .for("update");
  if (!v) throw new Error("Certification version not found.");
  return v;
}
async function checkFields(tx: Tx, v: z.infer<typeof certificateFields>) {
  const [product] = await tx
    .select()
    .from(s.products)
    .where(eq(s.products.id, v.productId));
  const [standard] = await tx
    .select()
    .from(s.safetyStandards)
    .where(eq(s.safetyStandards.id, v.standardId));
  if (!product || !standard?.active)
    throw new Error("Choose an existing product and active standard.");
  if (v.specificationId) {
    const [spec] = await tx
      .select()
      .from(s.specifications)
      .where(eq(s.specifications.id, v.specificationId));
    if (!spec || spec.productId !== v.productId)
      throw new Error(
        "The technical specification must belong to this product.",
      );
  }
}
async function event(
  tx: Tx,
  certificationId: string,
  event: string,
  notes: string,
  actorId: string,
) {
  await tx
    .insert(s.certificationEvents)
    .values({ certificationId, event, notes, actorId });
}
export async function complianceAction(
  tx: Tx,
  action: string,
  input: unknown,
  actorId: string,
) {
  if (action === "createSafetyStandard") {
    const v = z
      .object({
        reference: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(300),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(input);
    await tx.insert(s.safetyStandards).values({ ...v, createdBy: actorId });
    return;
  }
  if (action === "editSafetyStandard" || action === "archiveSafetyStandard") {
    const { id } = z.object({ id: uuid }).parse(input);
    const [standard] = await tx
      .select()
      .from(s.safetyStandards)
      .where(eq(s.safetyStandards.id, id))
      .for("update");
    if (!standard) throw new Error("Standard not found.");
    if (action === "archiveSafetyStandard") {
      await tx
        .update(s.safetyStandards)
        .set({ active: false })
        .where(eq(s.safetyStandards.id, id));
      return;
    }
    const used = await tx
      .select({ id: s.certifications.id })
      .from(s.certifications)
      .where(eq(s.certifications.standardId, id))
      .limit(1);
    if (used.length)
      throw new Error(
        "A referenced standard is historical; add a new standard reference instead.",
      );
    const v = z
      .object({
        reference: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(300),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(input);
    await tx
      .update(s.safetyStandards)
      .set(v)
      .where(eq(s.safetyStandards.id, id));
    return;
  }
  if (
    action === "createCertification" ||
    action === "reviseCertification" ||
    action === "editCertification"
  ) {
    const v = certificateFields.parse(input);
    await checkFields(tx, v);
    const fields = { ...v, specificationId: v.specificationId || null };
    if (action === "createCertification") {
      const [created] = await tx
        .insert(s.certifications)
        .values({
          ...fields,
          groupId: randomUUID(),
          version: 1,
          createdBy: actorId,
        })
        .returning();
      await event(
        tx,
        created.id,
        "Draft created",
        "Initial evidence entered by administrator.",
        actorId,
      );
      return;
    }
    const { id } = z.object({ id: uuid }).parse(input);
    const previous = await locked(tx, id);
    if (action === "editCertification") {
      if (previous.status !== "Draft")
        throw new Error("Only a draft can be edited.");
      if (previous.productId !== v.productId)
        throw new Error("A certification series cannot change product.");
      if (previous.version > 1 && previous.standardId !== v.standardId)
        throw new Error(
          "A certification series cannot change its safety standard.",
        );
      await tx
        .update(s.certifications)
        .set(fields)
        .where(eq(s.certifications.id, id));
      await event(
        tx,
        id,
        "Draft edited",
        "Certification details updated.",
        actorId,
      );
      return;
    }
    if (previous.status === "Draft")
      throw new Error(
        "Approve or revoke this version before creating a revision.",
      );
    if (previous.productId !== v.productId)
      throw new Error("A certification series cannot change product.");
    if (previous.standardId !== v.standardId)
      throw new Error(
        "A certification series cannot change its safety standard.",
      );
    const [latest] = await tx
      .select()
      .from(s.certifications)
      .where(eq(s.certifications.groupId, previous.groupId))
      .orderBy(desc(s.certifications.version))
      .limit(1);
    if (latest.id !== previous.id)
      throw new Error("Create revisions from the latest version.");
    const [created] = await tx
      .insert(s.certifications)
      .values({
        ...fields,
        groupId: previous.groupId,
        version: previous.version + 1,
        createdBy: actorId,
      })
      .returning();
    await event(
      tx,
      created.id,
      "Revision created",
      `New evidence required; based on version ${previous.version}.`,
      actorId,
    );
    return;
  }
  const v = z.object({ id: uuid, notes: description }).parse(input);
  const version = await locked(tx, v.id);
  if (action === "approveCertification") {
    if (version.status !== "Draft")
      throw new Error("Only drafts can be approved.");
    if (version.specificationId) {
      const [spec] = await tx
        .select()
        .from(s.specifications)
        .where(eq(s.specifications.id, version.specificationId));
      if (
        !spec ||
        spec.status !== "Approved" ||
        spec.productId !== version.productId
      )
        throw new Error(
          "A linked specification must be approved for this product.",
        );
    }
    const files = await tx
      .select()
      .from(s.certificationAttachments)
      .where(eq(s.certificationAttachments.certificationId, v.id));
    if (!files.some((f) => f.kind === "Certificate"))
      throw new Error("Attach the actual certificate before approval.");
    await tx
      .update(s.certifications)
      .set({ status: "Approved", approvedBy: actorId, approvedAt: new Date() })
      .where(eq(s.certifications.id, v.id));
    await event(tx, v.id, "Approved", v.notes, actorId);
  } else if (action === "revokeCertification") {
    if (version.status !== "Approved")
      throw new Error("Only an approved version can be revoked.");
    await tx
      .update(s.certifications)
      .set({ status: "Revoked" })
      .where(eq(s.certifications.id, v.id));
    await event(tx, v.id, "Revoked", v.notes, actorId);
  } else throw new Error("Unknown certification action.");
}
export async function uploadComplianceEvidence(
  actor: Actor,
  id: string,
  file: { name: string; mime: string; data: Buffer },
  kind: string,
  materialId: string,
  supplierId: string,
) {
  authorize(actor, "compliance.manage");
  uuid.parse(id);
  validateAttachment(file);
  const parsedKind = z.enum(evidenceKinds).parse(kind);
  const material = uuid.optional().or(z.literal("")).parse(materialId);
  const supplier = uuid.optional().or(z.literal("")).parse(supplierId);
  await db().transaction(async (tx) => {
    const v = await locked(tx, id);
    if (v.status !== "Draft")
      throw new Error("Evidence is frozen once approved.");
    const existing = await tx
      .select({ id: s.certificationAttachments.id })
      .from(s.certificationAttachments)
      .where(eq(s.certificationAttachments.certificationId, id));
    if (existing.length >= 12) throw new Error("Maximum 12 files per version.");
    if (
      material &&
      !(
        await tx.select().from(s.materials).where(eq(s.materials.id, material))
      )[0]
    )
      throw new Error("Material not found.");
    if (
      supplier &&
      !(
        await tx.select().from(s.suppliers).where(eq(s.suppliers.id, supplier))
      )[0]
    )
      throw new Error("Supplier not found.");
    await tx.insert(s.certificationAttachments).values({
      certificationId: id,
      kind: parsedKind,
      name: file.name,
      mime: file.mime,
      bytes: file.data.length,
      data: file.data.toString("base64"),
      sha256: createHash("sha256").update(file.data).digest("hex"),
      materialId: material || null,
      supplierId: supplier || null,
      createdBy: actor.id,
    });
    await event(
      tx,
      id,
      "Evidence added",
      `${parsedKind}: ${file.name}`,
      actor.id,
    );
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action: "compliance.evidence",
      entityId: id,
    });
  });
}
export async function readComplianceEvidence(
  actor: Actor,
  certificationId: string,
  attachmentId: string,
) {
  authorize(actor, "compliance.read");
  uuid.parse(certificationId);
  uuid.parse(attachmentId);
  const [file] = await db()
    .select()
    .from(s.certificationAttachments)
    .where(
      and(
        eq(s.certificationAttachments.id, attachmentId),
        eq(s.certificationAttachments.certificationId, certificationId),
      ),
    );
  if (!file) return null;
  const data = Buffer.from(file.data, "base64");
  if (
    data.length !== file.bytes ||
    createHash("sha256").update(data).digest("hex") !== file.sha256
  )
    throw new Error("Document integrity verification failed.");
  return { ...file, data };
}
