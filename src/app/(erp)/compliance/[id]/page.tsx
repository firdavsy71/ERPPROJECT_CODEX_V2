import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import * as s from "@/db/schema";
import { complianceStatus, expiresSoon } from "@/services/compliance";
import { certificationFields } from "@/lib/compliance-fields";
import { ActionForm } from "@/components/forms";
import { ComplianceUpload } from "@/components/compliance-upload";
import { DataTable } from "@/components/data-table";
import { businessDate } from "@/i18n/format";
export default async function ComplianceDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "compliance.read")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [v] = await db()
    .select()
    .from(s.certifications)
    .where(eq(s.certifications.id, id));
  if (!v) notFound();
  const [
    versions,
    standards,
    products,
    specs,
    files,
    events,
    materials,
    suppliers,
    company,
  ] = await Promise.all([
    db()
      .select()
      .from(s.certifications)
      .where(eq(s.certifications.groupId, v.groupId)),
    db().select().from(s.safetyStandards),
    db().select().from(s.products),
    db().select().from(s.specifications),
    db()
      .select({
        id: s.certificationAttachments.id,
        name: s.certificationAttachments.name,
        kind: s.certificationAttachments.kind,
        materialId: s.certificationAttachments.materialId,
        supplierId: s.certificationAttachments.supplierId,
      })
      .from(s.certificationAttachments)
      .where(eq(s.certificationAttachments.certificationId, id)),
    db()
      .select()
      .from(s.certificationEvents)
      .where(eq(s.certificationEvents.certificationId, id)),
    db().select().from(s.materials),
    db().select().from(s.suppliers),
    db().select({ timezone: s.settings.timezone }).from(s.settings).limit(1),
  ]);
  const today = businessDate(new Date(), company[0]?.timezone);
  const latest = Math.max(...versions.map((x) => x.version));
  const defaults = {
    productId: v.productId,
    specificationId: v.specificationId ?? "",
    standardId: v.standardId,
    certificateNumber: v.certificateNumber,
    issuer: v.issuer,
    issueDate: v.issueDate,
    expiryDate: v.expiryDate,
    scope: v.scope,
  };
  const notes = {
    name: "notes",
    label: "Approval / revocation evidence notes",
    type: "textarea" as const,
    required: true,
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {v.certificateNumber} · v{v.version}
          </h1>
          <p>
            {complianceStatus(v, versions, today)}
            {expiresSoon(v, versions, today) ? " · Expires within 30 days" : ""}
          </p>
        </div>
        <Link href="/compliance">All certificates</Link>
      </div>
      <p>
        Product:{" "}
        <Link href={`/products/${v.productId}`}>
          {products.find((p) => p.id === v.productId)?.name}
        </Link>{" "}
        · Standard: {standards.find((x) => x.id === v.standardId)?.reference}
      </p>
      {v.specificationId && (
        <p>
          Linked specification:{" "}
          <Link href={`/specifications/${v.specificationId}`}>
            Open technical specification
          </Link>
        </p>
      )}
      <p>
        Issuer: {v.issuer} · Issued: {v.issueDate} · Expires: {v.expiryDate}
      </p>
      <p>Scope and limitations: {v.scope}</p>
      {can(actor.role, "compliance.manage") && (
        <div className="actions">
          {v.status === "Draft" && (
            <>
              <ActionForm
                label="Edit certification draft"
                action="editCertification"
                id={id}
                defaults={defaults}
                fields={certificationFields(
                  products,
                  standards.filter((x) => x.active),
                  specs,
                )}
              />
              <ActionForm
                label="Approve evidence and certify"
                action="approveCertification"
                id={id}
                fields={[notes]}
              />
            </>
          )}
          {v.status === "Approved" && (
            <ActionForm
              label="Revoke certification"
              action="revokeCertification"
              id={id}
              fields={[notes]}
            />
          )}
          {v.status !== "Draft" && v.version === latest && (
            <ActionForm
              label="Create new certification version"
              action="reviseCertification"
              id={id}
              defaults={defaults}
              fields={certificationFields(
                products,
                standards.filter((x) => x.active),
                specs,
              )}
            />
          )}
        </div>
      )}
      {can(actor.role, "compliance.manage") && v.status === "Draft" && (
        <ComplianceUpload id={id} materials={materials} suppliers={suppliers} />
      )}
      <h2>Supporting evidence</h2>
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            <a href={`/api/compliance/${id}/attachments/${f.id}`}>
              {f.kind} · {f.name}
            </a>
            {f.materialId
              ? ` · ${materials.find((x) => x.id === f.materialId)?.name}`
              : ""}
            {f.supplierId
              ? ` · ${suppliers.find((x) => x.id === f.supplierId)?.name}`
              : ""}
          </li>
        ))}
      </ul>
      <h2>Version history</h2>
      <ul>
        {versions
          .sort((a, b) => b.version - a.version)
          .map((x) => (
            <li key={x.id}>
              <Link href={`/compliance/${x.id}`}>
                v{x.version} · {complianceStatus(x, versions, today)} ·{" "}
                {x.certificateNumber}
              </Link>
            </li>
          ))}
      </ul>
      <h2>Audit history</h2>
      <DataTable
        columns={["Event", "Notes", "Date"].map((key) => ({ key, label: key }))}
        rows={events.map((e) => ({
          id: e.id,
          Event: e.event,
          Notes: e.notes,
          Date: e.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
