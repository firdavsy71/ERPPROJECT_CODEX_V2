import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import * as s from "@/db/schema";
import { complianceStatus, expiresSoon } from "@/services/compliance";
import { certificationFields } from "@/lib/compliance-fields";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { z } from "zod";
import { businessDate } from "@/i18n/format";
export default async function Compliance({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; specificationId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "compliance.read")) notFound();
  const search = await searchParams;
  const [versions, standards, products, specs, company] = await Promise.all([
    db().select().from(s.certifications),
    db().select().from(s.safetyStandards),
    db().select().from(s.products),
    db().select().from(s.specifications),
    db().select({ timezone: s.settings.timezone }).from(s.settings).limit(1),
  ]);
  const today = businessDate(new Date(), company[0]?.timezone);
  const filterProduct = z.uuid().safeParse(search.productId).success
    ? search.productId
    : undefined;
  const filterSpec = z.uuid().safeParse(search.specificationId).success
    ? search.specificationId
    : undefined;
  const rows = versions.filter(
    (v) =>
      (!filterProduct || v.productId === filterProduct) &&
      (!filterSpec || v.specificationId === filterSpec),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compliance & certificates</h1>
          <p>
            Certification is based on approved evidence for the stated scope and
            dates.
          </p>
        </div>
      </div>
      <p>
        Reflective materials and garment construction do not establish
        certification. An expired, revoked, draft or future certificate is not
        shown as certified.
      </p>
      {rows.filter((v) => expiresSoon(v, versions, today)).length > 0 && (
        <p role="status">
          Expiration alert:{" "}
          {rows.filter((v) => expiresSoon(v, versions, today)).length} approved
          certificate version(s) expire within 30 days.
        </p>
      )}
      {can(actor.role, "compliance.manage") && (
        <div className="actions">
          <ActionForm
            label="Add safety standard reference"
            action="createSafetyStandard"
            fields={[
              {
                name: "reference",
                label: "Standard reference",
                required: true,
              },
              { name: "title", label: "Standard title", required: true },
              { name: "notes", label: "Reference notes", type: "textarea" },
            ]}
          />
          <ActionForm
            label="Edit an unused standard"
            action="editSafetyStandard"
            fields={[
              {
                name: "id",
                label: "Standard",
                type: "select",
                required: true,
                options: standards
                  .filter((x) => !versions.some((v) => v.standardId === x.id))
                  .map((x) => ({ value: x.id, label: x.reference })),
              },
              {
                name: "reference",
                label: "Standard reference",
                required: true,
              },
              { name: "title", label: "Standard title", required: true },
              { name: "notes", label: "Reference notes", type: "textarea" },
            ]}
          />
          <ActionForm
            label="Archive a standard"
            action="archiveSafetyStandard"
            fields={[
              {
                name: "id",
                label: "Standard",
                type: "select",
                required: true,
                options: standards
                  .filter((x) => x.active)
                  .map((x) => ({ value: x.id, label: x.reference })),
              },
            ]}
          />
          <ActionForm
            label="Create certification draft"
            action="createCertification"
            defaults={{
              ...(filterProduct ? { productId: filterProduct } : {}),
              ...(filterSpec ? { specificationId: filterSpec } : {}),
            }}
            fields={certificationFields(
              products,
              standards.filter((x) => x.active),
              specs,
            )}
          />
        </div>
      )}
      <DataTable
        href="compliance"
        columns={[
          "Certificate",
          "Product",
          "Standard",
          "Version",
          "Status",
          "Expiry",
          "Alert",
        ].map((key) => ({ key, label: key }))}
        rows={rows.map((v) => ({
          id: v.id,
          Certificate: v.certificateNumber,
          Product: products.find((p) => p.id === v.productId)?.name ?? "",
          Standard:
            standards.find((x) => x.id === v.standardId)?.reference ?? "",
          Version: v.version,
          Status: complianceStatus(v, versions, today),
          Expiry: v.expiryDate,
          Alert: expiresSoon(v, versions, today)
            ? "Expires within 30 days"
            : "",
        }))}
      />
      <h2>Safety standard references</h2>
      <DataTable
        columns={["Reference", "Title", "Notes"].map((key) => ({
          key,
          label: key,
        }))}
        rows={standards.map((x) => ({
          id: x.id,
          Reference: x.reference,
          Title: x.title,
          Notes: x.notes ?? "",
        }))}
      />
      {(filterProduct || filterSpec) && (
        <p>
          <Link href="/compliance">View all certificates</Link>
        </p>
      )}
    </>
  );
}
