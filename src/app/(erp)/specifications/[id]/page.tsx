import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { getSpecification } from "@/services/specifications";
import { SpecificationSheet } from "@/components/specification-sheet";
import { SpecificationEditor } from "@/components/specification-editor";
import {
  SpecificationControls,
  AttachmentUploader,
  RemoveAttachment,
} from "@/components/specification-controls";
import { db } from "@/db";
import {
  products,
  variants,
  boms,
  manufacturing,
  inspections,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { brandingVersions } from "@/db/schema";
import { z } from "zod";
export default async function SpecificationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; variantId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const spec = await getSpecification(id);
  if (!spec) notFound();
  const { edit, variantId } = await searchParams;
  const editable = can(actor.role, "specifications");
  const version = spec.version;
  if (edit === "1" && editable && version.status === "Draft") {
    const [p, v] = await Promise.all([
      db().select({ id: products.id, name: products.name }).from(products),
      db()
        .select()
        .from(variants)
        .where(eq(variants.productId, version.productId)),
    ]);
    return (
      <>
        <Link href={`/specifications/${id}`}>← Back to sheet</Link>
        <h1>Edit draft · v{version.version}</h1>
        <SpecificationEditor
          products={p}
          variants={v}
          initial={{
            id,
            productId: version.productId,
            title: version.title,
            changeNote: version.changeNote,
            revision: version.revision,
            document: version.document,
            variants: spec.variants,
          }}
        />
      </>
    );
  }
  const [linkedBoms, orders, qc, branding] = await Promise.all([
    db().select().from(boms).where(eq(boms.specificationId, id)),
    db()
      .select()
      .from(manufacturing)
      .where(eq(manufacturing.specificationId, id)),
    db().select().from(inspections).where(eq(inspections.specificationId, id)),
    can(actor.role, "branding.read")
      ? db()
          .select()
          .from(brandingVersions)
          .where(eq(brandingVersions.specificationId, id))
      : Promise.resolve([]),
  ]);
  return (
    <>
      <div className="no-print">
        {can(actor.role, "compliance.read") && (
          <Link href={`/compliance?specificationId=${id}&productId=${version.productId}`}>
            Certificates linked to this specification
          </Link>
        )}
        <Link href={`/products/${version.productId}`} className="back-link">
          ← Product
        </Link>
        <div className="section-heading">
          <h1>Technical specification · v{version.version}</h1>
          <span className="badge">{version.status}</span>
        </div>
        <SpecificationControls
          id={id}
          status={version.status}
          edit={editable}
          approve={actor.role === "admin"}
        />
        {editable && version.status === "Draft" && (
          <Link
            className="btn btn-outline"
            href={`/specifications/${id}?edit=1`}
          >
            Edit draft
          </Link>
        )}
        <section className="detail-card">
          <h2>Version history</h2>
          <div className="spec-history">
            {spec.history.map((v) => (
              <Link key={v.id} href={`/specifications/${v.id}`}>
                <strong>
                  v{v.version} · {v.status}
                </strong>
                <span>{v.changeNote}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <section className="detail-card">
        <SpecificationSheet spec={spec} variantId={variantId} />
      </section>
      <section className="detail-card no-print">
        <h2>Attachments</h2>
        {spec.attachments.map((a) => (
          <div className="actions" key={a.id}>
            <Link href={`/api/specifications/${id}/attachments/${a.id}`}>
              {a.name} · {a.kind} · {Math.ceil(a.bytes / 1024)} KiB
            </Link>
            {editable && version.status === "Draft" && (
              <RemoveAttachment id={id} attachmentId={a.id} />
            )}
          </div>
        ))}
        {editable && version.status === "Draft" && (
          <AttachmentUploader id={id} />
        )}
        <h3>Linked BOM versions</h3>
        {branding.length > 0 && (
          <>
            <h3>Customer-specific branding versions</h3>
            {branding.map((v) => (
              <p key={v.id}>
                <Link className="text-link" href={`/branding/${v.id}`}>
                  {v.snapshot.customer} · {v.title} v{v.version} · {v.status}
                </Link>
              </p>
            ))}
          </>
        )}
        {linkedBoms.map((b) => (
          <p key={b.id}>
            <Link className="text-link" href={`/boms/${b.id}`}>
              BOM v{b.version}
            </Link>
          </p>
        ))}
        <h3>Manufacturing orders using this exact version</h3>
        {orders.map((o) => (
          <p key={o.id}>
            <Link className="text-link" href={`/manufacturing/${o.id}`}>
              {o.number} · {o.status}
            </Link>
          </p>
        ))}
        <h3>Quality control records</h3>
        {qc.map((q) => (
          <div key={q.id}>
            <Link className="text-link" href={`/manufacturing/${q.orderId}`}>
              {q.createdAt.toISOString().slice(0, 10)} · {q.approved} approved /{" "}
              {q.rejected} rejected
            </Link>
            <ul>
              {q.specificationResults?.map((r) => (
                <li key={r.check}>
                  {r.check}: {r.result}
                  {r.notes ? ` — ${r.notes}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
