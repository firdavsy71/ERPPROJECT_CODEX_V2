import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
export async function brandingEditorChoices(saleItemId?: string) {
  const [lines, specs] = await Promise.all([
    db()
      .select({
        id: s.saleItems.id,
        variantId: s.variants.id,
        productId: s.variants.productId,
        quantity: s.saleItems.quantity,
        currency: s.sales.currency,
        order: s.sales.number,
        customer: s.customers.name,
        sku: s.variants.sku,
      })
      .from(s.saleItems)
      .innerJoin(s.sales, eq(s.sales.id, s.saleItems.orderId))
      .innerJoin(s.customers, eq(s.customers.id, s.sales.customerId))
      .innerJoin(s.variants, eq(s.variants.id, s.saleItems.variantId))
      .where(
        saleItemId
          ? or(eq(s.sales.status, "Draft"), eq(s.saleItems.id, saleItemId))
          : eq(s.sales.status, "Draft"),
      )
      .limit(1000),
    db()
      .select({
        id: s.specifications.id,
        title: s.specifications.title,
        version: s.specifications.version,
        variantId: s.specificationVariants.variantId,
      })
      .from(s.specifications)
      .innerJoin(
        s.specificationVariants,
        eq(s.specificationVariants.specificationId, s.specifications.id),
      )
      .where(eq(s.specifications.status, "Approved"))
      .orderBy(desc(s.specifications.version))
      .limit(1000),
  ]);
  return {
    lines: lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      productId: l.productId,
      quantity: l.quantity,
      currency: l.currency,
      label: `${l.order} · ${l.customer} · ${l.sku} · ${l.quantity} units`,
    })),
    specs: specs.map((s) => ({
      id: s.id,
      variantId: s.variantId,
      label: `${s.title} · v${s.version}`,
    })),
  };
}
export async function latestBrandingForLine(saleItemId: string) {
  const [row] = await db()
    .select({ id: s.brandingVersions.id })
    .from(s.brandingRequests)
    .innerJoin(
      s.brandingVersions,
      eq(s.brandingVersions.requestId, s.brandingRequests.id),
    )
    .where(eq(s.brandingRequests.saleItemId, saleItemId))
    .orderBy(desc(s.brandingVersions.version))
    .limit(1);
  return row?.id;
}
