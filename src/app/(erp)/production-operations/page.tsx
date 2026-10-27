import Link from "next/link";
import { redirect } from "next/navigation";
import Decimal from "decimal.js";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import { operationNames } from "@/services/labor";
export default async function OperationsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const [products, routes, orders, fixed, entries, employees] =
    await Promise.all([
      db().select().from(s.products),
      db().select().from(s.productionRoutings),
      db().select().from(s.manufacturing),
      db().select().from(s.orderRoutings),
      db().select().from(s.laborEntries),
      db().select().from(s.employees),
    ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Operations & labor</h1>
          <p className="muted">
            Versioned product routing and employee production sessions. Standard
            times are minutes per accepted unit; actual time is elapsed session
            time.
          </p>
        </div>
      </div>
      {can(actor.role, "manufacturing") && (
        <ActionForm
          label="New routing version"
          action="saveRouting"
          fields={[
            {
              name: "productId",
              label: "Product",
              type: "select",
              options: products
                .filter((p) => p.active)
                .map((p) => ({ value: p.id, label: p.name })),
              required: true,
            },
          ]}
          lines={{
            name: "steps",
            label: "Operations in execution order",
            fields: [
              {
                name: "name",
                label: "Operation",
                type: "select",
                options: operationNames.map((name) => ({
                  value: name,
                  label: name,
                })),
                required: true,
              },
              {
                name: "minutes",
                label: "Standard minutes per unit",
                type: "number",
                required: true,
              },
            ],
          }}
        />
      )}
      <h2>Manufacturing routing</h2>
      <DataTable
        href="production-operations"
        rows={orders.map((o) => ({
          id: o.id,
          order: o.number,
          quantity: o.quantity,
          status: o.status,
          routing:
            routes.find(
              (r) => r.id === fixed.find((f) => f.orderId === o.id)?.routingId,
            )?.version ?? "Not bound",
        }))}
        columns={[
          { key: "order", label: "Manufacturing order" },
          { key: "quantity", label: "Planned units" },
          { key: "status", label: "Status" },
          { key: "routing", label: "Fixed routing version" },
        ]}
      />
      <h2>Employee productivity</h2>
      <DataTable
        rows={employees.map((employee) => {
          const logs = entries.filter(
            (e) => e.employeeId === employee.id && e.endedAt,
          );
          const actual = logs.reduce(
            (n, e) =>
              n.add(
                new Decimal(e.endedAt!.getTime() - e.startedAt.getTime()).div(
                  60000,
                ),
              ),
            new Decimal(0),
          );
          const earned = logs.reduce(
            (n, e) =>
              n.add(
                new Decimal(
                  fixed.find((f) => f.id === e.orderRoutingId)!.steps[
                    e.sequence
                  ].minutes,
                ).mul(e.completed),
              ),
            new Decimal(0),
          );
          const accepted = logs.reduce((n, e) => n + e.completed, 0);
          return {
            id: employee.id,
            employee: employee.name,
            sessions: logs.length,
            accepted,
            rejected: logs.reduce((n, e) => n + e.rejected, 0),
            actual: actual.toFixed(2),
            standard: earned.toFixed(2),
            variance: actual.minus(earned).toFixed(2),
            efficiency: actual.gt(0)
              ? earned.div(actual).mul(100).toFixed(2)
              : "—",
            perHour: actual.gt(0)
              ? new Decimal(accepted).mul(60).div(actual).toFixed(2)
              : "—",
          };
        })}
        columns={[
          { key: "employee", label: "Employee" },
          { key: "sessions", label: "Finished sessions" },
          { key: "accepted", label: "Accepted operation units" },
          { key: "rejected", label: "Rejected units" },
          { key: "standard", label: "Earned standard min" },
          { key: "actual", label: "Actual min" },
          { key: "variance", label: "Actual − standard min" },
          { key: "efficiency", label: "Efficiency %" },
          { key: "perHour", label: "Accepted units/hour" },
        ]}
      />
      <p className="muted">
        Operation units are counted at each step, not unique finished garments.
        Reports include finished sessions only.
      </p>
      <h2>Routing history</h2>
      {routes.map((r) => (
        <p key={r.id}>
          {products.find((p) => p.id === r.productId)?.name} · v{r.version} ·{" "}
          {r.steps
            .map((step) => `${step.name} (${step.minutes} min)`)
            .join(" → ")}
        </p>
      ))}
      <Link href="/manufacturing">Manufacturing</Link>
    </>
  );
}
