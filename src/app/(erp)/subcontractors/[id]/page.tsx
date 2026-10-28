import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { profileFields } from "@/lib/outsourcing-fields";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function Profile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "manufacturing") && !can(actor.role, "suppliers"))
    notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [p] = await db()
    .select()
    .from(s.subcontractors)
    .where(eq(s.subcontractors.id, id));
  if (!p) notFound();
  const [supplier] = await db()
    .select()
    .from(s.suppliers)
    .where(eq(s.suppliers.id, p.supplierId));
  const [orders, receipts, mos] = await Promise.all([
    db()
      .select()
      .from(s.outsourcingOrders)
      .where(eq(s.outsourcingOrders.subcontractorId, id)),
    db().select().from(s.outsourcingReceipts),
    db().select().from(s.manufacturing),
  ]);
  return (
    <>
      <h1>{supplier.name}</h1>
      <p>
        {p.specialties} · {p.capacity} garments/month ·{" "}
        {p.active ? "Active" : "Archived"}
      </p>
      <p>{p.notes}</p>
      <Link href={`/suppliers/${p.supplierId}`}>Supplier contact details</Link>
      {can(actor.role, "suppliers") && (
        <ActionForm
          label="Edit / archive profile"
          action="saveSubcontractor"
          id={id}
          defaults={{
            supplierId: p.supplierId,
            specialties: p.specialties,
            capacity: String(p.capacity),
            notes: p.notes,
            active: String(p.active),
          }}
          fields={[
            {
              name: "supplierId",
              label: "Supplier",
              type: "select",
              options: [{ value: p.supplierId, label: supplier.name }],
              required: true,
            },
            ...profileFields,
          ]}
        />
      )}
      <h2>Performance history</h2>
      <DataTable
        href="outsourcing"
        rows={orders.map((o) => {
          const r = receipts.filter((r) => r.orderId === o.id);
          const accepted = r.reduce((n, v) => n + v.accepted, 0),
            rejected = r.reduce((n, v) => n + v.rejected, 0);
          const last = r
            .map((v) => v.createdAt.toISOString().slice(0, 10))
            .sort()
            .at(-1);
          return {
            id: o.id,
            order: o.number,
            status: o.status,
            assigned: mos.find((m) => m.id === o.manufacturingOrderId)
              ?.quantity,
            produced: o.produced,
            accepted,
            rejected,
            defect:
              accepted + rejected
                ? ((rejected * 100) / (accepted + rejected)).toFixed(2)
                : "—",
            due: o.dueDate,
            last,
            delivery:
              o.status === "Completed"
                ? last && last <= o.dueDate
                  ? "On time"
                  : "Late"
                : "Open",
          };
        })}
        columns={[
          { key: "order", label: "Order" },
          { key: "status", label: "Status" },
          { key: "assigned", label: "Assigned" },
          { key: "produced", label: "Produced" },
          { key: "accepted", label: "Accepted" },
          { key: "rejected", label: "Rejected" },
          { key: "defect", label: "Defect %" },
          { key: "due", label: "Due" },
          { key: "last", label: "Last receipt (UTC date)" },
          { key: "delivery", label: "Final delivery" },
        ]}
      />
      <Link href="/outsourcing">Outsourcing orders</Link>
    </>
  );
}
