import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { priceRuleFields, tierFields } from "@/lib/pricing-fields";
export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "pricing")) notFound();
  const { customerId: filter } = await searchParams;
  const customerId = z.uuid().safeParse(filter).success ? filter : undefined;
  const [rules, customers, variants, retirements, changes] = await Promise.all([
    db().select().from(s.pricingRules),
    db().select().from(s.customers),
    db().select().from(s.variants),
    db().select().from(s.pricingRetirements),
    db()
      .select()
      .from(s.audit)
      .where(eq(s.audit.action, "catalog-price-change")),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>B2B pricing & contracts</h1>
          <p className="muted">
            Approved contracts → customer prices → volume tiers → standard
            currency prices → catalog price in the company currency.
          </p>
        </div>
      </div>
      <p>
        One rule and one tier apply. Discounts never stack. Different currencies
        require explicit prices; there is no automatic FX. Minimum quantities
        apply before quotation approval. Approved rules remain in history;
        retire a rule before approving an overlapping replacement.
      </p>
      {can(actor.role, "pricing") && (
        <ActionForm
          label="New price list / contract version"
          action="savePricingRule"
          defaults={customerId ? { customerId, kind: "Customer" } : {}}
          fields={[
            {
              name: "variantId",
              label: "Product variant",
              type: "select",
              options: variants.map((v) => ({
                value: v.id,
                label: `${v.sku} · ${v.size} / ${v.color}`,
              })),
              required: true,
            },
            {
              name: "customerId",
              label: "Customer (required only for Contract / Customer)",
              type: "select",
              options: customers
                .filter((c) => c.active)
                .map((c) => ({ value: c.id, label: c.name })),
            },
            ...priceRuleFields,
          ]}
          lines={{
            name: "tiers",
            label:
              "Quantity tiers (next threshold is the exclusive upper bound)",
            fields: tierFields,
          }}
        />
      )}
      <DataTable
        href="pricing"
        rows={rules
          .filter(
            (r) => !customerId || !r.customerId || r.customerId === customerId,
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            customer:
              customers.find((c) => c.id === r.customerId)?.name ??
              "All customers",
            sku: variants.find((v) => v.id === r.variantId)?.sku,
            currency: r.currency,
            version: r.version,
            status: r.status,
            start: r.startDate,
            end: r.endDate,
            retired: retirements.find((e) => e.ruleId === r.id)?.effectiveDate,
            minimum: r.minimum,
          }))}
        columns={[
          { key: "name", label: "Contract / list" },
          { key: "kind", label: "Priority" },
          { key: "customer", label: "Customer" },
          { key: "sku", label: "Variant" },
          { key: "currency", label: "Currency" },
          { key: "version", label: "Version" },
          { key: "status", label: "Approval" },
          { key: "start", label: "Starts" },
          { key: "end", label: "Expires" },
          { key: "retired", label: "Retired from" },
          { key: "minimum", label: "MOQ" },
        ]}
      />
      <h2>Catalog base-price change history</h2>
      <DataTable
        rows={changes.map((c) => ({
          id: c.id,
          variant: variants.find((v) => v.id === c.entityId)?.sku,
          before: String((c.details as Record<string, unknown>)?.before ?? "—"),
          after: String((c.details as Record<string, unknown>)?.after ?? "—"),
          currency: String(
            (c.details as Record<string, unknown>)?.currency ?? "—",
          ),
          date: c.createdAt.toISOString(),
        }))}
        columns={[
          { key: "variant", label: "Variant" },
          { key: "before", label: "Previous price" },
          { key: "after", label: "New price" },
          { key: "currency", label: "Currency at change" },
          { key: "date", label: "Changed (UTC)" },
        ]}
      />
    </>
  );
}
