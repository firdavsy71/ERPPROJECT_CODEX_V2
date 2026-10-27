import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { outsourcingTerms } from "@/lib/outsourcing-fields";
import type { Field } from "@/lib/modules";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
export default async function OutsourcingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [o] = await db()
    .select()
    .from(s.outsourcingOrders)
    .where(eq(s.outsourcingOrders.id, id));
  if (!o) notFound();
  const [mo] = await db()
    .select()
    .from(s.manufacturing)
    .where(eq(s.manufacturing.id, o.manufacturingOrderId));
  const [spec] = await db()
    .select()
    .from(s.specifications)
    .where(eq(s.specifications.id, mo.specificationId!));
  const [
    profiles,
    suppliers,
    rs,
    rolls,
    custody,
    events,
    receipts,
    costs,
    materials,
    balances,
  ] = await Promise.all([
    db().select().from(s.subcontractors),
    db().select().from(s.suppliers),
    db().select().from(s.reservations).where(eq(s.reservations.orderId, mo.id)),
    db().select().from(s.fabricRolls),
    db()
      .select()
      .from(s.outsourcingCustody)
      .where(eq(s.outsourcingCustody.orderId, id)),
    db().select().from(s.outsourcingMaterialEvents),
    db()
      .select()
      .from(s.outsourcingReceipts)
      .where(eq(s.outsourcingReceipts.orderId, id)),
    db()
      .select()
      .from(s.outsourcingCosts)
      .where(eq(s.outsourcingCosts.orderId, id)),
    db().select().from(s.materials),
    db().select().from(s.balances),
  ]);
  const manager = can(actor.role, "manufacturing"),
    inventory = can(actor.role, "inventory");
  const label = (reservationId: string) => {
    const r = rs.find((r) => r.id === reservationId);
    const b = balances.find((b) => b.id === r?.balanceId);
    const m = materials.find((m) => m.id === b?.materialId);
    return `${m?.name ?? "Material"} (${m?.unit ?? ""})`;
  };
  const options = rs.map((r) => ({
    value: r.id,
    label: `${label(r.id)} · ${r.quantity} allocated`,
  }));
  const available = custody.filter((l) =>
    new Decimal(l.quantity).minus(l.consumed).minus(l.returned).gt(0),
  );
  const reference: Field = {
    name: "reference",
    label: "Document reference (include line number for material documents)",
    required: true,
  };
  const qc: Field[] = spec.document.qualityChecks.map((check, i) => ({
    name: `quality__${i}`,
    label: `QC: ${check}`,
    type: "select",
    options: [
      { value: "Pass", label: "Pass" },
      { value: "Fail", label: "Fail" },
    ],
    required: true,
  }));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{o.number}</h1>
          <p>
            {o.status} · {mo.quantity} assigned · {o.produced} reported produced
            · due {o.dueDate}
          </p>
          <p>
            {
              suppliers.find(
                (p) =>
                  p.id ===
                  profiles.find((p) => p.id === o.subcontractorId)?.supplierId,
              )?.name
            }{" "}
            · Agreed estimate{" "}
            {new Decimal(o.unitCost).mul(mo.quantity).toFixed(2)} {o.currency} ·
            Recorded costs{" "}
            {costs.reduce((n, c) => n.add(c.amount), new Decimal(0)).toFixed(2)}{" "}
            {o.currency}
          </p>
        </div>
        <Link href="/outsourcing">All outsourcing</Link>
      </div>
      <p>{o.notes}</p>
      <p>
        <Link href={`/manufacturing/${mo.id}`}>
          Assigned manufacturing order
        </Link>{" "}
        ·{" "}
        <Link href={`/specifications/${mo.specificationId}`}>
          Fixed specification and inspection criteria
        </Link>{" "}
        ·{" "}
        <Link href={`/subcontractors/${o.subcontractorId}`}>
          Workshop performance
        </Link>
      </p>
      {o.status === "Draft" && manager && (
        <div className="actions">
          <ActionForm
            label="Edit draft order"
            action="editOutsourcing"
            id={id}
            defaults={{
              manufacturingOrderId: mo.id,
              subcontractorId: o.subcontractorId,
              dueDate: o.dueDate,
              currency: o.currency,
              unitCost: o.unitCost,
              notes: o.notes,
            }}
            fields={[
              {
                name: "manufacturingOrderId",
                label: "Manufacturing assignment",
                type: "select",
                options: [{ value: mo.id, label: mo.number }],
                required: true,
              },
              {
                name: "subcontractorId",
                label: "Subcontractor",
                type: "select",
                options: profiles
                  .filter((p) => p.active || p.id === o.subcontractorId)
                  .map((p) => ({
                    value: p.id,
                    label:
                      suppliers.find((s) => s.id === p.supplierId)?.name ??
                      p.id,
                  })),
                required: true,
              },
              ...outsourcingTerms,
            ]}
          />
          <ActionForm
            label="Activate and reserve BOM materials"
            action="activateOutsourcing"
            id={id}
          />
          <ActionForm
            label="Cancel draft order"
            action="cancelOutsourcing"
            id={id}
          />
        </div>
      )}
      {o.status === "Active" && (
        <div className="actions">
          {manager && (
            <>
              <ActionForm
                label="Record cumulative production progress"
                action="outsourcingProgress"
                id={id}
                fields={[
                  {
                    name: "produced",
                    label: "Cumulative quantity produced",
                    type: "number",
                    default: String(o.produced),
                    required: true,
                  },
                ]}
              />
              <ActionForm
                label="Receive and inspect partial delivery"
                action="receiveOutsourcing"
                id={id}
                fields={[
                  reference,
                  {
                    name: "accepted",
                    label: "Accepted finished goods",
                    type: "number",
                    required: true,
                  },
                  {
                    name: "rejected",
                    label: "Rejected / defective goods",
                    type: "number",
                    required: true,
                  },
                  ...qc,
                  ...(mo.brandingVersionId
                    ? [
                        {
                          name: "brandingCheck",
                          label: "Matches fixed approved branding proof",
                          type: "select",
                          options: [
                            { value: "Pass", label: "Pass" },
                            { value: "Fail", label: "Fail" },
                          ],
                          required: true,
                        } as Field,
                      ]
                    : []),
                  {
                    name: "notes",
                    label: "Inspection findings / defect description",
                    type: "textarea",
                    required: true,
                  },
                ]}
              />
              <ActionForm
                label="Close reconciled order"
                action="closeOutsourcing"
                id={id}
              />
            </>
          )}
          {inventory && (
            <>
              <ActionForm
                label="Issue materials into subcontractor custody"
                action="issueOutsourcingMaterial"
                id={id}
                fields={[
                  {
                    name: "reservationId",
                    label: "Allocated material",
                    type: "select",
                    options,
                    required: true,
                  },
                  {
                    name: "rollId",
                    label: "Allocated roll (required for tracked fabric)",
                    type: "select",
                    options: rolls
                      .filter((r) =>
                        rs.some((v) => v.balanceId === r.balanceId),
                      )
                      .map((r) => ({
                        value: r.id,
                        label: `${r.rollNumber} · ${r.reservedLength} reserved · batch ${r.supplierBatch ?? "—"}`,
                      })),
                  },
                  {
                    name: "quantity",
                    label: "Quantity physically issued",
                    type: "number",
                    required: true,
                  },
                  reference,
                ]}
              />
              <ActionForm
                label="Record consumption or unused material return"
                action="settleOutsourcingMaterial"
                id={id}
                fields={[
                  {
                    name: "custodyId",
                    label: "Outstanding custody line",
                    type: "select",
                    options: available.map((l) => ({
                      value: l.id,
                      label: `${label(l.reservationId)} · ${l.reference} · ${new Decimal(l.quantity).minus(l.consumed).minus(l.returned)} outstanding`,
                    })),
                    required: true,
                  },
                  {
                    name: "kind",
                    label: "Document type",
                    type: "select",
                    options: [
                      {
                        value: "Consumed",
                        label: "Actual consumption confirmed by workshop",
                      },
                      {
                        value: "Returned",
                        label: "Unused material received back into warehouse",
                      },
                    ],
                    required: true,
                  },
                  {
                    name: "quantity",
                    label: "Quantity",
                    type: "number",
                    required: true,
                  },
                  reference,
                ]}
              />
            </>
          )}
        </div>
      )}
      {manager && ["Active", "Completed"].includes(o.status) && (
        <ActionForm
          label="Record outsourcing cost"
          action="recordOutsourcingCost"
          id={id}
          fields={[
            reference,
            {
              name: "amount",
              label: `Actual cost (${o.currency})`,
              type: "number",
              required: true,
            },
            {
              name: "notes",
              label: "Cost description",
              type: "textarea",
              required: true,
            },
          ]}
        />
      )}
      <h2>Materials in external custody</h2>
      <p className="muted">
        Issued material has left warehouse stock. Issued − documented
        consumption − unused returns = outstanding workshop custody. Returned
        tracked fabric receives a new linked roll identifier.
      </p>
      <DataTable
        rows={custody.map((l) => ({
          id: l.id,
          material: label(l.reservationId),
          reference: l.reference,
          roll:
            rolls.find((r) => r.id === l.rollId)?.rollNumber ??
            "Not roll tracked",
          issued: l.quantity,
          consumed: l.consumed,
          returned: l.returned,
          outstanding: new Decimal(l.quantity)
            .minus(l.consumed)
            .minus(l.returned)
            .toFixed(4),
          sections: l.segments.map((p) => `${p.start}–${p.end}`).join(", "),
        }))}
        columns={[
          { key: "material", label: "Material / unit" },
          { key: "reference", label: "Issue document" },
          { key: "roll", label: "Origin roll" },
          { key: "issued", label: "Issued" },
          { key: "consumed", label: "Consumed" },
          { key: "returned", label: "Returned" },
          { key: "outstanding", label: "Outstanding" },
          { key: "sections", label: "Issued roll sections (m)" },
        ]}
      />
      <h2>Custody settlement documents</h2>
      <DataTable
        rows={events
          .filter((e) => custody.some((l) => l.id === e.custodyId))
          .map((e) => ({
            id: e.id,
            reference: e.reference,
            kind: e.kind,
            quantity: e.quantity,
            returnRoll: rolls.find((r) => r.id === e.returnedRollId)
              ?.rollNumber,
            date: e.createdAt.toISOString(),
          }))}
        columns={[
          { key: "reference", label: "Reference" },
          { key: "kind", label: "Type" },
          { key: "quantity", label: "Quantity" },
          { key: "returnRoll", label: "Returned roll" },
          { key: "date", label: "Recorded (UTC)" },
        ]}
      />
      <h2>Inspected deliveries</h2>
      <DataTable
        rows={receipts.map((r) => ({
          id: r.id,
          reference: r.reference,
          accepted: r.accepted,
          rejected: r.rejected,
          qc: r.qualityResults.map((q) => `${q.check}: ${q.result}`).join("; "),
          branding: r.brandingCheck,
          notes: r.notes,
          date: r.createdAt.toISOString(),
        }))}
        columns={[
          { key: "reference", label: "Delivery reference" },
          { key: "accepted", label: "Accepted to inventory" },
          { key: "rejected", label: "Defective" },
          { key: "qc", label: "QC results" },
          { key: "branding", label: "Branding QC" },
          { key: "notes", label: "Inspection findings" },
          { key: "date", label: "Received (UTC)" },
        ]}
      />
      <h2>Actual cost documents ({o.currency})</h2>
      <DataTable
        rows={costs.map((c) => ({
          id: c.id,
          reference: c.reference,
          amount: c.amount,
          notes: c.notes,
        }))}
        columns={[
          { key: "reference", label: "Reference" },
          { key: "amount", label: `Amount (${o.currency})` },
          { key: "notes", label: "Description" },
        ]}
      />
    </>
  );
}
