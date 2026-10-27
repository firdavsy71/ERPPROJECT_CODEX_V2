import Link from "next/link";
import type { Actor } from "@/lib/permissions";
import { getBranding } from "@/services/branding";
import { BrandingSheet } from "./branding-sheet";
import { db } from "@/db";
import { inspections } from "@/db/schema";
import { eq } from "drizzle-orm";
export async function ManufacturingBranding({
  id,
  actor,
  quantity,
  orderId,
}: {
  id: string;
  actor: Actor;
  quantity: number;
  orderId: string;
}) {
  const design = await getBranding(actor, id);
  if (!design)
    return <p className="error">Fixed branding version could not be loaded.</p>;
  const [inspection] = await db()
    .select()
    .from(inspections)
    .where(eq(inspections.orderId, orderId));
  return (
    <section className="detail-card">
      <Link className="btn btn-outline no-print" href={`/branding/${id}`}>
        Open fixed branding proof & production sheet
      </Link>
      <BrandingSheet design={design} manufacturingQuantity={quantity} />
      <h3>Branding quality acceptance</h3>
      {inspection ? (
        <p>
          {inspection.brandingCheck ?? "Not recorded"} · {inspection.approved}{" "}
          accepted units · {inspection.createdAt.toISOString().slice(0, 10)}
          <br />
          {inspection.notes}
        </p>
      ) : (
        <p className="muted">Not inspected yet.</p>
      )}
    </section>
  );
}
