import Image from "next/image";
import Link from "next/link";
import type { getBranding } from "@/services/branding";
type Design = NonNullable<Awaited<ReturnType<typeof getBranding>>>;
export function BrandingSheet({
  design,
  showPricing = false,
  manufacturingQuantity,
}: {
  design: Design;
  showPricing?: boolean;
  manufacturingQuantity?: number;
}) {
  const { version: v, files } = design;
  const d = v.document;
  return (
    <article className="spec-sheet">
      <header>
        <p className="eyebrow">CUSTOMER BRANDING · {v.status.toUpperCase()}</p>
        <h1>
          {v.title} · v{v.version}
        </h1>
        <p>
          {v.snapshot.customer} · {v.snapshot.order} · {v.snapshot.quantity}{" "}
          units ordered · {v.snapshot.product}
        </p>
        {manufacturingQuantity !== undefined && (
          <p>
            <strong>
              Current manufacturing lot: {manufacturingQuantity} garments.
            </strong>
          </p>
        )}
        <p>
          {v.snapshot.sku} · {v.snapshot.size} / {v.snapshot.color}
        </p>
        <p>Change summary: {v.changeNote}</p>
        <p>
          Customer approver: {v.customerApprover ?? "Pending"} · Approval
          reference: {v.approvalReference ?? "Pending"} · Approved{" "}
          {v.approvedAt?.toISOString() ?? "Not approved"}
        </p>
        <Link
          className="text-link"
          href={`/specifications/${v.specificationId}?variantId=${v.snapshot.variantId}`}
        >
          Fixed product engineering specification
        </Link>
      </header>
      <h3>Customer design instructions</h3>
      <p>{d.customerInstructions || "—"}</p>
      <h3>Exact production instructions</h3>
      <p>{d.productionInstructions || "—"}</p>
      {d.fabricColor && (
        <section>
          <h3>Custom fabric color</h3>
          <p>
            {d.fabricColor} · {d.fabricColorStandard}
          </p>
        </section>
      )}
      <h3>Custom reflective tape configuration</h3>
      {d.reflectiveTape.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Width (mm)</th>
                <th>Color / grade</th>
                <th>Configuration</th>
              </tr>
            </thead>
            <tbody>
              {d.reflectiveTape.map((r, i) => (
                <tr key={i}>
                  <td>{r.location}</td>
                  <td>{r.widthMm}</td>
                  <td>{r.color}</td>
                  <td>{r.configuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No custom tape configuration.</p>
      )}
      <h2>Logos and decoration placement</h2>
      {d.placements.map((p, i) => {
        const logo = files.find(
          (f) => f.assetId === p.logoAssetId && f.purpose === "Logo",
        );
        return (
          <section className="spec-section" key={i}>
            <h3>
              {i + 1}. {p.technique} · {p.location}
            </h3>
            <p>
              Logo: {logo?.name ?? "Not attached"} · {p.widthMm} × {p.heightMm}{" "}
              mm
            </p>
            <p>Position: {p.positionInstructions}</p>
            <p>
              Colors: {p.colors}
              {p.thread ? ` · Thread: ${p.thread}` : ""}
            </p>
            <p>Application: {p.applicationInstructions}</p>
            {logo?.mime.startsWith("image/") && (
              <Image
                src={`/api/branding/${v.id}/files/${logo.id}`}
                alt={logo.name}
                width={220}
                height={150}
                unoptimized
                style={{ maxWidth: "100%", height: "auto" }}
              />
            )}
            {showPricing && (
              <p>
                {v.snapshot.currency} {p.unitPrice} / unit + {p.setupPrice}{" "}
                setup
              </p>
            )}
            {logo && (
              <Link
                className="text-link no-print"
                href={`/api/branding/${v.id}/files/${logo.id}`}
              >
                View exact company logo
              </Link>
            )}
          </section>
        );
      })}
      {showPricing && (
        <section className="spec-row">
          <h3>Customization pricing · {v.snapshot.currency}</h3>
          <p>
            {v.perUnit} per garment × {v.snapshot.quantity} + {v.setup} setup ={" "}
            <strong>{v.total}</strong>
          </p>
          <p className="muted">
            Separate customization service charge, before invoice tax. Applied
            to the order on approval.
          </p>
        </section>
      )}
      <h2>Private design proofs and references</h2>
      {files
        .filter(
          (f) =>
            f.purpose === "Reference" ||
            (f.purpose === "Design proof" && f.proofRevision === v.revision),
        )
        .map((f) => (
          <figure key={f.id}>
            <figcaption>
              {f.purpose}: {f.name}
              {f.purpose === "Design proof" && f.proofRevision !== v.revision
                ? " · OUTDATED PROOF — upload a new revision"
                : ""}
            </figcaption>
            {f.mime.startsWith("image/") && (
              <Image
                src={`/api/branding/${v.id}/files/${f.id}`}
                alt={f.name}
                width={700}
                height={450}
                unoptimized
                style={{ maxWidth: "100%", height: "auto" }}
              />
            )}
            <Link
              className="text-link no-print"
              href={`/api/branding/${v.id}/files/${f.id}`}
            >
              Open / download private {f.name}
            </Link>
          </figure>
        ))}
    </article>
  );
}
