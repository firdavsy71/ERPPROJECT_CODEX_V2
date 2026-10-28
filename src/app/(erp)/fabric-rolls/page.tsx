import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can, canReadModule } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { rollFields } from "@/lib/fabric-fields";
import { EnableEmptyRollTracking } from "@/components/enable-empty-roll-tracking";

export default async function FabricRollsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!canReadModule(actor.role, "inventory")) notFound();
  const [rolls, balances, materials, warehouses, settings] = await Promise.all([
    db().select().from(s.fabricRolls).orderBy(s.fabricRolls.rollNumber),
    db().select().from(s.balances),
    db().select().from(s.materials),
    db().select().from(s.warehouses).orderBy(s.warehouses.id),
    db().select().from(s.settings),
  ]);
  const warehouseId = settings[0]?.primaryWarehouseId ?? (warehouses.length === 1 ? warehouses[0].id : undefined);
  const stock = balances.filter((b) => b.materialId && b.warehouseId === warehouseId);
  const options = (tracked: boolean) => stock.filter((b) => b.rollTracked === tracked && materials.some((m) => m.id === b.materialId && m.unit === "Meters")).map((b) => ({ value: b.materialId!, label: `${materials.find((m) => m.id === b.materialId)?.name} · ${b.onHand} m on hand · ${b.reserved} m reserved` }));
  const material = { name: "materialId", label: "Material and current stock", type: "select" as const, required: true };
  return <>
    <div className="page-heading"><div><p className="eyebrow">INVENTORY / TRACEABILITY</p><h1>Fabric rolls</h1><p className="muted">Individual rolls and batches reconcile with material inventory.</p></div></div>
    {can(actor.role, "inventory") && <div className="actions">
      <ActionForm label="Allocate existing stock to rolls" action="activateRollTracking" fields={[{ ...material, options: options(false) }]} lines={{ name: "rolls", label: "Existing rolls (lengths must equal the entire current on-hand balance; reservations must be zero)", fields: rollFields }} />
      <ActionForm label="Register rolls" action="registerRolls" fields={[{ ...material, options: options(true) }, { name: "reason", label: "Receipt reason or reference", required: true }]} lines={{ name: "rolls", label: "New rolls", fields: rollFields }} />
    </div>}
    {can(actor.role, "inventory") && <EnableEmptyRollTracking options={options(false).filter((o) => stock.some((b) => b.materialId === o.value && Number(b.onHand) === 0 && Number(b.reserved) === 0))} />}
    <p className="muted">For purchase orders, use the roll receipt on the purchase order so the receipt and supplier are linked. Opening allocation does not add stock. Select rolls and batches when reserving a manufacturing order.</p>
    <DataTable href="fabric-rolls" rows={rolls.map((r) => ({ id: r.id, roll: r.rollNumber, material: materials.find((m) => m.id === balances.find((b) => b.id === r.balanceId)?.materialId)?.name, batch: r.supplierBatch, lot: r.supplierLot, color: r.color, remaining: r.remainingLength, reserved: r.reservedLength, location: r.storageLocation }))} columns={[{ key: "roll", label: "Roll" }, { key: "material", label: "Material" }, { key: "batch", label: "Batch" }, { key: "lot", label: "Lot" }, { key: "color", label: "Color" }, { key: "remaining", label: "Usable m" }, { key: "reserved", label: "Reserved m" }, { key: "location", label: "Location" }]} />
    <p><Link href="/materials">View material inventory</Link></p>
  </>;
}
