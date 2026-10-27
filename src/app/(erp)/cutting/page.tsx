import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function CuttingPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const [batches, orders, reservations, rolls, variants, materials, balances] =
    await Promise.all([
      db().select().from(s.cuttingBatches),
      db().select().from(s.manufacturing),
      db().select().from(s.reservations),
      db().select().from(s.fabricRolls),
      db().select().from(s.variants),
      db().select().from(s.materials),
      db().select().from(s.balances),
    ]);
  const options = reservations
    .filter(
      (r) =>
        orders.some(
          (o) =>
            o.id === r.orderId && ["Planned", "In Progress"].includes(o.status),
        ) && balances.some((b) => b.id === r.balanceId && b.rollTracked),
    )
    .map((r) => ({
      value: r.id,
      label: `${orders.find((o) => o.id === r.orderId)?.number} · ${materials.find((m) => m.id === balances.find((b) => b.id === r.balanceId)?.materialId)?.name} · ${r.quantity} m`,
    }));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRODUCTION</p>
          <h1>Cutting room</h1>
          <p className="muted">
            Operator layouts, fabric reconciliation and cut-piece records.
          </p>
        </div>
      </div>
      <p>
        Each cutting order is linked to a manufacturing order and its fixed
        size, BOM and approved specification. Use separate manufacturing orders
        for M, L and XL.
      </p>
      <p className="muted">
        Recorded fabric stays reserved until manufacturing QC posts the stock
        consumption. Completed cutting records supply the fabric actuals
        automatically. Efficiency is incorporated fabric / consumed fabric;
        usable returns are excluded.
      </p>
      {can(actor.role, "manufacturing") && (
        <ActionForm
          label="New cutting batch"
          action="createCutting"
          fields={[
            {
              name: "reservationId",
              label: "Manufacturing material reservation",
              type: "select",
              options,
              required: true,
            },
            {
              name: "rollId",
              label: "Reserved fabric roll",
              type: "select",
              options: rolls.map((r) => ({
                value: r.id,
                label: `${r.rollNumber} · ${r.reservedLength} m reserved · batch ${r.supplierBatch ?? "—"}`,
              })),
              required: true,
            },
            {
              name: "quantity",
              label: "Garment sets planned for this size",
              type: "number",
              required: true,
            },
            {
              name: "rateSource",
              label: "Consumption rule for selected fabric",
              type: "select",
              options: [
                { value: "BOM", label: "Fixed BOM per-unit consumption" },
                {
                  value: "Specification",
                  label: "Fixed size specification (apply to selected fabric)",
                },
              ],
              required: true,
            },
            {
              name: "layout",
              label:
                "Operator layout / marker reference, layers and cut-piece instructions",
              type: "textarea",
              required: true,
            },
          ]}
        />
      )}
      <DataTable
        href="cutting"
        rows={batches.map((b) => ({
          id: b.id,
          order: orders.find((o) => o.id === b.orderId)?.number,
          size: b.size,
          roll: rolls.find((r) => r.id === b.rollId)?.rollNumber,
          status: b.status,
          planned: b.planned,
          actual: b.result?.consumed,
          waste: b.result?.waste,
          variance: b.result?.variance,
          efficiency: b.result?.efficiencyPercent,
          accepted: b.result?.acceptedPieces,
          rejected: b.result?.rejectedPieces,
          sku: variants.find(
            (v) => v.id === orders.find((o) => o.id === b.orderId)?.variantId,
          )?.sku,
        }))}
        columns={[
          { key: "order", label: "Cutting order / MO" },
          { key: "size", label: "Size" },
          { key: "roll", label: "Roll" },
          { key: "status", label: "Status" },
          { key: "planned", label: "Planned m" },
          { key: "actual", label: "Actual m" },
          { key: "waste", label: "Waste m" },
          { key: "variance", label: "Actual − planned m" },
          { key: "efficiency", label: "Efficiency %" },
          { key: "accepted", label: "Accepted sets" },
          { key: "rejected", label: "Rejected sets" },
        ]}
      />
      <p>
        <Link href="/manufacturing">Manufacturing orders</Link> ·{" "}
        <Link href="/fabric-rolls">Fabric roll inventory</Link>
      </p>
    </>
  );
}
