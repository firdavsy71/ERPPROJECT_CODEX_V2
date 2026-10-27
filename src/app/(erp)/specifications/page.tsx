import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { specifications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { DataTable } from "@/components/data-table";
import { z } from "zod";
export default async function SpecificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const { productId } = await searchParams;
  const rows = await db()
    .select()
    .from(specifications)
    .where(
      productId && z.uuid().safeParse(productId).success
        ? eq(specifications.productId, productId)
        : undefined,
    )
    .orderBy(desc(specifications.createdAt))
    .limit(500);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRODUCT ENGINEERING</p>
          <h1>Technical specifications</h1>
          <p className="muted">
            Versioned garment requirements, manufacturing instructions and
            quality criteria.
          </p>
        </div>
        {can(actor.role, "specifications") && (
          <Link
            className="btn btn-primary"
            href={`/specifications/new${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`}
          >
            New specification
          </Link>
        )}
      </div>
      <DataTable
        rows={rows.map((r) => ({
          id: r.id,
          title: r.title,
          product: r.productSnapshot.name,
          sku: r.productSnapshot.sku,
          version: r.version,
          status: r.status,
          created: r.createdAt.toISOString().slice(0, 10),
        }))}
        columns={[
          { key: "title", label: "Specification" },
          { key: "product", label: "Product" },
          { key: "sku", label: "SKU" },
          { key: "version", label: "Version" },
          { key: "status", label: "Approval" },
          { key: "created", label: "Created" },
        ]}
        href="specifications"
      />
      <p className="muted">
        Latest 500 versions. Search and sort the table; product detail links
        filter by product.
      </p>
    </>
  );
}
