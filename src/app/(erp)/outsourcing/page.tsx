import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import Decimal from "decimal.js";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { outsourcingTerms } from "@/lib/outsourcing-fields";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function OutsourcingPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "manufacturing") && !can(actor.role, "inventory"))
    notFound();
  const [orders, profiles, suppliers, mos, variants, receipts, costs, custody] =
    await Promise.all([
      db().select().from(s.outsourcingOrders),
      db().select().from(s.subcontractors),
      db().select().from(s.suppliers),
      db().select().from(s.manufacturing),
      db().select().from(s.variants),
      db().select().from(s.outsourcingReceipts),
      db().select().from(s.outsourcingCosts),
      db().select().from(s.outsourcingCustody),
    ]);
  const workshop = (id: string) =>
    suppliers.find(
      (p) => p.id === profiles.find((v) => v.id === id)?.supplierId,
    )?.name;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Outsourced manufacturing</h1>
          <p className="muted">
            Workshop assignments, external material custody and inspected
            delivery receipts.
          </p>
        </div>
      </div>
      <p>
        Material issue is a custody transfer, not consumption. The warehouse
        balance excludes issued material; outstanding material at subcontractors
        remains visible on each order until consumption or return is documented.
      </p>
      {can(actor.role, "manufacturing") && (
        <ActionForm
          label="New outsourcing order"
          action="createOutsourcing"
          fields={[
            {
              name: "manufacturingOrderId",
              label: "Draft manufacturing order / product / quantity",
              type: "select",
              options: mos
                .filter(
                  (m) =>
                    m.status === "Draft" &&
                    m.specificationId &&
                    !orders.some(
                      (o) =>
                        o.manufacturingOrderId === m.id &&
                        o.status !== "Cancelled",
                    ),
                )
                .map((m) => ({
                  value: m.id,
                  label: `${m.number} · ${variants.find((v) => v.id === m.variantId)?.sku} · ${m.quantity} units`,
                })),
              required: true,
            },
            {
              name: "subcontractorId",
              label: "Subcontractor",
              type: "select",
              options: profiles
                .filter((p) => p.active)
                .map((p) => ({ value: p.id, label: workshop(p.id) ?? p.id })),
              required: true,
            },
            ...outsourcingTerms,
          ]}
        />
      )}
      <DataTable
        href="outsourcing"
        rows={orders.map((o) => ({
          id: o.id,
          number: o.number,
          workshop: workshop(o.subcontractorId),
          status: o.status,
          due: o.dueDate,
          assigned: mos.find((m) => m.id === o.manufacturingOrderId)?.quantity,
          produced: o.produced,
          accepted: receipts
            .filter((r) => r.orderId === o.id)
            .reduce((n, r) => n + r.accepted, 0),
          rejected: receipts
            .filter((r) => r.orderId === o.id)
            .reduce((n, r) => n + r.rejected, 0),
          custody: custody.filter(
            (l) =>
              l.orderId === o.id &&
              new Decimal(l.quantity).minus(l.consumed).minus(l.returned).gt(0),
          ).length,
          cost: costs
            .filter((c) => c.orderId === o.id)
            .reduce((n, c) => n.add(c.amount), new Decimal(0))
            .toFixed(2),
          currency: o.currency,
        }))}
        columns={[
          { key: "number", label: "Order" },
          { key: "workshop", label: "Workshop" },
          { key: "status", label: "Status" },
          { key: "due", label: "Due date" },
          { key: "assigned", label: "Assigned" },
          { key: "produced", label: "Produced" },
          { key: "accepted", label: "Accepted" },
          { key: "rejected", label: "Rejected" },
          { key: "custody", label: "Outstanding custody lines" },
          { key: "cost", label: "Recorded cost" },
          { key: "currency", label: "Currency" },
        ]}
      />
      <Link href="/subcontractors">Subcontractor profiles and performance</Link>
    </>
  );
}
