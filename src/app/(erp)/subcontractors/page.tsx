import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { profileFields } from "@/lib/outsourcing-fields";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function SubcontractorsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "manufacturing") && !can(actor.role, "suppliers"))
    notFound();
  const [profiles, suppliers] = await Promise.all([
    db().select().from(s.subcontractors),
    db().select().from(s.suppliers),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Subcontractors</h1>
          <p className="muted">
            External workshop capabilities, linked to the existing supplier
            directory.
          </p>
        </div>
      </div>
      {can(actor.role, "suppliers") && (
        <ActionForm
          label="New subcontractor profile"
          action="saveSubcontractor"
          fields={[
            {
              name: "supplierId",
              label: "Supplier",
              type: "select",
              options: suppliers
                .filter(
                  (p) =>
                    p.active && !profiles.some((c) => c.supplierId === p.id),
                )
                .map((p) => ({ value: p.id, label: p.name })),
              required: true,
            },
            ...profileFields,
          ]}
        />
      )}
      <DataTable
        href="subcontractors"
        rows={profiles.map((p) => ({
          id: p.id,
          name: suppliers.find((v) => v.id === p.supplierId)?.name,
          specialties: p.specialties,
          capacity: p.capacity,
          status: p.active ? "Active" : "Archived",
        }))}
        columns={[
          { key: "name", label: "Workshop" },
          { key: "specialties", label: "Specialties" },
          { key: "capacity", label: "Monthly capacity" },
          { key: "status", label: "Status" },
        ]}
      />
    </>
  );
}
