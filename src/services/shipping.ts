import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { checkBrandedShipment } from "@/services/branding";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Context = {
  actorId: string;
  key: string;
  warehouseId: string;
  balance: (variantId: string) => Promise<typeof s.balances.$inferSelect>;
  post: (
    balance: typeof s.balances.$inferSelect,
    quantity: number,
    reserved: number,
    reason: string,
    suffix: string,
  ) => Promise<unknown>;
  syncSale: (id: string) => Promise<void>;
};
const count = z.coerce.number().int().nonnegative().max(1000000);
const terms = z.object({
  address: z.string().trim().min(5).max(2000),
  carrier: z.string().trim().min(1).max(200),
  vehicle: z.string().trim().max(200).default(""),
  driver: z.string().trim().max(300).default(""),
  tracking: z.string().trim().max(300).default(""),
  notes: z.string().max(3000).default(""),
});
export async function deliveryCommitted(
  tx: Tx,
  saleItemId: string,
  exclude?: string,
) {
  const rows = await tx
    .select({ item: s.deliveryItems, delivery: s.deliveryOrders })
    .from(s.deliveryItems)
    .innerJoin(
      s.deliveryOrders,
      eq(s.deliveryItems.deliveryId, s.deliveryOrders.id),
    )
    .where(eq(s.deliveryItems.saleItemId, saleItemId));
  return rows
    .filter(
      (r) =>
        r.delivery.id !== exclude &&
        ["Picking", "Packed"].includes(r.delivery.status),
    )
    .reduce((n, r) => n + r.item.quantity, 0);
}
export async function shippingAction(
  tx: Tx,
  action: string,
  input: unknown,
  c: Context,
) {
  if (action === "createDelivery") {
    const v = terms
      .extend({
        orderId: z.uuid(),
        lines: z
          .array(
            z.object({
              saleItemId: z.uuid(),
              quantity: count.refine((q) => q > 0),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    if (new Set(v.lines.map((l) => l.saleItemId)).size !== v.lines.length)
      throw new Error("Each sales line must appear once on a picking list");
    const [order] = await tx
      .select()
      .from(s.sales)
      .where(eq(s.sales.id, v.orderId));
    if (
      !order ||
      ["Draft", "Cancelled", "Shipped", "Completed"].includes(order.status)
    )
      throw new Error(
        "Choose an open confirmed sales order with reserved finished goods",
      );
    const [customer] = await tx
      .select()
      .from(s.customers)
      .where(eq(s.customers.id, order.customerId));
    const [delivery] = await tx
      .insert(s.deliveryOrders)
      .values({
        ...v,
        number: `DLV-${randomUUID().slice(0, 12).toUpperCase()}`,
        customerName: customer.name,
        warehouseId: c.warehouseId,
        createdBy: c.actorId,
      })
      .returning();
    for (const l of v.lines) {
      const [line] = await tx
        .select()
        .from(s.saleItems)
        .where(
          and(
            eq(s.saleItems.id, l.saleItemId),
            eq(s.saleItems.orderId, order.id),
          ),
        );
      if (
        !line ||
        l.quantity > line.reserved - (await deliveryCommitted(tx, l.saleItemId))
      )
        throw new Error(
          "Picking quantity exceeds uncommitted reserved finished goods",
        );
      const [variant] = await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, line.variantId));
      const [product] = await tx
        .select()
        .from(s.products)
        .where(eq(s.products.id, variant.productId));
      await tx
        .insert(s.deliveryItems)
        .values({
          ...l,
          deliveryId: delivery.id,
          productSnapshot: `${variant.sku} · ${product.name} · ${variant.size} / ${variant.color}`,
        });
    }
    await tx
      .insert(s.deliveryEvents)
      .values({
        deliveryId: delivery.id,
        status: "Picking",
        notes: "Picking list created from reserved finished goods",
        createdBy: c.actorId,
      });
    return;
  }
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const [d] = await tx
    .select()
    .from(s.deliveryOrders)
    .where(eq(s.deliveryOrders.id, id))
    .for("update");
  if (!d) throw new Error("Delivery order not found");
  const history = async (status: string, notes: string) =>
    tx
      .insert(s.deliveryEvents)
      .values({ deliveryId: id, status, notes, createdBy: c.actorId });
  if (action === "editDelivery") {
    if (!["Picking", "Packed"].includes(d.status))
      throw new Error(
        "Dispatched delivery terms are fixed; record tracking updates and delivery notes instead",
      );
    const v = terms.parse(input);
    await tx.update(s.deliveryOrders).set(v).where(eq(s.deliveryOrders.id, id));
    await history(d.status, "Delivery address / carrier details updated");
    return;
  }
  if (action === "cancelDelivery") {
    if (!["Picking", "Packed"].includes(d.status))
      throw new Error(
        "Goods have already left the warehouse or this order is closed. Cancellation cannot restore stock; document a physical goods return separately",
      );
    const { notes } = z
      .object({ notes: z.string().trim().min(5).max(3000) })
      .parse(input);
    await tx
      .update(s.deliveryOrders)
      .set({ status: "Cancelled" })
      .where(eq(s.deliveryOrders.id, id));
    await history(
      "Cancelled",
      notes + " — picking commitment released; no inventory movement",
    );
    return;
  }
  if (action === "reopenDelivery") {
    if (d.status !== "Packed")
      throw new Error("Only packed, undispatched orders can reopen picking");
    const { notes } = z
      .object({ notes: z.string().trim().min(5).max(3000) })
      .parse(input);
    await tx
      .update(s.deliveryOrders)
      .set({ status: "Picking" })
      .where(eq(s.deliveryOrders.id, id));
    await history("Picking", notes);
    return;
  }
  if (action === "recordDeliveryPacking") {
    if (d.status !== "Picking") throw new Error("Picking is not open");
    const v = z
      .object({
        lineId: z.uuid(),
        picked: count,
        packed: count,
        notes: z.string().trim().min(3).max(3000),
      })
      .parse(input);
    const [line] = await tx
      .select()
      .from(s.deliveryItems)
      .where(
        and(
          eq(s.deliveryItems.id, v.lineId),
          eq(s.deliveryItems.deliveryId, id),
        ),
      );
    if (!line || v.packed > v.picked || v.picked > line.quantity)
      throw new Error(
        "Packed must not exceed picked, and picked must not exceed the planned quantity",
      );
    await tx
      .update(s.deliveryItems)
      .set({ picked: v.picked, packed: v.packed })
      .where(eq(s.deliveryItems.id, line.id));
    const lines = await tx
      .select()
      .from(s.deliveryItems)
      .where(eq(s.deliveryItems.deliveryId, id));
    const status = lines.every((l) => l.packed === l.quantity)
      ? "Packed"
      : "Picking";
    await tx
      .update(s.deliveryOrders)
      .set({ status })
      .where(eq(s.deliveryOrders.id, id));
    await history(
      status,
      `${line.productSnapshot}: picked ${v.picked}, packed ${v.packed}. ${v.notes}`,
    );
    return;
  }
  if (action === "dispatchDelivery") {
    if (d.shipmentId) return;
    if (d.status !== "Packed")
      throw new Error(
        "All picking-list quantities must be packed before dispatch",
      );
    if (d.warehouseId !== c.warehouseId)
      throw new Error("Dispatch warehouse mismatch");
    const [order] = await tx
      .select()
      .from(s.sales)
      .where(eq(s.sales.id, d.orderId));
    if (!order || ["Draft", "Cancelled", "Completed"].includes(order.status))
      throw new Error("Sales order cannot be dispatched");
    const lines = await tx
      .select()
      .from(s.deliveryItems)
      .where(eq(s.deliveryItems.deliveryId, id));
    if (!lines.length || lines.some((l) => l.packed !== l.quantity))
      throw new Error("Packing list is incomplete");
    const [shipment] = await tx
      .insert(s.shipments)
      .values({ orderId: d.orderId, operationKey: c.key })
      .returning();
    for (const l of lines) {
      const [line] = await tx
        .select()
        .from(s.saleItems)
        .where(
          and(
            eq(s.saleItems.id, l.saleItemId),
            eq(s.saleItems.orderId, d.orderId),
          ),
        )
        .for("update");
      if (
        !line ||
        l.quantity >
          line.reserved - (await deliveryCommitted(tx, l.saleItemId, id)) ||
        l.quantity > line.quantity - line.shipped
      )
        throw new Error(
          "Dispatch exceeds this delivery's reserved finished goods",
        );
      await checkBrandedShipment(tx, line, l.quantity);
      await c.post(
        await c.balance(line.variantId),
        -l.quantity,
        -l.quantity,
        `Delivery dispatch ${d.number}`,
        l.id,
      );
      await tx
        .update(s.saleItems)
        .set({
          reserved: line.reserved - l.quantity,
          shipped: line.shipped + l.quantity,
        })
        .where(eq(s.saleItems.id, line.id));
      await tx
        .insert(s.shipmentItems)
        .values({
          shipmentId: shipment.id,
          saleItemId: line.id,
          quantity: l.quantity,
        });
    }
    await tx
      .update(s.deliveryOrders)
      .set({
        status: "Dispatched",
        shipmentId: shipment.id,
        dispatchedAt: new Date(),
      })
      .where(eq(s.deliveryOrders.id, id));
    await history(
      "Dispatched",
      `Shipment SHP-${d.number}; stock deducted once`,
    );
    await c.syncSale(d.orderId);
    return;
  }
  if (action === "updateDeliveryStatus") {
    const v = z
      .object({
        status: z.enum(["In Transit", "Delivered", "Exception"]),
        tracking: z.string().trim().max(300).default(d.tracking),
        notes: z.string().trim().min(5).max(3000),
      })
      .parse(input);
    if (
      !d.shipmentId ||
      !["Dispatched", "In Transit", "Exception"].includes(d.status)
    )
      throw new Error(
        "Only dispatched, undelivered shipments can update delivery status",
      );
    await tx
      .update(s.deliveryOrders)
      .set({
        status: v.status,
        tracking: v.tracking,
        ...(v.status === "Delivered" ? { deliveredAt: new Date() } : {}),
      })
      .where(eq(s.deliveryOrders.id, id));
    await history(
      v.status,
      `${v.notes}${v.tracking ? ` · tracking ${v.tracking}` : ""}`,
    );
    return;
  }
  throw new Error("Unknown delivery action");
}
