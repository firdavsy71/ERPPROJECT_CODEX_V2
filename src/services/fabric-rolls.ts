import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { damageSegments, takeSegments, type FabricSegment } from "@/lib/fabric-segments";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const n = (v: Decimal.Value) => new Decimal(v);
const fixed = (v: Decimal.Value) => n(v).toFixed(4);
const positive = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/).refine((v) => n(v).gt(0), "Must be positive");
export const rollInputSchema = z.object({
  rollNumber: z.string().trim().min(1).max(100),
  supplierBatch: z.string().trim().max(100).optional().default(""),
  supplierLot: z.string().trim().max(100).optional().default(""),
  color: z.string().trim().min(1).max(100),
  composition: z.string().trim().min(1).max(300),
  widthCm: positive,
  receivedLength: positive,
  storageLocation: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional().default(""),
  supplierId: z.uuid().optional().or(z.literal("")),
});
export type RollInput = z.infer<typeof rollInputSchema>;
type Allocation = { rollId: string; quantity: string };
type Context = {
  balance: typeof s.balances.$inferSelect;
  reservationId: string;
  orderId: string;
  actorId: string;
  operationKey: string;
  movementId: string;
};

type RollCreation = {
  balance: typeof s.balances.$inferSelect;
  rolls: RollInput[];
  actorId: string;
  operationKey: string;
  movementId?: string;
  purchaseReceiptId?: string;
  purchaseOrderItemId?: string;
  supplierId?: string;
};

async function createRolls(tx: Tx, c: RollCreation, opening: boolean) {
  for (const input of c.rolls) {
    const [roll] = await tx.insert(s.fabricRolls).values({
      balanceId: c.balance.id, rollNumber: input.rollNumber,
      supplierId: input.supplierId || c.supplierId || null,
      purchaseReceiptId: c.purchaseReceiptId, purchaseOrderItemId: c.purchaseOrderItemId,
      supplierBatch: input.supplierBatch || null, supplierLot: input.supplierLot || null,
      color: input.color, composition: input.composition, widthCm: input.widthCm,
      receivedLength: input.receivedLength, physicalLength: input.receivedLength,
      remainingLength: input.receivedLength, storageLocation: input.storageLocation,
      notes: input.notes || null, createdBy: c.actorId,
      usableSegments: [{ start: "0.0000", end: fixed(input.receivedLength) }],
    }).returning();
    await tx.insert(s.fabricRollMovements).values({
      rollId: roll.id, inventoryMovementId: c.movementId || null,
      quantity: fixed(input.receivedLength), reservedDelta: "0", reason: opening ? "opening allocation" : "receipt",
      source: opening ? "existing stock" : "purchase receipt", operationKey: `${c.operationKey}:roll:${roll.id}`,
      createdBy: c.actorId, segments: [{ start: "0.0000", end: fixed(input.receivedLength) }],
    });
  }
}
export async function activateRollTracking(tx: Tx, c: RollCreation) {
  if (c.balance.rollTracked || !c.balance.materialId) throw new Error("This balance cannot be enabled for roll tracking.");
  const [material] = await tx.select().from(s.materials).where(eq(s.materials.id, c.balance.materialId));
  if (material?.unit !== "Meters") throw new Error("Only materials measured in meters can be tracked by roll.");
  if (!n(c.balance.reserved).isZero()) throw new Error("Release existing material reservations before enabling roll tracking.");
  if (!c.rolls.reduce((sum, r) => sum.add(r.receivedLength), n(0)).eq(c.balance.onHand))
    throw new Error("Opening roll lengths must add up exactly to the existing on-hand balance.");
  await tx.update(s.balances).set({ rollTracked: true }).where(eq(s.balances.id, c.balance.id));
  await createRolls(tx, c, true);
}
export async function receiveRolls(tx: Tx, c: RollCreation & { quantity: string }) {
  if (!c.balance.rollTracked) throw new Error("Enable roll tracking for this material first.");
  if (!c.movementId || !c.rolls.length || !c.rolls.reduce((sum, r) => sum.add(r.receivedLength), n(0)).eq(c.quantity))
    throw new Error("Received roll lengths must add up exactly to the receipt quantity.");
  await createRolls(tx, c, false);
}

