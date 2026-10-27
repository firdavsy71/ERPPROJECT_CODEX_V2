import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { priceRuleFields, tierFields } from "@/lib/pricing-fields";
export default async function PriceRule({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "pricing")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [r] = await db()
    .select()
    .from(s.pricingRules)
    .where(eq(s.pricingRules.id, id));
  if (!r) notFound();
  const [retirement] = await db()
    .select()
    .from(s.pricingRetirements)
    .where(eq(s.pricingRetirements.ruleId, id));
  const [v] = await db()
    .select()
    .from(s.variants)
    .where(eq(s.variants.id, r.variantId));
  const customers = await db().select().from(s.customers);
  const history = (await db().select().from(s.pricingRules)).filter(
    (p) =>
      p.variantId === r.variantId &&
      p.kind === r.kind &&
      p.customerId === r.customerId &&
      p.currency === r.currency,
  );
  const defaults: Record<string, string> = {
    name: r.name,
    kind: r.kind,
    customerId: r.customerId ?? "",
    variantId: r.variantId,
    currency: r.currency,
    startDate: r.startDate,
    endDate: r.endDate,
    minimum: String(r.minimum),
  };
  r.tiers.forEach((tier, i) => {
    defaults[`tiers__${i}__minQty`] = String(tier.minQty);
    defaults[`tiers__${i}__mode`] = tier.mode;
    defaults[`tiers__${i}__value`] = tier.value;
  });
  return (
    <>
      <h1>
        {r.name} · v{r.version}
      </h1>
      <p>
        {r.status} · {r.kind} · {v.sku} · {r.currency} · MOQ {r.minimum} ·{" "}
        {r.startDate}–{r.endDate}
      </p>
      {r.customerId && (
        <Link href={`/customers/${r.customerId}`}>
          {customers.find((c) => c.id === r.customerId)?.name}
        </Link>
      )}
      {retirement && (
        <p>
          Retired from {retirement.effectiveDate}: {retirement.reason}
        </p>
      )}
      <DataTable
        rows={r.tiers.map((t, i) => ({
          id: String(i),
          from: t.minQty,
          to: r.tiers[i + 1] ? r.tiers[i + 1].minQty - 1 : "Unlimited",
          mode: t.mode,
          value: t.value,
        }))}
        columns={[
          { key: "from", label: "From units" },
          { key: "to", label: "Through units" },
          { key: "mode", label: "Price or discount" },
          { key: "value", label: "Value" },
        ]}
      />
      <div className="actions">
        {r.status === "Draft" && can(actor.role, "pricing") && (
          <ActionForm
            label="Edit draft price rule"
            action="savePricingRule"
            id={id}
            defaults={defaults}
            initialLineCount={r.tiers.length}
            fields={[
              {
                name: "variantId",
                label: "Product variant",
                type: "select",
                options: [{ value: v.id, label: v.sku }],
                required: true,
              },
              {
                name: "customerId",
                label: "Customer (only for Contract / Customer)",
                type: "select",
                options: customers.map((c) => ({ value: c.id, label: c.name })),
              },
              ...priceRuleFields,
            ]}
            lines={{
              name: "tiers",
              label: "Quantity tiers",
              fields: tierFields,
            }}
          />
        )}
        {r.status === "Draft" && can(actor.role, "pricing.approve") && (
          <>
            <ActionForm
              label="Approve pricing rule"
              action="approvePricingRule"
              id={id}
            />
            <ActionForm
              label="Reject pricing rule"
              action="rejectPricingRule"
              id={id}
            />
          </>
        )}
        {r.status === "Approved" &&
          !retirement &&
          can(actor.role, "pricing.approve") && (
            <ActionForm
              label="Retire / schedule replacement"
              action="retirePricingRule"
              id={id}
              fields={[
                {
                  name: "effectiveDate",
                  label: "No longer applicable from",
                  type: "date",
                  required: true,
                },
                {
                  name: "reason",
                  label: "Change reason",
                  type: "textarea",
                  required: true,
                },
              ]}
            />
          )}
      </div>
      <h2>Price change history</h2>
      <DataTable
        href="pricing"
        rows={history.map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version,
          status: p.status,
          start: p.startDate,
          end: p.endDate,
          tiers: p.tiers
            .map((t) => `${t.minQty}+: ${t.mode} ${t.value}`)
            .join("; "),
        }))}
        columns={[
          { key: "name", label: "Version" },
          { key: "version", label: "Revision" },
          { key: "status", label: "Approval" },
          { key: "start", label: "Start" },
          { key: "end", label: "End" },
          { key: "tiers", label: "Published tier values" },
        ]}
      />
      <Link href="/pricing">All prices and contracts</Link>
    </>
  );
}
