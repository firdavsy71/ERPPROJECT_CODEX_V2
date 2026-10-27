import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { deliveryFields } from "@/lib/delivery-fields";
export default async function Deliveries({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "shipping.read")) notFound();
  const { orderId: filter } = await searchParams;
  const orderId = z.uuid().safeParse(filter).success ? filter : undefined;
  const [
    deliveries,
    items,
    sales,
    lines,
    variants,
    customers,
    shipments,
    shipped,
  ] = await Promise.all([
    db().select().from(s.deliveryOrders),
    db().select().from(s.deliveryItems),
    db().select().from(s.sales),
    db().select().from(s.saleItems),
    db().select().from(s.variants),
    db().select().from(s.customers),
    db().select().from(s.shipments),
    db().select().from(s.shipmentItems),
  ]);
  const available = sales.filter(
    (o) =>
      !["Draft", "Cancelled", "Completed", "Shipped"].includes(o.status) &&
      lines.some((l) => l.orderId === o.id && l.reserved > 0),
  );
  const selected = sales.find((o) => o.id === orderId);
  const customer = customers.find((c) => c.id === selected?.customerId);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Shipping & delivery</h1>
          <p className="muted">
            Reserved stock → picking → packing → dispatch → delivery.
          </p>
        </div>
      </div>
      <p>
        Picking and packing do not deduct stock. Dispatch posts the shipment
        once. Cancellation is available before dispatch; goods already
        dispatched require a separately documented physical return.
      </p>
      {can(actor.role, "shipping") && (
        <ActionForm
          label="New delivery / picking list"
          action="createDelivery"
          defaults={
            selected
              ? { orderId: selected.id, address: customer?.address ?? "" }
              : {}
          }
          fields={[
            {
              name: "orderId",
              label: "Confirmed sales order",
              type: "select",
              options: available.map((o) => ({
                value: o.id,
                label: `${o.number} · ${customers.find((c) => c.id === o.customerId)?.name}`,
              })),
              required: true,
            },
            ...deliveryFields,
          ]}
          lines={{
            name: "lines",
            label: "Reserved finished goods to pick",
            fields: [
              {
                name: "saleItemId",
                label: "Sales line (must belong to selected order)",
                type: "select",
                options: lines
                  .filter(
                    (l) =>
                      l.reserved > 0 && (!orderId || l.orderId === orderId),
                  )
                  .map((l) => ({
                    value: l.id,
                    label: `${sales.find((o) => o.id === l.orderId)?.number} · ${variants.find((v) => v.id === l.variantId)?.sku} · ${l.reserved} reserved`,
                  })),
                required: true,
              },
              {
                name: "quantity",
                label: "Planned picking quantity",
                type: "number",
                required: true,
              },
            ],
          }}
        />
      )}
      <DataTable
        href="deliveries"
        rows={deliveries
          .filter((d) => !orderId || d.orderId === orderId)
          .map((d) => ({
            id: d.id,
            number: d.number,
            sale: sales.find((o) => o.id === d.orderId)?.number,
            customer: d.customerName,
            status: d.status,
            carrier: d.carrier,
            tracking: d.tracking,
            picked: items
              .filter((i) => i.deliveryId === d.id)
              .reduce((n, i) => n + i.picked, 0),
            packed: items
              .filter((i) => i.deliveryId === d.id)
              .reduce((n, i) => n + i.packed, 0),
            shipped: d.shipmentId
              ? items
                  .filter((i) => i.deliveryId === d.id)
                  .reduce((n, i) => n + i.quantity, 0)
              : 0,
            dispatch: d.dispatchedAt?.toISOString(),
            delivered: d.deliveredAt?.toISOString(),
          }))}
        columns={[
          { key: "number", label: "Delivery / packing list" },
          { key: "sale", label: "Sales order" },
          { key: "customer", label: "Customer" },
          { key: "status", label: "Delivery status" },
          { key: "picked", label: "Picked" },
          { key: "packed", label: "Packed" },
          { key: "shipped", label: "Dispatched" },
          { key: "carrier", label: "Carrier" },
          { key: "tracking", label: "Tracking" },
          { key: "dispatch", label: "Dispatch (UTC)" },
          { key: "delivered", label: "Delivered (UTC)" },
        ]}
      />
      <h2>Shipment history, including previous direct shipments</h2>
      <p className="muted">
        Shipment links open the corresponding sales order and its invoice
        workflow.
      </p>
      <DataTable
        href="sales"
        rows={shipments
          .filter((s) => !orderId || s.orderId === orderId)
          .map((s) => ({
            id: s.orderId,
            number: deliveries.find((d) => d.shipmentId === s.id)
              ? `SHP-${deliveries.find((d) => d.shipmentId === s.id)!.number}`
              : `SHP-${s.id}`,
            sale: sales.find((o) => o.id === s.orderId)?.number,
            quantity: shipped
              .filter((l) => l.shipmentId === s.id)
              .reduce((n, l) => n + l.quantity, 0),
            date: s.createdAt.toISOString(),
          }))}
        columns={[
          { key: "number", label: "Shipment number" },
          { key: "sale", label: "Sales order" },
          { key: "quantity", label: "Units dispatched" },
          { key: "date", label: "Dispatched (UTC)" },
        ]}
      />
    </>
  );
}
