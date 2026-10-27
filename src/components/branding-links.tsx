import Link from "next/link";
import { db } from "@/db";
import { brandingRequests, brandingVersions } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
export async function SalesBrandingLinks({
  lines,
  editable,
}: {
  lines: { id: string; label: string; total: string }[];
  editable: boolean;
}) {
  if (!lines.length) return null;
  const rows = await db()
    .select({
      lineId: brandingRequests.saleItemId,
      id: brandingVersions.id,
      title: brandingVersions.title,
      version: brandingVersions.version,
      status: brandingVersions.status,
      approvedId: brandingRequests.approvedVersionId,
    })
    .from(brandingRequests)
    .innerJoin(
      brandingVersions,
      eq(brandingVersions.requestId, brandingRequests.id),
    )
    .where(
      inArray(
        brandingRequests.saleItemId,
        lines.map((l) => l.id),
      ),
    )
    .orderBy(desc(brandingVersions.version));
  return (
    <section className="spec-section">
      <h3>Customer branding by order line</h3>
      {lines.map((l) => {
        const row = rows.find((r) => r.lineId === l.id);
        return (
          <div className="spec-row" key={l.id}>
            <strong>{l.label}</strong>
            <p>Applied customization charge: {l.total}</p>
            {row ? (
              <>
                <Link className="text-link" href={`/branding/${row.id}`}>
                  {row.title} · v{row.version} · {row.status}
                </Link>
                {row.approvedId && row.approvedId !== row.id && (
                  <p>
                    <Link
                      className="text-link"
                      href={`/branding/${row.approvedId}`}
                    >
                      Current approved design
                    </Link>
                  </p>
                )}
              </>
            ) : editable ? (
              <Link
                className="text-link"
                href={`/branding/new?saleItemId=${l.id}`}
              >
                Request customer branding
              </Link>
            ) : (
              <p className="muted">No branding requested.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
