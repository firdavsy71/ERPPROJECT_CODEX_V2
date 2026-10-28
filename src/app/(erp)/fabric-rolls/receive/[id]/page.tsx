import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import * as s from "@/db/schema";
import { FabricReceipt } from "@/components/fabric-receipt";

export default async function FabricReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "purchases")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [order] = await db().select().from(s.purchases).where(eq(s.purchases.id, id));
  if (!order) notFound();
  const [lines, balances, materials, warehouses, settings] = await Promise.all([db().select().from(s.purchaseItems).where(eq(s.purchaseItems.orderId, id)), db().select().from(s.balances), db().select().from(s.materials), db().select().from(s.warehouses).orderBy(s.warehouses.id), db().select().from(s.settings)]);
  const warehouseId = settings[0]?.primaryWarehouseId ?? (warehouses.length === 1 ? warehouses[0].id : undefined);
  const options = lines.filter((line) => balances.some((b) => b.materialId === line.materialId && b.warehouseId === warehouseId && b.rollTracked) && new Decimal(line.quantity).gt(line.received)).map((line) => ({ id: line.id, label: `${materials.find((m) => m.id === line.materialId)?.name} · ${new Decimal(line.quantity).minus(line.received)} m remaining` }));
  return <><div className="page-heading"><div><p className="eyebrow">PURCHASING / FABRIC</p><h1>Receive rolls · {order.number}</h1><p className="muted">The sum of roll lengths is received against the selected purchase line.</p></div><Link className="btn btn-outline" href={`/purchases/${id}`}>Purchase order</Link></div>{["Ordered", "Partially Received"].includes(order.status) ? <FabricReceipt orderId={id} lines={options} /> : <p>The purchase order must be ordered and open for receiving.</p>}</>;
}
