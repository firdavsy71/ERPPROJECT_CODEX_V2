import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";

export default async function RepairDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "repairs.read")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [order] = await db()
    .select()
    .from(s.repairOrders)
    .where(eq(s.repairOrders.id, id));
  if (!order) notFound();
  const [
    customers,
    variants,
    employees,
    materials,
    rolls,
    requirements,
    usage,
    labor,
    events,
  ] = await Promise.all([
    db().select().from(s.customers),
    db().select().from(s.variants),
    db().select().from(s.employees),
    db().select().from(s.materials),
    db().select().from(s.fabricRolls),
    db()
      .select()
      .from(s.repairRequirements)
      .where(eq(s.repairRequirements.repairId, id)),
    db()
      .select()
      .from(s.repairMaterialUsage)
      .where(eq(s.repairMaterialUsage.repairId, id)),
    db().select().from(s.repairLabor).where(eq(s.repairLabor.repairId, id)),
    db().select().from(s.repairEvents).where(eq(s.repairEvents.repairId, id)),
  ]);
  const note = {
    name: "notes",
    label: "Notes / evidence",
    type: "textarea" as const,
    required: true,
  };
  const employeeOptions = employees
    .filter((e) => e.active)
    .map((e) => ({ value: e.id, label: e.name }));
  const materialOptions = materials
    .filter((m) => m.active)
    .map((m) => ({ value: m.id, label: `${m.sku} · ${m.name} · ${m.unit}` }));
  const allowed: Record<string, string[]> = {
    Received: ["Diagnosed", "Cancelled"],
    Diagnosed: ["Awaiting Materials", "In Progress", "Cancelled"],
    "Awaiting Materials": ["In Progress", "Cancelled"],
    "In Progress": ["Awaiting Materials", "Quality Check", "Cancelled"],
    "Quality Check": ["In Progress", "Completed"],
    Completed: ["Returned"],
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{order.number}</h1>
          <p>{order.status} · Customer-owned garment</p>
        </div>
        <Link href="/repairs">All repairs</Link>
      </div>
      <p>
        Customer: {customers.find((c) => c.id === order.customerId)?.name} ·
        Product:{" "}
        {variants.find((v) => v.id === order.variantId)?.sku ||
          "Customer identified"}{" "}
        · {order.productDescription}
      </p>
      <p>
        {order.activity}: {order.instructions}
      </p>
      <p>
        Assigned:{" "}
        {employees.find((e) => e.id === order.employeeId)?.name || "Unassigned"}{" "}
        · Expected: {order.estimatedDate || "Not set"} · Cost: {order.cost}{" "}
        {order.currency}
      </p>
      {order.completionNotes && (
        <p>Completion / quality notes: {order.completionNotes}</p>
      )}
      {can(actor.role, "repairs.work") &&
        !["Returned", "Cancelled"].includes(order.status) && (
          <div className="actions">
            {order.status !== "Completed" && (
              <ActionForm
                label="Assign employee / update estimate"
                action="assignRepair"
                id={id}
                fields={[
                  {
                    name: "employeeId",
                    label: "Employee",
                    type: "select",
                    required: true,
                    options: employeeOptions,
                  },
                  {
                    name: "estimatedDate",
                    label: "Estimated completion date",
                    type: "date",
                    default: order.estimatedDate ?? "",
                  },
                  {
                    name: "cost",
                    label: "Repair cost",
                    type: "number",
                    required: true,
                    default: order.cost,
                  },
                  note,
                ]}
              />
            )}
            {allowed[order.status] && (
              <ActionForm
                label="Update repair status / record quality result"
                action="repairStatus"
                id={id}
                fields={[
                  {
                    name: "status",
                    label: "Next status",
                    type: "select",
                    required: true,
                    options: allowed[order.status].map((v) => ({
                      value: v,
                      label: v,
                    })),
                  },
                  note,
                ]}
              />
            )}
            {[
              "Received",
              "Diagnosed",
              "Awaiting Materials",
              "In Progress",
            ].includes(order.status) && (
              <ActionForm
                label="Add required material"
                action="requireRepairMaterial"
                id={id}
                fields={[
                  {
                    name: "materialId",
                    label: "Material",
                    type: "select",
                    required: true,
                    options: materialOptions,
                  },
                  {
                    name: "quantity",
                    label: "Required quantity",
                    type: "number",
                    required: true,
                  },
                  note,
                ]}
              />
            )}
            {order.status === "In Progress" && (
              <>
                <ActionForm
                  label="Record material consumption"
                  action="consumeRepairMaterial"
                  id={id}
                  fields={[
                    {
                      name: "materialId",
                      label: "Material",
                      type: "select",
                      required: true,
                      options: materialOptions,
                    },
                    {
                      name: "quantity",
                      label: "Actual quantity used",
                      type: "number",
                      required: true,
                    },
                    {
                      name: "rollId",
                      label: "Fabric roll (required for roll-tracked material)",
                      type: "select",
                      options: rolls.map((r) => ({
                        value: r.id,
                        label: `${r.rollNumber} · ${r.remainingLength} remaining`,
                      })),
                    },
                    note,
                  ]}
                />
                <ActionForm
                  label="Record actual labor"
                  action="recordRepairLabor"
                  id={id}
                  fields={[
                    {
                      name: "employeeId",
                      label: "Employee",
                      type: "select",
                      required: true,
                      options: employeeOptions,
                    },
                    {
                      name: "minutes",
                      label: "Actual labor minutes",
                      type: "number",
                      required: true,
                    },
                    note,
                  ]}
                />
              </>
            )}
          </div>
        )}
      <h2>Required materials</h2>
      <DataTable
        columns={["Material", "Quantity", "Notes"].map((key) => ({
          key,
          label: key,
        }))}
        rows={requirements.map((r) => ({
          id: r.id,
          Material: materials.find((m) => m.id === r.materialId)?.name ?? "",
          Quantity: r.quantity,
          Notes: r.notes ?? "",
        }))}
      />
      <h2>Actual material usage</h2>
      <DataTable
        columns={["Material", "Quantity", "Roll", "Movement"].map((key) => ({
          key,
          label: key,
        }))}
        rows={usage.map((r) => ({
          id: r.id,
          Material: materials.find((m) => m.id === r.materialId)?.name ?? "",
          Quantity: r.quantity,
          Roll: rolls.find((x) => x.id === r.rollId)?.rollNumber ?? "",
          Movement: r.movementId,
        }))}
      />
      <h2>Actual labor</h2>
      <DataTable
        columns={["Employee", "Minutes", "Notes"].map((key) => ({
          key,
          label: key,
        }))}
        rows={labor.map((r) => ({
          id: r.id,
          Employee: employees.find((e) => e.id === r.employeeId)?.name ?? "",
          Minutes: r.minutes,
          Notes: r.notes,
        }))}
      />
      <h2>Repair and quality history</h2>
      <DataTable
        columns={["Event", "Notes", "Date"].map((key) => ({ key, label: key }))}
        rows={events.map((e) => ({
          id: e.id,
          Event: e.event,
          Notes: e.notes,
          Date: e.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