type Movement = typeof s.movements.$inferSelect;
type RollChange = { rollId: string; actorId: string; operationKey: string; reason: string; applyMovement: (balance: typeof s.balances.$inferSelect, delta: string) => Promise<Movement> };
async function getRollForChange(tx: Tx, id: string) {
  const [roll] = await tx.select().from(s.fabricRolls).where(eq(s.fabricRolls.id, id)).for("update");
  if (!roll) throw new Error("Fabric roll not found.");
  const [balance] = await tx.select().from(s.balances).where(eq(s.balances.id, roll.balanceId)).for("update");
  if (!balance?.rollTracked) throw new Error("The roll's material balance is not tracked.");
  return { roll, balance };
}
export async function adjustRoll(tx: Tx, c: RollChange & { delta: string }) {
  const { roll, balance } = await getRollForChange(tx, c.rollId);
  const delta = n(c.delta);
  if (delta.isZero()) throw new Error("Adjustment cannot be zero.");
  if (delta.isNegative() && delta.abs().gt(n(roll.remainingLength).minus(roll.reservedLength))) throw new Error("Cannot adjust away reserved fabric.");
  const cut = delta.isNegative() ? takeSegments(roll.usableSegments as FabricSegment[], fixed(delta.abs()), true) : {
    remaining: [...roll.usableSegments, { start: fixed(roll.physicalLength), end: fixed(n(roll.physicalLength).add(delta)) }],
    taken: [{ start: fixed(roll.physicalLength), end: fixed(n(roll.physicalLength).add(delta)) }],
  };
  const movement = await c.applyMovement(balance, fixed(delta));
  await tx.update(s.fabricRolls).set({ remainingLength: fixed(n(roll.remainingLength).add(delta)), physicalLength: delta.gt(0) ? fixed(n(roll.physicalLength).add(delta)) : roll.physicalLength, usableSegments: cut.remaining }).where(eq(s.fabricRolls.id, roll.id));
  await tx.insert(s.fabricRollMovements).values({ rollId: roll.id, inventoryMovementId: movement.id, quantity: fixed(delta), reservedDelta: "0", reason: c.reason, source: "roll adjustment", operationKey: `${c.operationKey}:roll`, createdBy: c.actorId, segments: cut.taken });
}
export async function damageRoll(tx: Tx, c: RollChange & { start: string; end: string }) {
  const { roll, balance } = await getRollForChange(tx, c.rollId);
  const cut = damageSegments(roll.usableSegments as FabricSegment[], c.start, c.end);
  if (n(cut.quantity).gt(n(roll.remainingLength).minus(roll.reservedLength))) throw new Error("Cannot damage fabric reserved for manufacturing; release the reservation first.");
  const movement = await c.applyMovement(balance, fixed(n(cut.quantity).neg()));
  await tx.update(s.fabricRolls).set({ remainingLength: fixed(n(roll.remainingLength).minus(cut.quantity)), usableSegments: cut.remaining }).where(eq(s.fabricRolls.id, roll.id));
  const [event] = await tx.insert(s.fabricRollMovements).values({ rollId: roll.id, inventoryMovementId: movement.id, quantity: fixed(n(cut.quantity).neg()), reservedDelta: "0", reason: c.reason, source: "fabric defect", operationKey: `${c.operationKey}:roll`, createdBy: c.actorId, segments: cut.taken }).returning();
  await tx.insert(s.fabricDefects).values({ rollId: roll.id, movementId: event.id, startMeter: fixed(c.start), endMeter: fixed(c.end), description: c.reason, createdBy: c.actorId });
}

async function lockedRolls(tx: Tx, balanceId: string) {
  return tx.select().from(s.fabricRolls).where(eq(s.fabricRolls.balanceId, balanceId)).orderBy(s.fabricRolls.id).for("update");
}
async function event(tx: Tx, c: Context, rollId: string, quantity: Decimal.Value, reservedDelta: Decimal.Value, reason: string, segments: FabricSegment[] = []) {
  await tx.insert(s.fabricRollMovements).values({
    rollId, inventoryMovementId: c.movementId, manufacturingOrderId: c.orderId,
    materialReservationId: c.reservationId, quantity: fixed(quantity), reservedDelta: fixed(reservedDelta),
    reason, source: "manufacturing", operationKey: `${c.operationKey}:${reason}:${rollId}`,
    createdBy: c.actorId, segments,
  });
}

