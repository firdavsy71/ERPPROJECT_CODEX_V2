import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can, canReadModule } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";

export default async function FabricRollDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!canReadModule(actor.role, "inventory")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [roll] = await db().select().from(s.fabricRolls).where(eq(s.fabricRolls.id, id));
  if (!roll) notFound();
  const [balance] = await db().select().from(s.balances).where(eq(s.balances.id, roll.balanceId));
  const [material] = await db().select().from(s.materials).where(eq(s.materials.id, balance.materialId!));
  const [movements, defects, orders, suppliers] = await Promise.all([
    db().select().from(s.fabricRollMovements).where(eq(s.fabricRollMovements.rollId, id)).orderBy(s.fabricRollMovements.createdAt),
    db().select().from(s.fabricDefects).where(eq(s.fabricDefects.rollId, id)),
    db().select().from(s.manufacturing), db().select().from(s.suppliers),
  ]);
  return <>
    <div className="page-heading"><div><p className="eyebrow">FABRIC TRACEABILITY</p><h1>{roll.rollNumber}</h1><p>{material?.name} · {roll.color} · {roll.composition}</p></div><Link className="btn btn-outline" href="/fabric-rolls">All rolls</Link></div>
    <p>Supplier: {suppliers.find((x) => x.id === roll.supplierId)?.name ?? "Not recorded"} · Batch: {roll.supplierBatch || "—"} · Lot: {roll.supplierLot || "—"}</p>
    <p>Received: {roll.receivedLength} m · Usable: {roll.remainingLength} m · Reserved: {roll.reservedLength} m · Width: {roll.widthCm} cm · Location: {roll.storageLocation}</p>
    <p className="muted">Usable physical sections (m from roll start): {roll.usableSegments.map((x) => `${x.start}–${x.end}`).join(", ") || "None"}</p>
    {can(actor.role, "inventory") && <div className="actions">
      <ActionForm label="Record damaged section" action="damageRoll" fields={[{ name: "rollId", label: "Roll", type: "select", options: [{ value: roll.id, label: roll.rollNumber }], default: roll.id, required: true }, { name: "start", label: "Start (m from roll start)", type: "number", required: true }, { name: "end", label: "End (m from roll start)", type: "number", required: true }, { name: "reason", label: "Damage description", type: "textarea", required: true }]} />
      <ActionForm label="Adjust roll length" action="adjustRoll" fields={[{ name: "rollId", label: "Roll", type: "select", options: [{ value: roll.id, label: roll.rollNumber }], default: roll.id, required: true }, { name: "delta", label: "Adjustment in metres (negative for a write-off)", type: "text", required: true }, { name: "reason", label: "Reason", type: "textarea", required: true }]} />
    </div>}
    <h2>Roll movement history</h2>
    <DataTable rows={movements.map((m) => ({ id: m.id, date: m.createdAt.toISOString().slice(0, 16).replace("T", " "), reason: m.reason, quantity: m.quantity, reserved: m.reservedDelta, order: orders.find((o) => o.id === m.manufacturingOrderId)?.number, segments: m.segments.map((x) => `${x.start}–${x.end}`).join(", ") }))} columns={[{ key: "date", label: "Date (UTC)" }, { key: "reason", label: "Reason" }, { key: "quantity", label: "Length change (m)" }, { key: "reserved", label: "Reservation change (m)" }, { key: "order", label: "Manufacturing order" }, { key: "segments", label: "Physical sections (m)" }]} />
    <h2>Recorded defects</h2>
    <DataTable rows={defects.map((d) => ({ id: d.id, start: d.startMeter, end: d.endMeter, description: d.description, date: d.createdAt.toISOString().slice(0, 10) }))} columns={[{ key: "start", label: "Start (m)" }, { key: "end", label: "End (m)" }, { key: "description", label: "Description" }, { key: "date", label: "Recorded" }]} />
  </>;
}
