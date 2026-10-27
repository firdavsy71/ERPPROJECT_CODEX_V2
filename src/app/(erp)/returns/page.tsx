import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { returnReasons } from "@/services/returns";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { z } from "zod";
export default async function Returns({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string; orderId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "returns.read")) notFound();
  const filter = await searchParams;
  const [
    rmas,
    items,
    receipts,
    shipmentItems,
    shipments,
    deliveries,
    legacy,
    invoices,
    sales,
    lines,
    variants,
    customers,
  ] = await Promise.all([
    db().select().from(s.returnOrders),
    db().select().from(s.returnItems),
    db().select().from(s.returnReceipts),
    db().select().from(s.shipmentItems),
    db().select().from(s.shipments),
    db().select().from(s.deliveryOrders),
    db().select().from(s.legacyDeliveryConfirmations),
    db().select().from(s.invoices),
    db().select().from(s.sales),
    db().select().from(s.saleItems),
    db().select().from(s.variants),
    db().select().from(s.customers),
  ]);
  const eligible = shipmentItems
    .filter(
      (i) =>
        deliveries.some(
          (d) => d.shipmentId === i.shipmentId && d.status === "Delivered",
        ) || legacy.some((d) => d.shipmentId === i.shipmentId),
    )
    .map((i) => {
      const claims = items
        .filter((l) => l.shipmentItemId === i.id)
        .reduce((q, l) => {
          const r = rmas.find((r) => r.id === l.returnId)!;
          if (["Cancelled", "Rejected"].includes(r.status)) return q;
          return (
            q +
            (r.intakeClosed
              ? receipts
                  .filter((p) => p.returnItemId === l.id)
                  .reduce((n, p) => n + p.quantity, 0)
              : l.quantity)
          );
        }, 0);
      return { ...i, remaining: i.quantity - claims };
    })
    .filter((i) => i.remaining > 0);
  const invoiceId = z.uuid().safeParse(filter.invoiceId).success
    ? filter.invoiceId
    : invoices.find((i) => i.orderId === filter.orderId)?.id;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Returns & exchanges</h1>
          <p className="muted">
            Authorization → physical receipt → inspection → restock or
            quarantine → commercial resolution.
          </p>
        </div>
      </div>
      <p>
        A return request does not change stock. Only inspected sellable goods
        enter available inventory. Returned goods pending inspection and
        quarantined goods remain outside available stock.
      </p>
      {can(actor.role, "returns.sales") && (
        <ActionForm
          label="New return authorization request"
          action="createReturn"
          defaults={invoiceId ? { invoiceId } : {}}
          fields={[
            {
              name: "invoiceId",
              label: "Original invoice / sales order / customer",
              type: "select",
              options: invoices.map((i) => ({
                value: i.id,
                label: `${i.number} · ${sales.find((o) => o.id === i.orderId)?.number} · ${customers.find((c) => c.id === sales.find((o) => o.id === i.orderId)?.customerId)?.name}`,
              })),
              required: true,
            },
            {
              name: "notes",
              label: "Customer return request and requested resolution",
              type: "textarea",
              required: true,
            },
          ]}
          lines={{
            name: "lines",
            label: "Delivered goods requested for return",
            fields: [
              {
                name: "shipmentItemId",
                label: "Delivered shipment line (must match invoice)",
                type: "select",
                options: eligible
                  .filter(
                    (i) =>
                      !invoiceId ||
                      shipments.find((sh) => sh.id === i.shipmentId)
                        ?.orderId ===
                        invoices.find((v) => v.id === invoiceId)?.orderId,
                  )
                  .map((i) => ({
                    value: i.id,
                    label: `${sales.find((o) => o.id === shipments.find((p) => p.id === i.shipmentId)?.orderId)?.number} · ${variants.find((v) => v.id === lines.find((l) => l.id === i.saleItemId)?.variantId)?.sku} · ${i.remaining} returnable · shipment ${i.shipmentId}`,
                  })),
                required: true,
              },
              {
                name: "quantity",
                label: "Requested return quantity",
                type: "number",
                required: true,
              },
              {
                name: "reason",
                label: "Return reason",
                type: "select",
                options: returnReasons.map((v) => ({ value: v, label: v })),
                required: true,
              },
            ],
          }}
        />
      )}
      <DataTable
        href="returns"
        rows={rmas
          .filter(
            (r) =>
              (!invoiceId || r.invoiceId === invoiceId) &&
              (!filter.orderId || r.orderId === filter.orderId),
          )
          .map((r) => ({
            id: r.id,
            number: r.number,
            invoice: invoices.find((i) => i.id === r.invoiceId)?.number,
            sale: sales.find((o) => o.id === r.orderId)?.number,
            customer: customers.find(
              (c) => c.id === sales.find((o) => o.id === r.orderId)?.customerId,
            )?.name,
            status: r.status,
            requested: items
              .filter((l) => l.returnId === r.id)
              .reduce((q, l) => q + l.quantity, 0),
            received: receipts
              .filter((p) =>
                items.some(
                  (l) => l.id === p.returnItemId && l.returnId === r.id,
                ),
              )
              .reduce((q, p) => q + p.quantity, 0),
            intake: r.intakeClosed ? "Closed" : "Open",
            notes: r.notes,
          }))}
        columns={[
          { key: "number", label: "RMA" },
          { key: "invoice", label: "Original invoice" },
          { key: "sale", label: "Original sale" },
          { key: "customer", label: "Customer" },
          { key: "status", label: "Status" },
          { key: "requested", label: "Requested" },
          { key: "received", label: "Physically received" },
          { key: "intake", label: "Intake" },
          { key: "notes", label: "Customer request" },
        ]}
      />
      {can(actor.role, "shipping") && (
        <section>
          <h2>Legacy delivery confirmations</h2>
          <p>
            Older direct shipments have no delivery status. Confirm actual
            customer receipt from delivery evidence before authorizing a return;
            dispatch alone is insufficient.
          </p>
          <ActionForm
            label="Confirm actual delivery of legacy shipment"
            action="confirmLegacyShipmentDelivery"
            fields={[
              {
                name: "shipmentId",
                label: "Dispatched legacy shipment",
                type: "select",
                options: shipments
                  .filter(
                    (sh) =>
                      !deliveries.some((d) => d.shipmentId === sh.id) &&
                      !legacy.some((d) => d.shipmentId === sh.id),
                  )
                  .map((sh) => ({
                    value: sh.id,
                    label: `${sales.find((o) => o.id === sh.orderId)?.number} · SHP-${sh.id}`,
                  })),
                required: true,
              },
              {
                name: "notes",
                label: "Delivery evidence / recipient confirmation",
                type: "textarea",
                required: true,
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
