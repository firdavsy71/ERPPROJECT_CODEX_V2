import Image from "next/image";
import Link from "next/link";
import type { getSpecification } from "@/services/specifications";
import { effectiveMeasurements } from "@/lib/specification";
type Spec = NonNullable<Awaited<ReturnType<typeof getSpecification>>>;
function Table({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, string | number>[];
}) {
  return (
    <section className="spec-section">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {Object.keys(rows[0]).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {Object.entries(r).map(([k, v]) => (
                    <td key={k}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Not required / not specified for this version.</p>
      )}
    </section>
  );
}
export function SpecificationSheet({
  spec,
  variantId,
}: {
  spec: Spec;
  variantId?: string;
}) {
  const { version: v } = spec;
  const d = v.document;
  const covered = variantId
    ? spec.variants.filter((r) => r.variantId === variantId)
    : spec.variants;
  return (
    <article className="spec-sheet">
      <header>
        <p className="eyebrow">
          PRODUCT TECHNICAL SPECIFICATION · {v.status.toUpperCase()}
        </p>
        <h1>{v.title}</h1>
        <p>
          {v.productSnapshot.name} · {v.productSnapshot.sku} · Version{" "}
          {v.version} · {d.garmentType}
        </p>
        <p>
          Created {v.createdAt.toISOString().slice(0, 10)} · Approved{" "}
          {v.approvedAt?.toISOString().slice(0, 10) ?? "Not approved"}
        </p>
        {v.approvedBy && <p>Approval reference: {v.approvedBy}</p>}
        <p>Change summary: {v.changeNote}</p>
        {v.reviewNote && <p>Review: {v.reviewNote}</p>}
      </header>
      <h3>Description</h3>
      <p>{d.description || "—"}</p>
      <h3>Garment construction</h3>
      <p>{d.construction || "—"}</p>
      <h3>Manufacturing instructions</h3>
      <p>{d.manufacturingInstructions || "—"}</p>
      <Table
        title="Fabric specification"
        rows={d.fabrics.map((f) => ({
          Fabric: f.name,
          "Weight (g/m²)": f.weightGsm,
          Composition: f.composition
            .map((c) => `${c.fiber} ${c.percent}%`)
            .join(" / "),
          Weave: f.weave,
          Finish: f.finish,
        }))}
      />
      <Table
        title="Size chart & measurement table"
        rows={d.measurements.map((m) => ({
          Point: m.point,
          Size: m.size,
          Target: m.target,
          "Tolerance ±": m.tolerance,
          Unit: m.unit,
        }))}
      />
      <Table
        title="Stitching & seam requirements"
        rows={d.seams.map((r) => ({
          Location: r.location,
          Stitch: r.stitchType,
          Seam: r.seamType,
          "Stitches/cm": r.stitchesPerCm,
          Thread: r.thread,
          "Allowance (mm)": r.allowanceMm,
        }))}
      />
      <Table
        title="Reflective tape placement"
        rows={d.reflectiveTape.map((r) => ({
          Location: r.location,
          "Width (mm)": r.widthMm,
          Placement: r.placement,
          Standard: r.standard,
        }))}
      />
      <Table
        title="Zippers, buttons & accessories"
        rows={d.accessories.map((r) => ({
          Type: r.type,
          Specification: r.description,
          Quantity: r.quantity,
          Placement: r.placement,
        }))}
      />
      <h2>Variant manufacturing specifications</h2>
      {covered.map((r) => (
        <section className="spec-section" key={r.id}>
          <h3>
            {r.snapshot.sku} · {r.snapshot.size} / {r.snapshot.color}
          </h3>
          <p>
            Fabric consumption per unit:{" "}
            <strong>
              {r.fabricConsumption} {r.consumptionUnit}
            </strong>
          </p>
          <p>{r.instructions || d.manufacturingInstructions}</p>
          <Table
            title="Effective variant measurements"
            rows={effectiveMeasurements(d, r).map((m) => ({
              Point: m.point,
              Size: m.size,
              Target: m.target,
              "Tolerance ±": m.tolerance,
              Unit: m.unit,
            }))}
          />
        </section>
      ))}
      <h3>Quality acceptance criteria</h3>
      <ol>
        {d.qualityChecks.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      <h2>Technical drawings & references</h2>
      {spec.attachments.map((a) => (
        <figure key={a.id}>
          <figcaption>
            {a.kind}: {a.name}
          </figcaption>
          {a.mime.startsWith("image/") && (
            <Image
              src={`/api/specifications/${v.id}/attachments/${a.id}`}
              alt={a.name}
              width={800}
              height={550}
              unoptimized
              style={{ maxWidth: "100%", height: "auto", objectFit: "contain" }}
            />
          )}
          <Link
            className="text-link no-print"
            href={`/api/specifications/${v.id}/attachments/${a.id}`}
          >
            Open / download {a.name}
          </Link>
        </figure>
      ))}
    </article>
  );
}
