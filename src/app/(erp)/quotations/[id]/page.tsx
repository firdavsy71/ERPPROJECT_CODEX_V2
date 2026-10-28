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
import { discountedLineTotal } from "@/lib/money";
export default async function Quotation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "quotations")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [q] = await db()
    .select()
    .from(s.quotations)
    .where(eq(s.quotations.id, id));
  if (!q) notFound();
  const [customers, variants, sales] = await Promise.all([
    db().select().from(s.customers),
    db().select().from(s.variants),
    db().select().from(s.sales).where(eq(s.sales.quotationId, id)),
  ]);
  const defaults: Record<string, string> = {
    customerId: q.customerId,
    currency: q.currency,
    validUntil: q.validUntil,
    notes: q.notes,
  };
  q.lines.forEach((l, i) => {
    defaults[`lines__${i}__itemId`] = l.itemId;
    defaults[`lines__${i}__quantity`] = String(l.quantity);
  });
  return (
    <>
      <h1>{q.number}</h1>
      <p><Link href={`/documents/quotation/${id}`}>Printable quotation / PDF</Link></p>
      <p>
        {q.status} · valid through {q.validUntil} · product total {q.total}{" "}
        {q.currency}
      </p>
      <Link href={`/customers/${q.customerId}`}>
        {customers.find((c) => c.id === q.customerId)?.name}
      </Link>
      <p>{q.notes}</p>
      <DataTable
        rows={q.lines.map((l) => ({
          id: l.itemId,
          sku: variants.find((v) => v.id === l.itemId)?.sku,
          quantity: l.quantity,
          price: l.price,
          discount: l.discount,
          total: discountedLineTotal(l.quantity, l.price, l.discount),
          source: String(l.snapshot.source),
          version: l.snapshot.version ? String(l.snapshot.version) : "—",
          day: String(l.snapshot.asOf),
        }))}
        columns={[
          { key: "sku", label: "Product variant" },
          { key: "quantity", label: "Quantity" },
          { key: "price", label: `Unit price (${q.currency})` },
          { key: "discount", label: "Exclusive discount %" },
          { key: "total", label: "Line total" },
          { key: "source", label: "Pricing source" },
          { key: "version", label: "Rule version" },
          { key: "day", label: "Pricing date" },
        ]}
      />
      <div className="actions">
        {q.status === "Draft" && can(actor.role, "quotations") && (
          <ActionForm
            label="Edit / recalculate draft"
            action="editQuotation"
            id={id}
            defaults={defaults}
            initialLineCount={q.lines.length}
            fields={[
              {
                name: "customerId",
                label: "Customer",
                type: "select",
                options: customers.map((c) => ({ value: c.id, label: c.name })),
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
              { name: "notes", label: "Commercial terms", type: "textarea" },
            ]}
            lines={{
              name: "lines",
              label: "Quotation products",
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
        {q.status === "Draft" && can(actor.role, "pricing.approve") && (
          <>
            <ActionForm
              label="Approve quotation prices"
              action="approveQuotation"
              id={id}
            />
            <ActionForm
              label="Reject quotation"
              action="rejectQuotation"
              id={id}
            />
          </>
        )}
        {q.status === "Approved" && can(actor.role, "quotations") && (
          <ActionForm
            label="Convert approved quotation to sales order"
            action="convertQuotation"
            id={id}
          />
        )}
      </div>
      {sales.map((o) => (
        <p key={o.id}>
          <Link href={`/sales/${o.id}`}>
            {o.number} · {o.status}
          </Link>
        </p>
      ))}
      <Link href="/quotations">All quotations</Link>
    </>
  );
}
