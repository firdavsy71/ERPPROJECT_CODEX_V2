import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { Data } from "@/services/queries";
import { DataTable } from "./data-table";
import {
  ManufacturingRollForm,
  type ProductionRollMaterial,
} from "./manufacturing-roll-form";

export async function ManufacturingRolls({
  order,
  data,
  editable,
  qualityChecks,
}: {
  order: typeof s.manufacturing.$inferSelect;
  data: Data;
  editable: boolean;
  qualityChecks: string[];
}) {
  const database = db();
  const [availableRolls, allocations, history] = await Promise.all([
    database
      .select({ roll: s.fabricRolls, materialId: s.balances.materialId })
      .from(s.fabricRolls)
      .innerJoin(s.balances, eq(s.fabricRolls.balanceId, s.balances.id))
      .where(eq(s.balances.warehouseId, order.warehouseId)),
    database
      .select({ allocation: s.fabricRollReservations, roll: s.fabricRolls })
      .from(s.fabricRollReservations)
      .innerJoin(
        s.fabricRolls,
        eq(s.fabricRollReservations.rollId, s.fabricRolls.id),
      )
      .where(eq(s.fabricRollReservations.manufacturingOrderId, order.id)),
    database
      .select({ event: s.fabricRollMovements, roll: s.fabricRolls })
      .from(s.fabricRollMovements)
      .innerJoin(
        s.fabricRolls,
        eq(s.fabricRollMovements.rollId, s.fabricRolls.id),
      )
      .where(eq(s.fabricRollMovements.manufacturingOrderId, order.id)),
  ]);
  const requirements =
    order.status === "Draft"
      ? data.bomItems
          .filter((item) => item.bomId === order.bomId)
          .map((item) => ({
            materialId: item.materialId,
            required: new Decimal(item.quantity).mul(order.quantity).toFixed(4),
            reservationId: undefined as string | undefined,
          }))
      : data.reservations
          .filter((reservation) => reservation.orderId === order.id)
          .map((reservation) => ({
            materialId:
              data.balances.find(
                (balance) => balance.id === reservation.balanceId,
              )?.materialId ?? "",
            required: reservation.quantity,
            reservationId: reservation.id,
          }));
  const materials: ProductionRollMaterial[] = requirements.map(
    (requirement) => {
      const balance = data.balances.find(
        (balance) =>
          balance.materialId === requirement.materialId &&
          balance.warehouseId === order.warehouseId,
      );
      return {
        ...requirement,
        label:
          data.materials.find(
            (material) => material.id === requirement.materialId,
          )?.name ?? requirement.materialId,
        tracked: Boolean(balance?.rollTracked),
        rolls: availableRolls
          .filter((row) => row.materialId === requirement.materialId)
          .map(({ roll }) => {
            const allocation = allocations.find(
              (row) =>
                row.roll.id === roll.id &&
                row.allocation.materialReservationId ===
                  requirement.reservationId,
            )?.allocation;
            const owned = allocation
              ? new Decimal(allocation.quantity)
                  .minus(allocation.consumed)
                  .minus(allocation.released)
              : new Decimal(0);
            return {
              id: roll.id,
              label: `${roll.rollNumber} · batch ${roll.supplierBatch ?? "—"} · lot ${roll.supplierLot ?? "—"} · ${roll.color}`,
              allocated: owned.toFixed(4),
              available: new Decimal(roll.remainingLength)
                .minus(roll.reservedLength)
                .minus(roll.heldLength)
                .add(owned)
                .toFixed(4),
            };
          })
          .filter(
            (roll) =>
              new Decimal(roll.available).gt(0) ||
              new Decimal(roll.allocated).gt(0),
          ),
      };
    },
  );
  const hasTracked = materials.some((material) => material.tracked);
  if (!hasTracked && !history.length) return null;
  return (
    <section aria-labelledby="manufacturing-rolls-heading">
      <h3 id="manufacturing-rolls-heading">
        Fabric roll allocation & traceability
      </h3>
      {editable &&
        hasTracked &&
        ["Draft", "Quality Control"].includes(order.status) && (
          <ManufacturingRollForm
            id={order.id}
            mode={order.status === "Draft" ? "plan" : "complete"}
            materials={materials}
            completed={order.completed}
            qualityChecks={qualityChecks}
            branded={Boolean(order.brandingVersionId)}
          />
        )}
      {allocations.length > 0 && (
        <DataTable
          href="fabric-rolls"
          rows={allocations.map(({ allocation, roll }) => ({
            id: roll.id,
            roll: roll.rollNumber,
            batch: roll.supplierBatch ?? "—",
            lot: roll.supplierLot ?? "—",
            reserved: allocation.quantity,
            consumed: allocation.consumed,
            released: allocation.released,
          }))}
          columns={[
            { key: "roll", label: "Roll" },
            { key: "batch", label: "Supplier batch" },
            { key: "lot", label: "Lot" },
            { key: "reserved", label: "Originally reserved (m)" },
            { key: "consumed", label: "Consumed from allocation (m)" },
            { key: "released", label: "Released (m)" },
          ]}
        />
      )}
      {history.length > 0 && (
        <>
          <h4>Roll movement history (including extra consumption)</h4>
          <DataTable
            rows={history.map(({ event, roll }) => ({
              id: event.id,
              roll: roll.rollNumber,
              batch: roll.supplierBatch ?? "—",
              action: event.reason,
              quantity: event.quantity,
              reservation: event.reservedDelta,
              sections:
                event.segments
                  .map((segment) => `${segment.start}–${segment.end} m`)
                  .join(", ") || "—",
              date: event.createdAt.toISOString(),
            }))}
            columns={[
              { key: "roll", label: "Roll" },
              { key: "batch", label: "Batch" },
              { key: "action", label: "Action" },
              { key: "quantity", label: "Stock delta (m)" },
              { key: "reservation", label: "Reserved delta (m)" },
              { key: "sections", label: "Physical sections" },
              { key: "date", label: "Time" },
            ]}
          />
        </>
      )}
      {!allocations.length && !history.length && (
        <p className="muted">
          No fabric allocated yet. Choose specific rolls when reserving this
          order.
        </p>
      )}
    </section>
  );
}
