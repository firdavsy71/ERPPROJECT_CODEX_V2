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
import { DeliveryPrint } from "@/components/delivery-print";
import { DeliveryProofForm } from "@/components/delivery-proof-form";
import { deliveryFields } from "@/lib/delivery-fields";
export default async function Delivery({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "shipping.read")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [d] = await db()
    .select()
    .from(s.deliveryOrders)
    .where(eq(s.deliveryOrders.id, id));
  if (!d) notFound();
  const [lines, events, proofs, invoices] = await Promise.all([
    db()
      .select()
      .from(s.deliveryItems)
      .where(eq(s.deliveryItems.deliveryId, id)),
    db()
      .select()
      .from(s.deliveryEvents)
      .where(eq(s.deliveryEvents.deliveryId, id))
      .orderBy(s.deliveryEvents.createdAt),
    db()
      .select()
      .from(s.deliveryProofs)
      .where(eq(s.deliveryProofs.deliveryId, id)),
    db().select().from(s.invoices).where(eq(s.invoices.orderId, d.orderId)),
  ]);
  const [o] = await db()
    .select()
    .from(s.sales)
    .where(eq(s.sales.id, d.orderId));
  const editable = can(actor.role, "shipping"),
    before = ["Picking", "Packed"].includes(d.status);
  const [warehouse]=await db().select().from(s.warehouses).where(eq(s.warehouses.id,d.warehouseId));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Picking / packing list · {d.number}</h1>
          <p>
            {d.status} ·{" "}
            {`Shipment SHP-${d.number}${d.shipmentId ? "" : " (draft, not dispatched)"}`}
          </p>
        </div>
        <DeliveryPrint />
      </div>
      <p>{d.customerName}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{d.address}</p>
      <p>
        Carrier: {d.carrier} · Vehicle: {d.vehicle || "—"} · Driver:{" "}
        {d.driver || "—"} · Tracking: {d.tracking || "—"}
      </p>
      <p style={{ whiteSpace: "pre-wrap" }}>{d.notes}</p>
      <p>
        Sales order {o.number} · Warehouse {warehouse.name}
      </p>
      <div className="no-print">
        <Link href={`/sales/${d.orderId}`}>Sales order {o.number}</Link> ·{" "}
        <Link href={`/customers/${o.customerId}`}>Customer</Link>
        {invoices.map((i) => (
          <span key={i.id}>
            {" "}
            · <Link href={`/invoices/${i.id}`}>Invoice · {i.status}</Link>
          </span>
        ))}
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Product / size / color</th>
              <th>Planned</th>
              <th>Picked</th>
              <th>Packed</th>
              <th>Dispatched</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.productSnapshot}</td>
                <td>{l.quantity}</td>
                <td>{l.picked}</td>
                <td>{l.packed}</td>
                <td>{d.shipmentId ? l.quantity : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Recipient: __________________ Date: __________________ Signature:
        __________________
      </p>
      <div className="actions no-print">
        {editable && before && (
          <>
            <ActionForm
              label="Edit address / carrier"
              action="editDelivery"
              id={id}
              defaults={{
                address: d.address,
                carrier: d.carrier,
                vehicle: d.vehicle,
                driver: d.driver,
                tracking: d.tracking,
                notes: d.notes,
              }}
              fields={deliveryFields}
            />
            <ActionForm
              label="Cancel before dispatch"
              action="cancelDelivery"
              id={id}
              fields={[
                {
                  name: "notes",
                  label: "Cancellation reason",
                  type: "textarea",
                  required: true,
                },
              ]}
            />
          </>
        )}
        {editable && d.status === "Picking" && (
          <ActionForm
            label="Record picked / packed quantities"
            action="recordDeliveryPacking"
            id={id}
            fields={[
              {
                name: "lineId",
                label: "Picking line",
                type: "select",
                options: lines.map((l) => ({
                  value: l.id,
                  label: `${l.productSnapshot} · ${l.quantity} planned, ${l.picked} picked, ${l.packed} packed`,
                })),
                required: true,
              },
              {
                name: "picked",
                label: "Total picked quantity",
                type: "number",
                required: true,
              },
              {
                name: "packed",
                label: "Total packed quantity",
                type: "number",
                required: true,
              },
              {
                name: "notes",
                label: "Picking / packing confirmation notes",
                type: "textarea",
                required: true,
              },
            ]}
          />
        )}{" "}
        {editable && d.status === "Packed" && (
          <>
            <ActionForm
              label="Confirm physical dispatch"
              action="dispatchDelivery"
              id={id}
            />
            <ActionForm
              label="Reopen picking for correction"
              action="reopenDelivery"
              id={id}
              fields={[
                {
                  name: "notes",
                  label: "Correction reason",
                  type: "textarea",
                  required: true,
                },
              ]}
            />
          </>
        )}
        {editable && d.shipmentId && d.status !== "Delivered" && (
          <ActionForm
            label="Update tracking / delivery status"
            action="updateDeliveryStatus"
            id={id}
            defaults={{ tracking: d.tracking }}
            fields={[
              {
                name: "status",
                label: "Delivery status",
                type: "select",
                options: ["In Transit", "Delivered", "Exception"].map((v) => ({
                  value: v,
                  label: v,
                })),
                required: true,
              },
              { name: "tracking", label: "Tracking reference" },
              {
                name: "notes",
                label: "Delivery / recipient / exception notes",
                type: "textarea",
                required: true,
              },
            ]}
          />
        )}
      </div>
      <section className="no-print">
        <h2>Proof of delivery</h2>
        {proofs.map((p) => (
          <p key={p.id}>
            <a
              href={`/api/deliveries/${id}/proofs/${p.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {p.name}
            </a>{" "}
            · {p.note} · {p.createdAt.toISOString()}
          </p>
        ))}
        {editable && d.shipmentId && (
          <DeliveryProofForm
            id={id}
            configured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          />
        )}
        <h2>Delivery notes & history</h2>
        <DataTable
          rows={events.map((e) => ({
            id: e.id,
            status: e.status,
            notes: e.notes,
            date: e.createdAt.toISOString(),
          }))}
          columns={[
            { key: "status", label: "Status" },
            { key: "notes", label: "Recorded note" },
            { key: "date", label: "Recorded (UTC)" },
          ]}
        />
        <Link href="/deliveries">All deliveries and shipment history</Link>
      </section>
    </>
  );
}
