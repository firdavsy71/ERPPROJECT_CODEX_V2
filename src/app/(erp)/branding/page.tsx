import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import { brandingVersions } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { DataTable } from "@/components/data-table";
import { z } from "zod";
import { BrandingStorageCheck } from "@/components/branding-controls";
export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "branding.read")) notFound();
  const { productId } = await searchParams;
  const rows = await db()
    .select()
    .from(brandingVersions)
    .where(
      productId && z.uuid().safeParse(productId).success
        ? sql`${brandingVersions.snapshot}->>'productId'=${productId}`
        : undefined,
    )
    .orderBy(desc(brandingVersions.createdAt))
    .limit(500);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER DESIGN / BRANDING</p>
          <h1>Custom branding</h1>
          <p className="muted">
            Company artwork, decoration pricing, approved proofs and fixed
            production instructions.
          </p>
        </div>
        {can(actor.role, "branding") && (
          <Link className="btn btn-primary" href="/branding/new">
            New branding request
          </Link>
        )}
      </div>
      {actor.role === "admin" && <BrandingStorageCheck />}
      <DataTable
        rows={rows.map((v) => ({
          id: v.id,
          title: v.title,
          customer: v.snapshot.customer,
          order: v.snapshot.order,
          variant: v.snapshot.sku,
          version: v.version,
          status: v.status,
          ...(can(actor.role, "branding")
            ? { currency: v.snapshot.currency, total: v.total }
            : {}),
        }))}
        columns={[
          { key: "title", label: "Design" },
          { key: "customer", label: "Customer" },
          { key: "order", label: "Order" },
          { key: "variant", label: "Variant" },
          { key: "version", label: "Version" },
          { key: "status", label: "Approval" },
          ...(can(actor.role, "branding")
            ? [
                { key: "currency", label: "Currency" },
                { key: "total", label: "Customization total" },
              ]
            : []),
        ]}
        href="branding"
      />
      <p className="muted">
        Latest 500 design versions. Requests attach to existing sales lines and
        product variants.
      </p>
    </>
  );
}
