import { redirect, notFound } from "next/navigation";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { repairActivities } from "@/services/repairs";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";

export default async function Repairs() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "repairs.read")) notFound();
  const [orders, customers, variants, employees] = await Promise.all([
    db().select().from(s.repairOrders),
    db().select().from(s.customers),
    db().select().from(s.variants),
    db().select().from(s.employees),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Alterations & repairs</h1>
          <p>
            Customer-owned garments remain separate from sellable inventory.
          </p>
        </div>
      </div>
      {can(actor.role, "repairs.create") && (
        <ActionForm
          label="Receive repair request"
          action="createRepair"
          fields={[
            {
              name: "customerId",
              label: "Customer",
              type: "select",
              required: true,
              options: customers
                .filter((c) => c.active)
                .map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "variantId",
              label: "Original product variant (optional)",
              type: "select",
              options: variants.map((v) => ({
                value: v.id,
                label: `${v.sku} · ${v.size} · ${v.color}`,
              })),
            },
            {
              name: "productDescription",
              label: "Original garment identification / condition",
              required: true,
              type: "textarea",
            },
            {
              name: "activity",
              label: "Requested activity",
              type: "select",
              required: true,
              options: repairActivities.map((v) => ({ value: v, label: v })),
            },
            {
              name: "instructions",
              label: "Requested adjustments / customer instructions",
              type: "textarea",
              required: true,
            },
            {
              name: "employeeId",
              label: "Assigned employee (optional)",
              type: "select",
              options: employees
                .filter((e) => e.active)
                .map((e) => ({ value: e.id, label: e.name })),
            },
            {
              name: "estimatedDate",
              label: "Estimated completion date",
              type: "date",
            },
            {
              name: "cost",
              label: "Repair cost",
              type: "number",
              required: true,
              default: "0",
            },
            {
              name: "currency",
              label: "Currency",
              required: true,
              default: "UZS",
            },
          ]}
        />
      )}
      <DataTable
        href="repairs"
        columns={[
          "Number",
          "Customer",
          "Garment",
          "Activity",
          "Employee",
          "Status",
          "Estimate",
          "Cost",
        ].map((key) => ({ key, label: key }))}
        rows={orders.map((r) => ({
          id: r.id,
          Number: r.number,
          Customer: customers.find((c) => c.id === r.customerId)?.name ?? "",
          Garment: r.productDescription,
          Activity: r.activity,
          Employee:
            employees.find((e) => e.id === r.employeeId)?.name ?? "Unassigned",
          Status: r.status,
          Estimate: r.estimatedDate ?? "",
          Cost: `${r.cost} ${r.currency}`,
        }))}
      />
    </>
  );
}
