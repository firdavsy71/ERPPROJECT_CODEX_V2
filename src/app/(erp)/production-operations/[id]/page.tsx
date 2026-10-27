import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { operationProgress } from "@/services/labor";
export default async function OperationOrder({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [order] = await db()
    .select()
    .from(s.manufacturing)
    .where(eq(s.manufacturing.id, id));
  if (!order) notFound();
  const [route] = await db()
    .select()
    .from(s.orderRoutings)
    .where(eq(s.orderRoutings.orderId, id));
  const employees = await db().select().from(s.employees);
  const entries = route
    ? await db()
        .select()
        .from(s.laborEntries)
        .where(eq(s.laborEntries.orderRoutingId, route.id))
    : [];
  const progress = route
    ? operationProgress(order.quantity, route.steps, entries)
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{order.number} · operations</h1>
          <p>
            {order.status} · {order.quantity} planned units
          </p>
        </div>
        <Link href={`/manufacturing/${id}`}>Manufacturing order</Link>
      </div>
      {!route &&
        can(actor.role, "manufacturing") &&
        ["Draft", "Planned"].includes(order.status) && (
          <ActionForm
            label="Bind latest product routing"
            action="bindRouting"
            id={id}
          />
        )}
      {!route && (
        <p>
          No routing is bound. Create a product routing, then bind it before
          production starts.
        </p>
      )}
      {progress.map((p) => (
        <section className="table-card" key={p.index}>
          <h2>
            {p.index + 1}. {p.name}
          </h2>
          <p>
            {p.status} · {p.minutes} standard min/unit · {p.allowed} applicable
            units · {p.completed} accepted · {p.rejected} rejected ·{" "}
            {p.remaining} remaining
          </p>
          <p className="muted">Estimated time: {(Number(p.minutes)*p.allowed).toFixed(2)} min · Recorded actual: {entries.filter(e=>e.sequence===p.index&&e.endedAt).reduce((n,e)=>n+(e.endedAt!.getTime()-e.startedAt.getTime())/60000,0).toFixed(2)} min (finished sessions)</p>
          {can(actor.role, "manufacturing") &&
            order.status === "In Progress" &&
            p.remaining > 0 &&
            (p.index === 0 || progress[p.index - 1].remaining === 0) && (
              <div className="actions">
                {!entries.some((e) => e.sequence === p.index && !e.endedAt) ? (
                  <ActionForm
                    label={`Start ${p.name}`}
                    action="startOperation"
                    id={id}
                    fields={[
                      {
                        name: "sequence",
                        label: "Operation number",
                        default: String(p.index),
                        required: true,
                      },
                      {
                        name: "employeeId",
                        label: "Assigned employee",
                        type: "select",
                        options: employees
                          .filter((e) => e.active)
                          .map((e) => ({ value: e.id, label: e.name })),
                        required: true,
                      },
                    ]}
                  />
                ) : (
                  <ActionForm
                    label={`Finish session · ${p.name}`}
                    action="finishOperation"
                    id={id}
                    fields={[
                      {
                        name: "sequence",
                        label: "Operation number",
                        default: String(p.index),
                        required: true,
                      },
                      {
                        name: "completed",
                        label: "Accepted quantity",
                        type: "number",
                        required: true,
                      },
                      {
                        name: "rejected",
                        label: "Rejected quantity",
                        type: "number",
                        required: true,
                      },
                      {
                        name: "notes",
                        label: "Session notes",
                        type: "textarea",
                      },
                    ]}
                  />
                )}
              </div>
            )}
        </section>
      ))}
      <h2>Labor sessions</h2>
      <DataTable
        rows={entries.map((e) => ({
          id: e.id,
          operation: route!.steps[e.sequence].name,
          employee: employees.find((p) => p.id === e.employeeId)?.name,
          start: e.startedAt.toISOString(),
          end: e.endedAt?.toISOString() ?? "Running",
          minutes: e.endedAt
            ? ((e.endedAt.getTime() - e.startedAt.getTime()) / 60000).toFixed(2)
            : "—",
          accepted: e.completed,
          rejected: e.rejected,
          notes: e.notes,
        }))}
        columns={[
          { key: "operation", label: "Operation" },
          { key: "employee", label: "Employee" },
          { key: "start", label: "Started (UTC)" },
          { key: "end", label: "Ended (UTC)" },
          { key: "minutes", label: "Actual minutes" },
          { key: "accepted", label: "Accepted" },
          { key: "rejected", label: "Rejected" },
          { key: "notes", label: "Notes" },
        ]}
      />
      <Link href="/production-operations">All operations and productivity</Link>
    </>
  );
}
