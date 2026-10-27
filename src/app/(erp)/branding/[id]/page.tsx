import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { getBranding } from "@/services/branding";
import { brandingEditorChoices } from "@/services/branding-queries";
import { brandingStorageConfigured } from "@/services/branding-storage";
import { BrandingEditor } from "@/components/branding-editor";
import { BrandingSheet } from "@/components/branding-sheet";
import {
  BrandingControls,
  BrandingUpload,
  BrandingRemoveFile,
} from "@/components/branding-controls";
import { z } from "zod";
import { db } from "@/db";
import { manufacturing } from "@/db/schema";
import { eq } from "drizzle-orm";
export default async function BrandingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "branding.read")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const design = await getBranding(actor, id);
  if (!design) notFound();
  const { version: v } = design;
  const edit = can(actor.role, "branding");
  const search = await searchParams;
  if (search.edit === "1" && edit && v.status === "Draft") {
    const choices = await brandingEditorChoices(design.request.saleItemId);
    return (
      <>
        <Link href={`/branding/${id}`}>← Branding sheet</Link>
        <h1>Edit branding draft · v{v.version}</h1>
        <BrandingEditor
          {...choices}
          logos={design.files.filter((f) => f.purpose === "Logo")}
          initial={{
            id,
            saleItemId: design.request.saleItemId,
            specificationId: v.specificationId,
            title: v.title,
            changeNote: v.changeNote,
            revision: v.revision,
            document: v.document,
          }}
        />
      </>
    );
  }
  const orders = await db()
    .select()
    .from(manufacturing)
    .where(eq(manufacturing.brandingVersionId, id));
  return (
    <>
      <div className="no-print">
        <Link className="back-link" href={`/sales/${v.snapshot.orderId}`}>
          ← Sales order {v.snapshot.order}
        </Link>
        <div className="section-heading">
          <h1>Customer branding · v{v.version}</h1>
          <span className="badge">{v.status}</span>
        </div>
        {design.request.approvedVersionId &&
          design.request.approvedVersionId !== id && (
            <p className="muted">
              This is not the currently selected approved design. Existing
              manufacturing orders retain their fixed version.{" "}
              <Link
                className="text-link"
                href={`/branding/${design.request.approvedVersionId}`}
              >
                View current approved design
              </Link>
            </p>
          )}
        <BrandingControls
          id={id}
          status={v.status}
          edit={edit}
          approve={can(actor.role, "branding.approve")}
        />
        {edit && v.status === "Draft" && (
          <Link className="btn btn-outline" href={`/branding/${id}?edit=1`}>
            Edit branding draft
          </Link>
        )}
        <section className="detail-card">
          <h2>Design revision history</h2>
          <div className="spec-history">
            {design.history.map((h) => (
              <Link key={h.id} href={`/branding/${h.id}`}>
                <strong>
                  v{h.version} · {h.status}
                </strong>
                <span>{h.changeNote}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <section className="detail-card">
        <BrandingSheet design={design} showPricing={edit} />
      </section>
      <section className="detail-card no-print">
        <h2>Secure company files</h2>
        {design.files.map((f) => (
          <div className="spec-row" key={f.id}>
            <Link
              className="text-link"
              href={`/api/branding/${id}/files/${f.id}`}
            >
              {f.purpose}: {f.name} · {Math.ceil(f.bytes / 1024)} KiB
            </Link>
            <p className="muted">SHA-256: {f.sha256}</p>
            {f.purpose === "Design proof" && f.proofRevision !== v.revision && (
              <p className="error">
                Proof belongs to an older draft revision. Upload a new proof
                after saving your changes.
              </p>
            )}
            {edit && v.status === "Draft" && (
              <BrandingRemoveFile id={id} fileId={f.id} />
            )}
          </div>
        ))}
        {edit && v.status === "Draft" && (
          <BrandingUpload
            id={id}
            revision={v.revision}
            configured={brandingStorageConfigured()}
          />
        )}
        <h3>Manufacturing using this exact approved design</h3>
        {orders.map((o) => (
          <p key={o.id}>
            <Link className="text-link" href={`/manufacturing/${o.id}`}>
              {o.number} · {o.status}
            </Link>
          </p>
        ))}
      </section>
    </>
  );
}
