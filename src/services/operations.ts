import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import { resolveApprovedSpecification } from "@/services/specifications";
import * as s from "@/db/schema";
import { type Actor, authorize } from "@/lib/permissions";
import { amount, quantity, orderSchema } from "@/lib/validation";
import { discountedLineTotal } from "@/lib/money";
import {
  checkBrandingBeforeConfirmation,
  resolveBrandingForManufacturing,
  checkBrandedShipment,
} from "@/services/branding";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const num = (v: Decimal.Value) => new Decimal(v);
export function lineTotal(
  q: Decimal.Value,
  p: Decimal.Value,
  discount: Decimal.Value = "0",
) {
  return discountedLineTotal(q, p, discount);
}
export const actions = [
  "adjust",
  "bom",
  "purchase",
  "orderPurchase",
  "receive",
  "sale",
  "confirmSale",
  "reserveSale",
  "ship",
  "manufacture",
  "bindSpecification",
  "plan",
  "start",
  "record",
  "complete",
  "cancelProduction",
  "invoice",
  "pay",
] as const;
export type BusinessAction = (typeof actions)[number];
const resources: Record<BusinessAction, string> = {
  adjust: "inventory",
  bom: "boms",
  purchase: "purchases",
  orderPurchase: "purchases",
  receive: "purchases",
  sale: "sales",
  confirmSale: "sales",
  reserveSale: "inventory",
  ship: "inventory",
  manufacture: "manufacturing",
  bindSpecification: "manufacturing",
  plan: "manufacturing",
  start: "manufacturing",
  record: "manufacturing",
  complete: "manufacturing",
  cancelProduction: "manufacturing",
  invoice: "invoices",
  pay: "invoices",
};
const idInput = z.object({ id: z.uuid() });
async function balance(
  tx: Tx,
  warehouseId: string,
  itemId: string,
  kind: "material" | "variant",
) {
  const field =
    kind === "material" ? s.balances.materialId : s.balances.variantId;
  await tx
    .insert(s.balances)
    .values({
      warehouseId,
      ...(kind === "material" ? { materialId: itemId } : { variantId: itemId }),
    })
    .onConflictDoNothing();
  const [b] = await tx
    .select()
    .from(s.balances)
    .where(and(eq(s.balances.warehouseId, warehouseId), eq(field, itemId)))
    .for("update");
  if (!b) throw new Error("Stock balance could not be created");
  return b;
}
async function move(
  tx: Tx,
  b: typeof s.balances.$inferSelect,
  q: Decimal.Value,
  r: Decimal.Value,
  reason: string,
  source: string,
  key: string,
  actor: Actor,
) {
  const onHand = num(b.onHand).add(q),
    reserved = num(b.reserved).add(r);
  if (onHand.isNegative() || reserved.isNegative() || reserved.gt(onHand))
    throw new Error(
      "Insufficient available stock. Receive materials or finished goods before proceeding.",
    );
  await tx
    .update(s.balances)
    .set({ onHand: onHand.toFixed(4), reserved: reserved.toFixed(4) })
    .where(eq(s.balances.id, b.id));
  await tx.insert(s.movements).values({
    balanceId: b.id,
    quantity: num(q).toFixed(4),
    reservedDelta: num(r).toFixed(4),
    reason,
    source,
    operationKey: key,
    createdBy: actor.id,
  });
}
function number(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
async function syncSale(tx: Tx, orderId: string) {
  const lines = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, orderId));
  const status = lines.every((l) => l.shipped === l.quantity)
    ? "Shipped"
    : lines.some((l) => l.shipped > 0)
      ? "Partially Shipped"
      : lines.every((l) => l.reserved === l.quantity)
        ? "Ready for Shipment"
        : "Awaiting Production";
  await tx.update(s.sales).set({ status }).where(eq(s.sales.id, orderId));
}
export async function execute(
  actor: Actor,
  action: BusinessAction,
  input: unknown,
  key: string,
) {
  z.enum(actions).parse(action);
  authorize(actor, resources[action]);
  z.uuid().parse(key);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ action, input }))
    .digest("hex");
  await db().transaction(async (tx) => {
    const [warehouse] = await tx
      .select()
      .from(s.warehouses)
      .orderBy(s.warehouses.id)
      .limit(1)
      .for("update");
    if (!warehouse)
      throw new Error("Run the seed script to create the primary warehouse.");
    const [prior] = await tx
      .select()
      .from(s.operations)
      .where(eq(s.operations.key, key));
    if (prior) {
      if (prior.fingerprint !== fingerprint || prior.actorId !== actor.id)
        throw new Error("Operation key already used for another request.");
      return;
    }
    await tx
      .insert(s.operations)
      .values({ key, fingerprint, actorId: actor.id });
    if (action === "adjust") {
      const v = z
        .object({
          itemId: z.uuid(),
          kind: z.enum(["material", "variant"]),
          delta: z
            .string()
            .regex(/^-?\d{1,12}(\.\d{1,4})?$/)
            .refine((v) => !num(v).isZero()),
          reason: z.string().min(5).max(500),
        })
        .parse(input);
      if (v.kind === "variant" && !num(v.delta).isInteger())
        throw new Error("Finished goods quantities must be whole units");
      await move(
        tx,
        await balance(tx, warehouse.id, v.itemId, v.kind),
        v.delta,
        0,
        v.reason,
        "adjustment",
        key,
        actor,
      );
    } else if (action === "bom") {
      const v = z
        .object({
          variantId: z.uuid(),
          laborCost: amount,
          specificationId: z.uuid().optional().or(z.literal("")),
          items: z.array(z.object({ materialId: z.uuid(), quantity })).min(1),
        })
        .parse(input);
      await tx
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, v.variantId))
        .for("update");
      const existing = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.variantId, v.variantId));
      const spec = v.specificationId
        ? await resolveApprovedSpecification(tx, v.variantId, v.specificationId)
        : null;
      const [bom] = await tx
        .insert(s.boms)
        .values({
          variantId: v.variantId,
          laborCost: v.laborCost,
          specificationId: spec?.id,
          version: Math.max(0, ...existing.map((b) => b.version)) + 1,
        })
        .returning();
      await tx
        .insert(s.bomItems)
        .values(v.items.map((i) => ({ ...i, bomId: bom.id })));
    } else if (action === "purchase" || action === "sale") {
      const v = orderSchema.parse(input);
      if (
        action === "sale" &&
        v.lines.some(
          (l) =>
            !num(l.quantity).isInteger() ||
            num(l.quantity).gt(1000000) ||
            num(l.discount).gt(100),
        )
      )
        throw new Error(
          "Sales require whole quantities up to 1,000,000 and discounts between 0 and 100",
        );
      const total = v.lines
        .reduce(
          (a, l) =>
            a.add(
              lineTotal(
                l.quantity,
                l.price,
                action === "sale" ? l.discount : 0,
              ),
            ),
          num(0),
        )
        .toFixed(2);
      if (action === "purchase") {
        const [order] = await tx
          .insert(s.purchases)
          .values({
            number: number("PO"),
            supplierId: v.partyId,
            currency: v.currency,
            expectedDate: v.date,
            total,
          })
          .returning();
        await tx.insert(s.purchaseItems).values(
          v.lines.map((l) => ({
            orderId: order.id,
            materialId: l.itemId,
            quantity: l.quantity,
            price: l.price,
          })),
        );
      } else {
        const [order] = await tx
          .insert(s.sales)
          .values({
            number: number("SO"),
            customerId: v.partyId,
            currency: v.currency,
            deliveryDate: v.date,
            total,
          })
          .returning();
        await tx.insert(s.saleItems).values(
          v.lines.map((l) => ({
            orderId: order.id,
            variantId: l.itemId,
            quantity: Number(l.quantity),
            price: l.price,
            discount: l.discount,
          })),
        );
      }
    } else if (action === "orderPurchase") {
      const v = idInput.parse(input);
      const [po] = await tx
        .select()
        .from(s.purchases)
        .where(eq(s.purchases.id, v.id));
      if (po?.status !== "Draft")
        throw new Error("Only draft purchase orders can be ordered");
      await tx
        .update(s.purchases)
        .set({ status: "Ordered" })
        .where(eq(s.purchases.id, v.id));
    } else if (action === "receive") {
      const v = z
        .object({
          id: z.uuid(),
          lines: z.array(z.object({ id: z.uuid(), quantity })).min(1),
        })
        .parse(input);
      const [po] = await tx
        .select()
        .from(s.purchases)
        .where(eq(s.purchases.id, v.id));
      if (!po || !["Ordered", "Partially Received"].includes(po.status))
        throw new Error("Purchase must be ordered before receiving");
      await tx.insert(s.receipts).values({ orderId: po.id, operationKey: key });
      for (const l of v.lines) {
        const [line] = await tx
          .select()
          .from(s.purchaseItems)
          .where(
            and(
              eq(s.purchaseItems.id, l.id),
              eq(s.purchaseItems.orderId, v.id),
            ),
          );
        if (!line || num(line.received).add(l.quantity).gt(line.quantity))
          throw new Error("Receipt exceeds remaining ordered quantity");
        await move(
          tx,
          await balance(tx, warehouse.id, line.materialId, "material"),
          l.quantity,
          0,
          "Purchase receipt",
          po.number,
          `${key}:${l.id}`,
          actor,
        );
        await tx
          .update(s.purchaseItems)
          .set({ received: num(line.received).add(l.quantity).toFixed(4) })
          .where(eq(s.purchaseItems.id, l.id));
      }
      const lines = await tx
        .select()
        .from(s.purchaseItems)
        .where(eq(s.purchaseItems.orderId, v.id));
      await tx
        .update(s.purchases)
        .set({
          status: lines.every((l) => num(l.received).eq(l.quantity))
            ? "Received"
            : "Partially Received",
        })
        .where(eq(s.purchases.id, v.id));
    } else if (action === "confirmSale") {
      const v = idInput.parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (so?.status !== "Draft")
        throw new Error("Only draft sales orders can be confirmed");
      await checkBrandingBeforeConfirmation(tx, so.id);
      await tx
        .update(s.sales)
        .set({ status: "Confirmed" })
        .where(eq(s.sales.id, v.id));
    } else if (action === "reserveSale") {
      const v = idInput.parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (
        !so ||
        ["Draft", "Cancelled", "Shipped", "Completed"].includes(so.status)
      )
        throw new Error("Order is not open for reservation");
      const lines = await tx
        .select()
        .from(s.saleItems)
        .where(eq(s.saleItems.orderId, v.id))
        .orderBy(s.saleItems.id);
      for (const line of lines) {
        const b = await balance(tx, warehouse.id, line.variantId, "variant");
        const reserve = Decimal.min(
          num(b.onHand).minus(b.reserved),
          line.quantity - line.shipped - line.reserved,
        );
        if (reserve.gt(0)) {
          await move(
            tx,
            b,
            0,
            reserve,
            "Sales reservation",
            so.number,
            `${key}:${line.id}`,
            actor,
          );
          await tx
            .update(s.saleItems)
            .set({ reserved: line.reserved + reserve.toNumber() })
            .where(eq(s.saleItems.id, line.id));
        }
      }
      await syncSale(tx, so.id);
    } else if (action === "ship") {
      const v = z
        .object({
          id: z.uuid(),
          lines: z
            .array(
              z.object({
                id: z.uuid(),
                quantity: z.coerce.number().int().positive().max(1000000),
              }),
            )
            .min(1),
        })
        .parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (!so || ["Draft", "Cancelled", "Completed"].includes(so.status))
        throw new Error("Order cannot be shipped");
      const [shipment] = await tx
        .insert(s.shipments)
        .values({ orderId: v.id, operationKey: key })
        .returning();
      for (const l of v.lines) {
        const [line] = await tx
          .select()
          .from(s.saleItems)
          .where(and(eq(s.saleItems.id, l.id), eq(s.saleItems.orderId, v.id)));
        if (!line || l.quantity > line.reserved)
          throw new Error("Shipment exceeds reserved quantity");
        await checkBrandedShipment(tx, line, l.quantity);
        await move(
          tx,
          await balance(tx, warehouse.id, line.variantId, "variant"),
          -l.quantity,
          -l.quantity,
          "Shipment",
          so.number,
          `${key}:${l.id}`,
          actor,
        );
        await tx
          .update(s.saleItems)
          .set({
            reserved: line.reserved - l.quantity,
            shipped: line.shipped + l.quantity,
          })
          .where(eq(s.saleItems.id, l.id));
        await tx.insert(s.shipmentItems).values({
          shipmentId: shipment.id,
          saleItemId: l.id,
          quantity: l.quantity,
        });
      }
      await syncSale(tx, v.id);
    } else if (action === "bindSpecification") {
      const v = z
        .object({ id: z.uuid(), specificationId: z.uuid() })
        .parse(input);
      const [order] = await tx
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, v.id));
      if (
        !order ||
        order.specificationId ||
        ["Completed", "Cancelled"].includes(order.status)
      )
        throw new Error(
          "Only open legacy orders without a specification can be bound",
        );
      const spec = await resolveApprovedSpecification(
        tx,
        order.variantId,
        v.specificationId,
      );
      const [bom] = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.id, order.bomId));
      if (bom.specificationId && bom.specificationId !== spec.id)
        throw new Error("BOM specification differs");
      await tx
        .update(s.manufacturing)
        .set({ specificationId: spec.id })
        .where(eq(s.manufacturing.id, v.id));
    } else if (action === "manufacture") {
      const v = z
        .object({
          bomId: z.uuid(),
          specificationId: z.uuid().optional().or(z.literal("")),
          quantity: z.coerce.number().int().positive().max(1000000),
          brandingVersionId: z.uuid().optional().or(z.literal("")),
          saleItemId: z.uuid().optional().or(z.literal("")),
          dueDate: z.iso.date().optional().or(z.literal("")),
          notes: z.string().max(2000).optional(),
        })
        .parse(input);
      const [bom] = await tx
        .select()
        .from(s.boms)
        .where(eq(s.boms.id, v.bomId));
      if (!bom) throw new Error("BOM not found");
      const branding = await resolveBrandingForManufacturing(
        tx,
        v.saleItemId || undefined,
        v.brandingVersionId || undefined,
      );
      const spec = await resolveApprovedSpecification(
        tx,
        bom.variantId,
        v.specificationId ||
          bom.specificationId ||
          branding?.specificationId ||
          undefined,
      );
      if (branding && branding.specificationId !== spec.id)
        throw new Error(
          "Engineering and approved branding specifications must match",
        );
      if (bom.specificationId && bom.specificationId !== spec.id)
        throw new Error("BOM and manufacturing specification must match");
      if (v.saleItemId) {
        const [l] = await tx
          .select()
          .from(s.saleItems)
          .where(eq(s.saleItems.id, v.saleItemId));
        if (!l || l.variantId !== bom.variantId)
          throw new Error("Sales line does not match this BOM variant");
        if (branding) {
          const [order] = await tx
            .select()
            .from(s.sales)
            .where(eq(s.sales.id, l.orderId));
          if (
            order.status === "Draft" ||
            ["Cancelled", "Shipped", "Completed"].includes(order.status)
          )
            throw new Error(
              "Confirm the branded sales order before manufacturing",
            );
          const existing = await tx
            .select({
              quantity: s.manufacturing.quantity,
              completed: s.manufacturing.completed,
              status: s.manufacturing.status,
            })
            .from(s.manufacturing)
            .where(
              and(
                eq(s.manufacturing.saleItemId, l.id),
                sql`${s.manufacturing.status}<>'Cancelled'`,
              ),
            );
          if (
            existing.reduce(
              (n, o) =>
                n + (o.status === "Completed" ? o.completed : o.quantity),
              0,
            ) +
              v.quantity >
            l.quantity
          )
            throw new Error(
              "Branded production exceeds the sales line quantity",
            );
        }
      }
      await tx.insert(s.manufacturing).values({
        number: number("MO"),
        variantId: bom.variantId,
        bomId: bom.id,
        specificationId: spec.id,
        brandingVersionId: branding?.id,
        warehouseId: warehouse.id,
        quantity: v.quantity,
        saleItemId: v.saleItemId || null,
        dueDate: v.dueDate,
        notes: v.notes,
      });
    } else if (
      ["plan", "start", "record", "complete", "cancelProduction"].includes(
        action,
      )
    ) {
      const { id } = idInput.parse(input);
      const [mo] = await tx
        .select()
        .from(s.manufacturing)
        .where(eq(s.manufacturing.id, id));
      if (!mo) throw new Error("Production order not found");
      if (
        ["plan", "start", "record", "complete"].includes(action) &&
        mo.status !== "Completed" &&
        !mo.specificationId
      )
        throw new Error(
          "Bind an approved technical specification to this legacy order before continuing",
        );
      if (action === "plan") {
        if (mo.status !== "Draft")
          throw new Error("Only draft production can be planned");
        const items = await tx
          .select()
          .from(s.bomItems)
          .where(eq(s.bomItems.bomId, mo.bomId));
        if (!items.length) throw new Error("BOM has no materials");
        for (const item of items) {
          const needed = num(item.quantity).mul(mo.quantity);
          const b = await balance(
            tx,
            mo.warehouseId,
            item.materialId,
            "material",
          );
          await move(
            tx,
            b,
            0,
            needed,
            "Production reservation",
            mo.number,
            `${key}:${item.id}`,
            actor,
          );
          await tx.insert(s.reservations).values({
            orderId: id,
            balanceId: b.id,
            quantity: needed.toFixed(4),
          });
        }
        await tx
          .update(s.manufacturing)
          .set({ status: "Planned" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "start") {
        if (mo.status !== "Planned")
          throw new Error("Reserve materials before starting production");
        await tx
          .update(s.manufacturing)
          .set({ status: "In Progress" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "record") {
        const v = z
          .object({
            completed: z.coerce.number().int().nonnegative(),
            defective: z.coerce.number().int().nonnegative(),
            notes: z.string().max(2000).optional(),
          })
          .parse(input);
        if (
          mo.status !== "In Progress" ||
          v.completed + v.defective !== mo.quantity
        )
          throw new Error(
            "Account for all planned units before quality control",
          );
        await tx
          .update(s.manufacturing)
          .set({ ...v, status: "Quality Control" })
          .where(eq(s.manufacturing.id, id));
      } else if (action === "complete") {
        if (mo.status === "Completed") return;
        if (mo.status !== "Quality Control")
          throw new Error("Production must pass through quality control");
        const v = z
          .object({
            approved: z.coerce.number().int().nonnegative(),
            brandingCheck: z.enum(["Pass", "Fail"]).optional(),
            qualityResults: z
              .array(
                z.object({
                  check: z.string(),
                  result: z.enum(["Pass", "Fail"]),
                  notes: z.string().max(2000).default(""),
                }),
              )
              .max(100)
              .optional(),
            notes: z.string().max(2000).optional(),
            consumption: z
              .array(
                z.object({
                  reservationId: z.uuid(),
                  quantity: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
                }),
              )
              .optional(),
          })
          .parse(input);
        if (v.approved > mo.completed)
          throw new Error("Approved units exceed recorded completed units");
        if (
          mo.brandingVersionId &&
          (!v.brandingCheck || (v.approved > 0 && v.brandingCheck !== "Pass"))
        )
          throw new Error(
            "Verify branding against the fixed approved proof before accepting units",
          );
        const spec = await resolveApprovedSpecification(
          tx,
          mo.variantId,
          mo.specificationId!,
        );
        const checks = spec.document.qualityChecks;
        const qualityResults =
          v.qualityResults ??
          checks.map((check, i) => ({
            check,
            result: z
              .enum(["Pass", "Fail"])
              .parse((input as Record<string, unknown>)[`quality__${i}`]),
            notes: "",
          }));
        if (
          qualityResults.length !== checks.length ||
          new Set(qualityResults.map((r) => r.check)).size !== checks.length ||
          checks.some((c) => !qualityResults.some((r) => r.check === c)) ||
          (v.approved > 0 && qualityResults.some((r) => r.result !== "Pass"))
        )
          throw new Error(
            "Record every specification quality check; all checks must pass to accept units",
          );
        const reserved = await tx
          .select()
          .from(s.reservations)
          .where(eq(s.reservations.orderId, id));
        if (
          v.consumption &&
          (new Set(v.consumption.map((c) => c.reservationId)).size !==
            reserved.length ||
            v.consumption.length !== reserved.length ||
            v.consumption.some(
              (c) => !reserved.some((r) => r.id === c.reservationId),
            ))
        )
          throw new Error(
            "Consumption must account for every reserved material exactly once",
          );
        for (const r of reserved) {
          const [b] = await tx
            .select()
            .from(s.balances)
            .where(eq(s.balances.id, r.balanceId));
          const consumed =
            v.consumption?.find((c) => c.reservationId === r.id)?.quantity ??
            r.quantity;
          if (num(consumed).gt(num(b.onHand).minus(b.reserved).add(r.quantity)))
            throw new Error("Actual consumption exceeds available materials");
          await move(
            tx,
            b,
            num(consumed).neg(),
            num(r.quantity).neg(),
            "Production consumption / release",
            mo.number,
            `${key}:${r.id}`,
            actor,
          );
          await tx
            .update(s.reservations)
            .set({ consumed })
            .where(eq(s.reservations.id, r.id));
        }
        await tx.insert(s.inspections).values({
          orderId: id,
          approved: v.approved,
          rejected: mo.quantity - v.approved,
          notes: v.notes,
          inspectorId: actor.id,
          brandingVersionId: mo.brandingVersionId,
          brandingCheck: mo.brandingVersionId ? v.brandingCheck : null,
          specificationId: spec.id,
          specificationResults: qualityResults,
        });
        if (v.approved > 0)
          await move(
            tx,
            await balance(tx, mo.warehouseId, mo.variantId, "variant"),
            v.approved,
            0,
            "Quality-approved production",
            mo.number,
            `${key}:finished`,
            actor,
          );
        await tx
          .update(s.manufacturing)
          .set({
            status: "Completed",
            completed: v.approved,
            defective: mo.quantity - v.approved,
          })
          .where(eq(s.manufacturing.id, id));
      } else {
        if (!["Draft", "Planned"].includes(mo.status))
          throw new Error("Only draft or planned production can be cancelled");
        const reserved = await tx
          .select()
          .from(s.reservations)
          .where(eq(s.reservations.orderId, id));
        for (const r of reserved) {
          const [b] = await tx
            .select()
            .from(s.balances)
            .where(eq(s.balances.id, r.balanceId));
          await move(
            tx,
            b,
            0,
            num(r.quantity).neg(),
            "Cancelled production release",
            mo.number,
            `${key}:${r.id}`,
            actor,
          );
        }
        await tx
          .update(s.manufacturing)
          .set({ status: "Cancelled" })
          .where(eq(s.manufacturing.id, id));
      }
    } else if (action === "invoice") {
      const v = z
        .object({
          id: z.uuid(),
          dueDate: z.iso.date(),
          taxRate: amount.refine((v) => num(v).lte(100)),
        })
        .parse(input);
      const [so] = await tx.select().from(s.sales).where(eq(s.sales.id, v.id));
      if (!so || !["Shipped", "Completed"].includes(so.status))
        throw new Error("Invoice only fully shipped orders");
      const total = num(so.total)
        .mul(num(1).add(num(v.taxRate).div(100)))
        .toDecimalPlaces(2)
        .toFixed(2);
      await tx.insert(s.invoices).values({
        number: number("INV"),
        orderId: v.id,
        dueDate: v.dueDate,
        subtotal: so.total,
        taxRate: v.taxRate,
        total,
        status: num(total).isZero() ? "Paid" : "Unpaid",
      });
      if (num(total).isZero()) {
        await tx
          .update(s.sales)
          .set({ status: "Completed" })
          .where(eq(s.sales.id, v.id));
      }
    } else if (action === "pay") {
      const v = z
        .object({
          id: z.uuid(),
          amount: amount.refine((v) => num(v).gt(0)),
          reference: z.string().min(1).max(200),
        })
        .parse(input);
      const [invoice] = await tx
        .select()
        .from(s.invoices)
        .where(eq(s.invoices.id, v.id))
        .for("update");
      if (!invoice) throw new Error("Invoice not found");
      const paid = num(invoice.paid).add(v.amount);
      if (paid.gt(invoice.total))
        throw new Error("Payment exceeds outstanding balance");
      await tx.insert(s.payments).values({
        invoiceId: v.id,
        amount: v.amount,
        reference: v.reference,
        operationKey: key,
      });
      await tx
        .update(s.invoices)
        .set({
          paid: paid.toFixed(2),
          status: paid.eq(invoice.total) ? "Paid" : "Partially Paid",
        })
        .where(eq(s.invoices.id, v.id));
      if (paid.eq(invoice.total))
        await tx
          .update(s.sales)
          .set({ status: "Completed" })
          .where(eq(s.sales.id, invoice.orderId));
    }
    await tx.insert(s.audit).values({
      actorId: actor.id,
      action,
      entityId: key,
      details: { operationKey: key },
    });
  });
}
