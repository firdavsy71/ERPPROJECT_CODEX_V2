import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { calculateCuttingResult } from "@/lib/cutting-calculations";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const dec = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);
export async function cuttingAction(
  tx: Tx,
  action: string,
  input: unknown,
  actorId: string,
) {
  if (action === "createCutting") {
    const v = z
      .object({
        reservationId: z.uuid(),
        rollId: z.uuid(),
        quantity: z.coerce.number().int().positive().max(1000000),
        layout: z.string().trim().min(5).max(4000),
        rateSource: z.enum(["BOM", "Specification"]),
      })
      .parse(input);
    const [reservation] = await tx
      .select()
      .from(s.reservations)
      .where(eq(s.reservations.id, v.reservationId));
    if (!reservation) throw new Error("Material reservation not found");
    const [order] = await tx
      .select()
      .from(s.manufacturing)
      .where(eq(s.manufacturing.id, reservation.orderId));
    if (
      (
        await tx
          .select()
          .from(s.outsourcingOrders)
          .where(
            and(
              eq(s.outsourcingOrders.manufacturingOrderId, reservation.orderId),
              eq(s.outsourcingOrders.status, "Active"),
            ),
          )
      ).length
    )
      throw new Error(
        "Outsourced production is managed by the subcontractor workflow",
      );
    if (
      !order?.specificationId ||
      !["Planned", "In Progress"].includes(order.status)
    )
      throw new Error(
        "Cutting requires an approved specification and a planned or active manufacturing order",
      );
    const [balance] = await tx
      .select()
      .from(s.balances)
      .where(eq(s.balances.id, reservation.balanceId));
    const [allocation] = await tx
      .select()
      .from(s.fabricRollReservations)
      .where(
        and(
          eq(s.fabricRollReservations.materialReservationId, reservation.id),
          eq(s.fabricRollReservations.rollId, v.rollId),
        ),
      );
    if (!balance.rollTracked || !allocation)
      throw new Error("Choose a roll reserved for this manufacturing material");
    const [variant] = await tx
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, order.variantId));
    const [bom] = await tx
      .select()
      .from(s.bomItems)
      .where(
        and(
          eq(s.bomItems.bomId, order.bomId),
          eq(s.bomItems.materialId, balance.materialId!),
        ),
      );
    const [spec] = await tx
      .select()
      .from(s.specificationVariants)
      .where(
        and(
          eq(s.specificationVariants.specificationId, order.specificationId),
          eq(s.specificationVariants.variantId, order.variantId),
        ),
      );
    if (!bom) throw new Error("Reserved fabric is not in the fixed BOM");
    if (v.rateSource === "Specification" && spec?.consumptionUnit !== "Meters")
      throw new Error(
        "The fixed size specification must contain a consumption rule in meters",
      );
    const rate =
      v.rateSource === "Specification" ? spec.fabricConsumption : bom.quantity;
    const planned = new Decimal(rate).mul(v.quantity);
    const existing = await tx
      .select()
      .from(s.cuttingBatches)
      .where(eq(s.cuttingBatches.reservationId, reservation.id));
    const active = existing.filter((b) => b.status !== "Cancelled");
    if (
      active.reduce((n, b) => n + b.quantity, 0) + v.quantity >
      order.quantity
    )
      throw new Error(
        "Cutting quantities exceed the manufacturing size quantity",
      );
    const held = active
      .filter((b) => b.rollId === v.rollId)
      .reduce((n, b) => n.add(b.result?.consumed ?? b.planned), new Decimal(0));
    if (
      held
        .add(planned)
        .gt(
          new Decimal(allocation.quantity)
            .minus(allocation.consumed)
            .minus(allocation.released),
        )
    )
      throw new Error(
        "Batch plans exceed this roll's manufacturing allocation",
      );
    await tx.insert(s.cuttingBatches).values({
      orderId: order.id,
      reservationId: reservation.id,
      rollId: v.rollId,
      specificationId: order.specificationId,
      size: variant.size,
      layout: v.layout,
      rateSource: v.rateSource,
      quantity: v.quantity,
      planned: planned.toFixed(4),
      createdBy: actorId,
    });
  } else {
    const { id } = z.object({ id: z.uuid() }).parse(input);
    const [batch] = await tx
      .select()
      .from(s.cuttingBatches)
      .where(eq(s.cuttingBatches.id, id))
      .for("update");
    if (!batch || batch.status !== "Planned")
      throw new Error("Only planned cutting batches can be changed");
    if (action === "cancelCutting") {
      await tx
        .update(s.cuttingBatches)
        .set({ status: "Cancelled" })
        .where(eq(s.cuttingBatches.id, id));
      return;
    }
    const v = z
      .object({
        issued: dec,
        incorporated: dec,
        waste: dec,
        returned: dec,
        piecesCut: z.coerce.number().int().nonnegative(),
        rejectedPieces: z.coerce.number().int().nonnegative(),
        cutPieces: z
          .array(
            z.object({
              part: z.string().trim().min(1).max(200),
              quantity: z.coerce.number().int().positive().max(1000000),
              rejected: z.coerce.number().int().nonnegative().max(1000000),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    if (
      v.cutPieces.some((p) => p.rejected > p.quantity) ||
      new Set(v.cutPieces.map((p) => p.part.toLowerCase())).size !==
        v.cutPieces.length
    )
      throw new Error(
        "Cut-piece parts must be unique and rejected quantities cannot exceed quantities cut",
      );
    if (v.piecesCut > batch.quantity)
      throw new Error("Pieces cut exceed this batch's planned quantity");
    const result = calculateCuttingResult({ ...v, planned: batch.planned });
    const [allocation] = await tx
      .select()
      .from(s.fabricRollReservations)
      .where(
        and(
          eq(
            s.fabricRollReservations.materialReservationId,
            batch.reservationId,
          ),
          eq(s.fabricRollReservations.rollId, batch.rollId),
        ),
      );
    const others = await tx
      .select()
      .from(s.cuttingBatches)
      .where(
        and(
          eq(s.cuttingBatches.reservationId, batch.reservationId),
          eq(s.cuttingBatches.rollId, batch.rollId),
        ),
      );
    const held = others
      .filter((b) => b.id !== batch.id && b.status !== "Cancelled")
      .reduce((n, b) => n.add(b.result?.consumed ?? b.planned), new Decimal(0));
    if (
      allocation &&
      held.add(v.issued).gt(
        new Decimal(allocation.quantity)
          .minus(allocation.consumed)
          .minus(allocation.released),
      )
    )
      throw new Error("Fabric issued exceeds the reserved roll allocation");
    if (
      !allocation ||
      held
        .add(result.consumed)
        .gt(
          new Decimal(allocation.quantity)
            .minus(allocation.consumed)
            .minus(allocation.released),
        )
    )
      throw new Error(
        "Actual cutting consumption exceeds the reserved roll allocation",
      );
    await tx
      .update(s.cuttingBatches)
      .set({
        status: "Completed",
        result: { ...v, ...result },
        completedBy: actorId,
      })
      .where(eq(s.cuttingBatches.id, id));
  }
}

/** Cutting records fix the fabric actuals supplied to the existing single stock posting at QC. */
export async function cuttingCompletion(
  tx: Tx,
  orderId: string,
  input: unknown,
) {
  const batches = (
    await tx
      .select()
      .from(s.cuttingBatches)
      .where(eq(s.cuttingBatches.orderId, orderId))
  ).filter((b) => b.status !== "Cancelled");
  if (!batches.length) return input;
  if (batches.some((b) => b.status !== "Completed"))
    throw new Error(
      "Complete or cancel every cutting batch before manufacturing completion",
    );
  const data = input as Record<string, unknown>;
  for (const reservationId of new Set(batches.map((b) => b.reservationId))) {
    const accepted = batches
      .filter((b) => b.reservationId === reservationId)
      .reduce((n, b) => n + b.result!.acceptedPieces, 0);
    if (Number(data.approved) > accepted)
      throw new Error(
        "Quality-approved units cannot exceed accepted garment sets from cutting",
      );
  }
  const reservations = await tx
    .select()
    .from(s.reservations)
    .where(eq(s.reservations.orderId, orderId));
  const entered = z
    .array(z.object({ reservationId: z.uuid(), quantity: dec }))
    .optional()
    .parse(data.consumption);
  const otherRolls =
    z
      .array(
        z.object({ reservationId: z.uuid(), rollId: z.uuid(), quantity: dec }),
      )
      .optional()
      .parse(data.rollConsumption)
      ?.filter(
        (r) => !batches.some((b) => b.reservationId === r.reservationId),
      ) ?? [];
  const rollConsumption = batches.reduce((list, b) => {
    const prior = list.find(
      (x) => x.reservationId === b.reservationId && x.rollId === b.rollId,
    );
    if (prior)
      prior.quantity = new Decimal(prior.quantity)
        .add(b.result!.consumed)
        .toFixed(4);
    else if (new Decimal(b.result!.consumed).gt(0))
      list.push({
        reservationId: b.reservationId,
        rollId: b.rollId,
        quantity: b.result!.consumed,
      });
    return list;
  }, otherRolls);
  return {
    ...data,
    consumption: reservations.map((r) => ({
      reservationId: r.id,
      quantity: batches.some((b) => b.reservationId === r.id)
        ? batches
            .filter((b) => b.reservationId === r.id)
            .reduce((n, b) => n.add(b.result!.consumed), new Decimal(0))
            .toFixed(4)
        : (entered?.find((e) => e.reservationId === r.id)?.quantity ??
          r.quantity),
    })),
    rollConsumption,
  };
}
