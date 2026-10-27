import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function Quotations({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "quotations")) notFound();
  const { customerId: filter } = await searchParams;
  const customerId = z.uuid().safeParse(filter).success ? filter : undefined;
  const [quotes, customers, variants] = await Promise.all([
    db().select().from(s.quotations),
    db().select().from(s.customers),
    db().select().from(s.variants),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Quotations</h1>
          <p className="muted">
            Server-calculated B2B prices. Draft → administrator approval → sales
            order. Prices, discounts and rule versions are preserved.
          </p>
        </div>
      </div>
      {can(actor.role, "quotations") && (
        <ActionForm
          label="New priced quotation"
          action="createQuotation"
          defaults={customerId ? { customerId } : {}}
          fields={[
            {
              name: "customerId",
              label: "Customer",
              type: "select",
              options: customers
                .filter((c) => c.active)
                .map((c) => ({ value: c.id, label: c.name })),
              required: true,
            },
            {
              name: "currency",
              label: "Currency",
              type: "select",
              options: ["UZS", "USD"].map((c) => ({ value: c, label: c })),
              required: true,
            },
            {
              name: "validUntil",
              label: "Quotation valid through",
              type: "date",
              required: true,
            },
            {
              name: "notes",
              label:
                "Commercial terms (product prices exclude additional branding and tax)",
              type: "textarea",
            },
          ]}
          lines={{
            name: "lines",
            label: "Products (combine quantity for each variant)",
            fields: [
              {
                name: "itemId",
                label: "Variant",
                type: "select",
                options: variants.map((v) => ({ value: v.id, label: v.sku })),
                required: true,
              },
              {
                name: "quantity",
                label: "Quantity",
                type: "number",
                required: true,
              },
            ],
          }}
        />
      )}
      <DataTable
        href="quotations"
        rows={quotes
          .filter((q) => !customerId || q.customerId === customerId)
          .map((q) => ({
            id: q.id,
            number: q.number,
            customer: customers.find((c) => c.id === q.customerId)?.name,
            status: q.status,
            valid: q.validUntil,
            total: q.total,
            currency: q.currency,
          }))}
        columns={[
          { key: "number", label: "Quotation" },
          { key: "customer", label: "Customer" },
          { key: "status", label: "Approval" },
          { key: "valid", label: "Valid through" },
          { key: "total", label: "Product total" },
          { key: "currency", label: "Currency" },
        ]}
      />
    </>
  );
}