export async function planRolls(tx: Tx, c: Context & { quantity: string; allocations?: Allocation[] }) {
  const rolls = await lockedRolls(tx, c.balance.id);
  const target = n(c.quantity);
  let allocations = c.allocations;
  if (!allocations) {
    let remaining = target;
    allocations = [];
    for (const roll of [...rolls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
      const available = n(roll.remainingLength).minus(roll.reservedLength);
      const amount = Decimal.min(available, remaining);
      if (amount.gt(0)) allocations.push({ rollId: roll.id, quantity: fixed(amount) });
      remaining = remaining.minus(amount);
      if (remaining.isZero()) break;
    }
    if (!remaining.isZero()) throw new Error("Insufficient unreserved fabric on tracked rolls.");
  }
  if (new Set(allocations.map((a) => a.rollId)).size !== allocations.length || !allocations.reduce((sum, a) => sum.add(a.quantity), n(0)).eq(target))
    throw new Error("Roll allocations must be unique and add up to the required material quantity.");
  for (const allocation of allocations) {
    const roll = rolls.find((r) => r.id === allocation.rollId);
    const amount = n(allocation.quantity);
    if (!roll || amount.lte(0) || amount.gt(n(roll.remainingLength).minus(roll.reservedLength)))
      throw new Error("A selected roll is unavailable or has insufficient unreserved length.");
    await tx.update(s.fabricRolls).set({ reservedLength: fixed(n(roll.reservedLength).add(amount)) }).where(eq(s.fabricRolls.id, roll.id));
    await tx.insert(s.fabricRollReservations).values({ rollId: roll.id, manufacturingOrderId: c.orderId, materialReservationId: c.reservationId, quantity: fixed(amount) });
    await event(tx, c, roll.id, 0, amount, "reserve");
  }
}

export async function consumeRolls(tx: Tx, c: Context & { reservedQuantity: string; quantity: string; consumption?: Allocation[] }) {
  const rolls = await lockedRolls(tx, c.balance.id);
  const reservations = await tx.select().from(s.fabricRollReservations).where(eq(s.fabricRollReservations.materialReservationId, c.reservationId));
  const owned = new Map(reservations.map((r) => [r.rollId, n(r.quantity).minus(r.consumed).minus(r.released)]));
  if (!Array.from(owned.values()).reduce((a, b) => a.add(b), n(0)).eq(c.reservedQuantity)) throw new Error("Fabric roll reservations do not match the order reservation.");
  let consumption = c.consumption;
  if (!consumption) {
    let left = n(c.quantity);
    if (left.gt(c.reservedQuantity)) throw new Error("Choose rolls explicitly when consumption exceeds the reservation.");
    consumption = [];
    for (const roll of rolls) {
      const take = Decimal.min(left, owned.get(roll.id) ?? n(0));
      if (take.gt(0)) consumption.push({ rollId: roll.id, quantity: fixed(take) });
      left = left.minus(take);
    }
  }
  if (new Set(consumption.map((a) => a.rollId)).size !== consumption.length || !consumption.reduce((a, x) => a.add(x.quantity), n(0)).eq(c.quantity))
    throw new Error("Roll consumption must be unique and add up to the actual material consumption.");
  const actual = new Map(consumption.map((a) => [a.rollId, n(a.quantity)]));
  for (const [id, amount] of actual) {
    const roll = rolls.find((r) => r.id === id);
    if (!roll || amount.lte(0) || amount.gt(n(roll.remainingLength).minus(roll.reservedLength).add(owned.get(id) ?? 0)))
      throw new Error("Selected roll consumption exceeds fabric available to this order.");
  }
  for (const roll of rolls) {
    const allocation = owned.get(roll.id) ?? n(0), amount = actual.get(roll.id) ?? n(0);
    if (allocation.isZero() && amount.isZero()) continue;
    const cut = amount.gt(0) ? takeSegments(roll.usableSegments as FabricSegment[], fixed(amount)) : { remaining: roll.usableSegments as FabricSegment[], taken: [] };
    await tx.update(s.fabricRolls).set({ remainingLength: fixed(n(roll.remainingLength).minus(amount)), reservedLength: fixed(n(roll.reservedLength).minus(allocation)), usableSegments: cut.remaining }).where(eq(s.fabricRolls.id, roll.id));
    if (allocation.gt(0)) {
      const used = Decimal.min(amount, allocation);
      await tx.update(s.fabricRollReservations).set({ consumed: fixed(used), released: fixed(allocation.minus(used)) }).where(and(eq(s.fabricRollReservations.materialReservationId, c.reservationId), eq(s.fabricRollReservations.rollId, roll.id)));
    }
    await event(tx, c, roll.id, amount.neg(), allocation.neg(), "consume", cut.taken);
  }
}

export async function releaseRolls(tx: Tx, c: Context & { quantity: string }) {
  const rolls = await lockedRolls(tx, c.balance.id);
  const reservations = await tx.select().from(s.fabricRollReservations).where(eq(s.fabricRollReservations.materialReservationId, c.reservationId));
  const total = reservations.reduce((a, r) => a.add(n(r.quantity).minus(r.consumed).minus(r.released)), n(0));
  if (!total.eq(c.quantity)) throw new Error("Fabric roll reservations do not match the order reservation.");
  for (const reservation of reservations) {
    const amount = n(reservation.quantity).minus(reservation.consumed).minus(reservation.released);
    if (amount.isZero()) continue;
    const roll = rolls.find((r) => r.id === reservation.rollId);
    if (!roll) throw new Error("Reserved fabric roll was not found.");
    await tx.update(s.fabricRolls).set({ reservedLength: fixed(n(roll.reservedLength).minus(amount)) }).where(eq(s.fabricRolls.id, roll.id));
    await tx.update(s.fabricRollReservations).set({ released: fixed(n(reservation.released).add(amount)) }).where(eq(s.fabricRollReservations.id, reservation.id));
    await event(tx, c, roll.id, 0, amount.neg(), "release");
  }
}
