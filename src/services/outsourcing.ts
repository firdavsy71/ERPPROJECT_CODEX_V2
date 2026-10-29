import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { planRolls, releaseRolls, receiveRolls, takeAvailableFabric } from "@/services/fabric-rolls";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Balance = typeof s.balances.$inferSelect;
type Context = {
  actor: Actor;
  key: string;
  warehouseId: string;
  balance: (itemId: string, kind: "material" | "variant") => Promise<Balance>;
  post: (
    balance: Balance,
    quantity: string,
    reserved: string,
    reason: string,
    suffix: string,
  ) => Promise<typeof s.movements.$inferSelect>;
};
const n = (v: Decimal.Value) => new Decimal(v),
  f = (v: Decimal.Value) => n(v).toFixed(4);
const qty = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,4})?$/)
  .refine((v) => n(v).gt(0));
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const ref = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .transform((v) => v.toUpperCase());
const orderInput = z.object({
  manufacturingOrderId: z.uuid(),
  subcontractorId: z.uuid(),
  dueDate: z.iso.date(),
  currency: z.enum(["UZS", "USD"]),
  unitCost: amount,
  notes: z.string().max(3000).default(""),
});

export async function outsourcingAction(
  tx: Tx,
  action: string,
  input: unknown,
  c: Context,
) {
  if (action === "saveSubcontractor") {
    const v = z
      .object({
        id: z.uuid().optional(),
        supplierId: z.uuid(),
        specialties: z.string().trim().min(1).max(1000),
        capacity: z.coerce.number().int().nonnegative(),
        notes: z.string().max(3000).default(""),
        active: z.enum(["true", "false"]).default("true"),
      })
      .parse(input);
    const [supplier] = await tx
      .select()
      .from(s.suppliers)
      .where(eq(s.suppliers.id, v.supplierId));
    if (!supplier) throw new Error("Supplier not found");
    const values = {
      supplierId: v.supplierId,
      specialties: v.specialties,
      capacity: v.capacity,
      notes: v.notes,
      active: v.active === "true",
    };
    if (v.id) {
      const [profile] = await tx
        .select()
        .from(s.subcontractors)
        .where(eq(s.subcontractors.id, v.id));
      if (!profile || profile.supplierId !== v.supplierId)
        throw new Error("Profile supplier cannot be changed");
      await tx
        .update(s.subcontractors)
        .set(values)
        .where(eq(s.subcontractors.id, v.id));
    } else await tx.insert(s.subcontractors).values(values);
    return;
  }
  if (action === "createOutsourcing" || action === "editOutsourcing") {
    const v = orderInput.parse(input);
    const [mo] = await tx
      .select()
      .from(s.manufacturing)
      .where(eq(s.manufacturing.id, v.manufacturingOrderId));
    if (!mo || mo.status !== "Draft" || !mo.specificationId)
      throw new Error(
        "Choose a draft manufacturing order with a fixed approved specification",
      );
    const [profile] = await tx
      .select()
      .from(s.subcontractors)
      .where(eq(s.subcontractors.id, v.subcontractorId));
    const [supplier] = profile
      ? await tx
          .select()
          .from(s.suppliers)
          .where(eq(s.suppliers.id, profile.supplierId))
      : [];
    if (!profile?.active || !supplier?.active)
      throw new Error("Choose an active subcontractor and supplier");
    if (action === "createOutsourcing")
      await tx.insert(s.outsourcingOrders).values({
        ...v,
        number: `OUT-${randomUUID().slice(0, 8).toUpperCase()}`,
        createdBy: c.actor.id,
      });
    else {
      const { id } = z.object({ id: z.uuid() }).parse(input);
      const [o] = await tx
        .select()
        .from(s.outsourcingOrders)
        .where(eq(s.outsourcingOrders.id, id));
      if (!o || o.status !== "Draft" || o.manufacturingOrderId !== mo.id)
        throw new Error(
          "Only draft order terms can be edited; manufacturing assignment is fixed",
        );
      await tx
        .update(s.outsourcingOrders)
        .set(v)
        .where(eq(s.outsourcingOrders.id, id));
    }
    return;
  }
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const [o] = await tx
    .select()
    .from(s.outsourcingOrders)
    .where(eq(s.outsourcingOrders.id, id))
    .for("update");
  if (!o) throw new Error("Outsourcing order not found");
  const [mo] = await tx
    .select()
    .from(s.manufacturing)
    .where(eq(s.manufacturing.id, o.manufacturingOrderId))
    .for("update");
  if (action === "cancelOutsourcing") {
    if (o.status !== "Draft")
      throw new Error(
        "Only unactivated draft orders can be cancelled; settle active orders and custody first",
      );
    await tx
      .update(s.outsourcingOrders)
      .set({ status: "Cancelled" })
      .where(eq(s.outsourcingOrders.id, id));
    return;
  }
  if (action === "activateOutsourcing") {
    if (o.status !== "Draft" || mo.status !== "Draft")
      throw new Error("Only draft outsourcing can be activated");
    if (mo.saleItemId) {
      const [line] = await tx
        .select()
        .from(s.saleItems)
        .where(eq(s.saleItems.id, mo.saleItemId));
      const [sale] = await tx
        .select()
        .from(s.sales)
        .where(eq(s.sales.id, line.orderId));
      if (["Draft", "Cancelled"].includes(sale.status))
        throw new Error(
          "Confirm the sales order before reserving outsourcing materials",
        );
    }
    const [profile] = await tx
      .select()
      .from(s.subcontractors)
      .where(eq(s.subcontractors.id, o.subcontractorId));
    const [supplier] = await tx
      .select()
      .from(s.suppliers)
      .where(eq(s.suppliers.id, profile.supplierId));
    if (!profile.active || !supplier.active)
      throw new Error("Subcontractor or supplier is inactive");
    const items = await tx
      .select()
      .from(s.bomItems)
      .where(eq(s.bomItems.bomId, mo.bomId));
    if (!items.length) throw new Error("BOM has no materials");
    for (const item of items) {
      const b = await c.balance(item.materialId, "material");
      if (b.warehouseId !== mo.warehouseId)
        throw new Error("Manufacturing warehouse mismatch");
      const q = f(n(item.quantity).mul(mo.quantity));
      const movement = await c.post(
        b,
        "0",
        q,
        "Outsourcing material allocation",
        item.id,
      );
      const [r] = await tx
        .insert(s.reservations)
        .values({ orderId: mo.id, balanceId: b.id, quantity: q })
        .returning();
      if (b.rollTracked)
        await planRolls(tx, {
          balance: b,
          reservationId: r.id,
          orderId: mo.id,
          quantity: q,
          actorId: c.actor.id,
          operationKey: c.key + item.id,
          movementId: movement.id,
        });
    }
    await tx
      .update(s.outsourcingOrders)
      .set({ status: "Active" })
      .where(eq(s.outsourcingOrders.id, id));
    await tx
      .update(s.manufacturing)
      .set({ status: "In Progress" })
      .where(eq(s.manufacturing.id, mo.id));
    return;
  }
  if (action === "recordOutsourcingCost") {
    if (!["Active", "Completed"].includes(o.status))
      throw new Error("Record costs against active or completed orders");
    const v = z
      .object({
        reference: ref,
        amount: amount.refine((v) => n(v).gt(0)),
        notes: z.string().trim().min(3).max(3000),
      })
      .parse(input);
    await tx
      .insert(s.outsourcingCosts)
      .values({ ...v, orderId: id, createdBy: c.actor.id });
    return;
  }
  if (o.status !== "Active")
    throw new Error("This outsourcing order is not active");
  if (action === "outsourcingProgress") {
    const { produced } = z
      .object({ produced: z.coerce.number().int().nonnegative() })
      .parse(input);
    if (produced < o.produced || produced > mo.quantity)
      throw new Error(
        "Produced quantity must be cumulative, cannot decrease, and cannot exceed assigned quantity",
      );
    await tx
      .update(s.outsourcingOrders)
      .set({ produced })
      .where(eq(s.outsourcingOrders.id, id));
    return;
  }
  if (action === "issueOutsourcingMaterial") {
    const v = z
      .object({
        reservationId: z.uuid(),
        rollId: z.uuid().optional().or(z.literal("")),
        quantity: qty,
        reference: ref,
      })
      .parse(input);
    const [r] = await tx
      .select()
      .from(s.reservations)
      .where(
        and(
          eq(s.reservations.id, v.reservationId),
          eq(s.reservations.orderId, mo.id),
        ),
      );
    if (!r) throw new Error("Select this order's material reservation");
    const [b] = await tx
      .select()
      .from(s.balances)
      .where(eq(s.balances.id, r.balanceId))
      .for("update");
    const issues = await tx
      .select()
      .from(s.outsourcingCustody)
      .where(eq(s.outsourcingCustody.reservationId, r.id));
    if (
      issues
        .reduce((sum, i) => sum.add(i.quantity), n(0))
        .add(v.quantity)
        .gt(r.quantity)
    )
      throw new Error("Issue exceeds allocated materials");
    let segments: { start: string; end: string }[] = [];
    let roll: typeof s.fabricRolls.$inferSelect | undefined;
    if (b.rollTracked) {
      [roll] = await tx
        .select()
        .from(s.fabricRolls)
        .where(eq(s.fabricRolls.id, v.rollId || randomUUID()))
        .for("update");
      const [a] = await tx
        .select()
        .from(s.fabricRollReservations)
        .where(
          and(
            eq(s.fabricRollReservations.materialReservationId, r.id),
            eq(s.fabricRollReservations.rollId, roll?.id || randomUUID()),
          ),
        );
      if (
        !roll ||
        !a ||
        n(a.quantity).minus(a.consumed).minus(a.released).lt(v.quantity)
      )
        throw new Error(
          "Choose sufficient fabric on a roll allocated to this manufacturing order",
        );
      const cut = takeAvailableFabric(roll, v.quantity);
      segments = cut.taken;
      await tx
        .update(s.fabricRolls)
        .set({
          remainingLength: f(n(roll.remainingLength).minus(v.quantity)),
          reservedLength: f(n(roll.reservedLength).minus(v.quantity)),
          usableSegments: cut.remaining,
        })
        .where(eq(s.fabricRolls.id, roll.id));
      await tx
        .update(s.fabricRollReservations)
        .set({ released: f(n(a.released).add(v.quantity)) })
        .where(eq(s.fabricRollReservations.id, a.id));
    } else if (v.rollId)
      throw new Error("This material does not use roll tracking");
    const m = await c.post(
      b,
      f(n(v.quantity).neg()),
      f(n(v.quantity).neg()),
      "Custody transfer to subcontractor (not consumption)",
      "issue",
    );
    if (roll)
      await tx.insert(s.fabricRollMovements).values({
        rollId: roll.id,
        inventoryMovementId: m.id,
        manufacturingOrderId: mo.id,
        materialReservationId: r.id,
        quantity: f(n(v.quantity).neg()),
        reservedDelta: f(n(v.quantity).neg()),
        segments,
        reason: "Custody transfer, not consumed",
        source: o.number,
        operationKey: c.key + ":roll",
        createdBy: c.actor.id,
      });
    await tx.insert(s.outsourcingCustody).values({
      orderId: id,
      reservationId: r.id,
      rollId: roll?.id,
      quantity: v.quantity,
      segments,
      movementId: m.id,
      reference: v.reference,
      createdBy: c.actor.id,
    });
    return;
  }
  if (action === "settleOutsourcingMaterial") {
    const v = z
      .object({
        custodyId: z.uuid(),
        kind: z.enum(["Consumed", "Returned"]),
        quantity: qty,
        reference: ref,
      })
      .parse(input);
    const [line] = await tx
      .select()
      .from(s.outsourcingCustody)
      .where(
        and(
          eq(s.outsourcingCustody.id, v.custodyId),
          eq(s.outsourcingCustody.orderId, id),
        ),
      )
      .for("update");
    if (
      !line ||
      n(line.consumed).add(line.returned).add(v.quantity).gt(line.quantity)
    )
      throw new Error(
        "Settlement exceeds outstanding subcontractor material custody",
      );
    let returnedRollId: string | undefined, movementId: string | undefined;
    if (v.kind === "Returned") {
      const [r] = await tx
        .select()
        .from(s.reservations)
        .where(eq(s.reservations.id, line.reservationId));
      const [b] = await tx
        .select()
        .from(s.balances)
        .where(eq(s.balances.id, r.balanceId))
        .for("update");
      const m = await c.post(
        b,
        v.quantity,
        "0",
        "Unused material returned from subcontractor",
        "return",
      );
      movementId = m.id;
      if (b.rollTracked) {
        const [origin] = await tx
          .select()
          .from(s.fabricRolls)
          .where(eq(s.fabricRolls.id, line.rollId!));
        const rollNumber = `RETURN-${randomUUID().slice(0, 12).toUpperCase()}`;
        await receiveRolls(tx, {
          source: "Subcontractor custody return",
          balance: b,
          rolls: [
            {
              rollNumber,
              receivedLength: v.quantity,
              color: origin.color,
              composition: origin.composition,
              widthCm: origin.widthCm,
              storageLocation: origin.storageLocation,
              supplierBatch: origin.supplierBatch ?? "",
              supplierLot: origin.supplierLot ?? "",
              supplierId: origin.supplierId ?? undefined,
              notes: `Return from ${o.number}; custody ${line.id}; original roll ${origin.rollNumber}`,
            },
          ],
          quantity: v.quantity,
          movementId: m.id,
          actorId: c.actor.id,
          operationKey: c.key,
        });
        [returnedRollId] = (
          await tx
            .select()
            .from(s.fabricRolls)
            .where(eq(s.fabricRolls.rollNumber, rollNumber))
        ).map((r) => r.id);
      }
    }
    await tx
      .update(s.outsourcingCustody)
      .set(
        v.kind === "Consumed"
          ? { consumed: f(n(line.consumed).add(v.quantity)) }
          : { returned: f(n(line.returned).add(v.quantity)) },
      )
      .where(eq(s.outsourcingCustody.id, line.id));
    await tx.insert(s.outsourcingMaterialEvents).values({
      custodyId: line.id,
      kind: v.kind,
      quantity: v.quantity,
      reference: v.reference,
      returnedRollId,
      movementId,
      createdBy: c.actor.id,
    });
    return;
  }
  if (action === "receiveOutsourcing") {
    const v = z
      .object({
        reference: ref,
        accepted: z.coerce.number().int().nonnegative(),
        rejected: z.coerce.number().int().nonnegative(),
        notes: z.string().trim().min(3).max(3000),
        brandingCheck: z.enum(["Pass", "Fail"]).optional().or(z.literal("")),
      })
      .parse(input);
    const receipts = await tx
      .select()
      .from(s.outsourcingReceipts)
      .where(eq(s.outsourcingReceipts.orderId, id));
    if (
      v.accepted + v.rejected === 0 ||
      receipts.reduce((sum, r) => sum + r.accepted + r.rejected, 0) +
        v.accepted +
        v.rejected >
        o.produced
    )
      throw new Error(
        "Receipt exceeds cumulative reported production or has no goods",
      );
    const [spec] = await tx
      .select()
      .from(s.specifications)
      .where(eq(s.specifications.id, mo.specificationId!));
    const qualityResults = spec.document.qualityChecks.map((check, i) => ({
      check,
      result: z
        .enum(["Pass", "Fail"])
        .parse((input as Record<string, unknown>)[`quality__${i}`]),
    }));
    if (
      v.accepted > 0 &&
      (qualityResults.some((q) => q.result !== "Pass") ||
        (mo.brandingVersionId && v.brandingCheck !== "Pass"))
    )
      throw new Error(
        "Accepted goods require all fixed specification and branding checks to pass",
      );
    const movement = v.accepted
      ? await c.post(
          await c.balance(mo.variantId, "variant"),
          String(v.accepted),
          "0",
          "QC-accepted outsourced finished goods",
          "finished",
        )
      : undefined;
    await tx.insert(s.outsourcingReceipts).values({
      ...v,
      brandingCheck: mo.brandingVersionId ? v.brandingCheck || null : null,
      orderId: id,
      qualityResults,
      movementId: movement?.id,
      createdBy: c.actor.id,
    });
    return;
  }
  if (action === "closeOutsourcing") {
    const receipts = await tx
      .select()
      .from(s.outsourcingReceipts)
      .where(eq(s.outsourcingReceipts.orderId, id));
    if (
      receipts.reduce((n, r) => n + r.accepted + r.rejected, 0) !== mo.quantity
    )
      throw new Error("Receive and inspect every assigned unit before closing");
    const custody = await tx
      .select()
      .from(s.outsourcingCustody)
      .where(eq(s.outsourcingCustody.orderId, id));
    if (custody.some((l) => !n(l.consumed).add(l.returned).eq(l.quantity)))
      throw new Error("Reconcile outstanding material custody before closing");
    const rs = await tx
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.orderId, mo.id));
    for (const r of rs) {
      const lines = custody.filter((l) => l.reservationId === r.id);
      const remaining = n(r.quantity).minus(
        lines.reduce((q, l) => q.add(l.quantity), n(0)),
      );
      const consumed = lines.reduce((q, l) => q.add(l.consumed), n(0));
      if (remaining.gt(0)) {
        const [b] = await tx
          .select()
          .from(s.balances)
          .where(eq(s.balances.id, r.balanceId))
          .for("update");
        const movement = await c.post(
          b,
          "0",
          f(remaining.neg()),
          "Release unissued outsourcing allocation",
          r.id,
        );
        if (b.rollTracked)
          await releaseRolls(tx, {
            balance: b,
            reservationId: r.id,
            orderId: mo.id,
            quantity: f(remaining),
            actorId: c.actor.id,
            operationKey: c.key + r.id,
            movementId: movement.id,
          });
      }
      await tx
        .update(s.reservations)
        .set({ consumed: f(consumed) })
        .where(eq(s.reservations.id, r.id));
    }
    const accepted = receipts.reduce((n, r) => n + r.accepted, 0),
      rejected = mo.quantity - accepted;
    await tx.insert(s.inspections).values({
      orderId: mo.id,
      approved: accepted,
      rejected,
      inspectorId: c.actor.id,
      specificationId: mo.specificationId,
      brandingVersionId: mo.brandingVersionId,
      brandingCheck: mo.brandingVersionId
        ? accepted > 0
          ? "Pass"
          : "Fail"
        : null,
      specificationResults: [],
      notes: `Outsourcing ${o.number}; individual inspection results retained on partial receipts`,
    });
    await tx
      .update(s.manufacturing)
      .set({ status: "Completed", completed: accepted, defective: rejected })
      .where(eq(s.manufacturing.id, mo.id));
    await tx
      .update(s.outsourcingOrders)
      .set({ status: "Completed" })
      .where(eq(s.outsourcingOrders.id, id));
    return;
  }
  throw new Error("Unsupported outsourcing action");
}
