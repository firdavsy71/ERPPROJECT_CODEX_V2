import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Decimal from "decimal.js";
import { z } from "zod";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import * as s from "@/db/schema";
import { inspectionTotals, receiptLineCost } from "@/services/procurement";
import { businessDate, formatTimestamp } from "@/i18n/format";
import { currentLocale } from "@/i18n/server";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";

export default async function SupplierPerformance({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; orderId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "purchases")) notFound();
  const filter = await searchParams;
  const supplierId = z.uuid().safeParse(filter.supplierId).success
    ? filter.supplierId
    : undefined;
  const orderId = z.uuid().safeParse(filter.orderId).success
    ? filter.orderId
    : undefined;
  const [
    suppliers,
    orders,
    receipts,
    lines,
    materials,
    inspections,
    incidents,
    expenses,
    allocations,
    rolls,
    settings,
    locale,
  ] = await Promise.all([
    db().select().from(s.suppliers),
    db().select().from(s.purchases),
    db().select().from(s.receipts),
    db().select().from(s.purchaseReceiptItems),
    db().select().from(s.materials),
    db().select().from(s.procurementInspections),
    db().select().from(s.supplierIncidents),
    db().select().from(s.procurementExpenses),
    db().select().from(s.procurementAllocations),
    db().select().from(s.fabricRolls),
    db().select().from(s.settings),
    currentLocale(),
  ]);
  const tz = settings[0]?.timezone ?? "Asia/Tashkent";
  const orderFor = (line: (typeof lines)[number]) =>
    orders.find(
      (o) => o.id === receipts.find((r) => r.id === line.receiptId)?.orderId,
    );
  const filtered = lines.filter(
    (l) =>
      (!supplierId || orderFor(l)?.supplierId === supplierId) &&
      (!orderId || orderFor(l)?.id === orderId),
  );
  const selectedReceipts = receipts.filter((r) =>
    filtered.some((l) => l.receiptId === r.id),
  );
  const supplierRows = suppliers
    .filter((sp) => !supplierId || sp.id === supplierId)
    .map((sp) => {
      const relevant = filtered.filter(
        (l) => orderFor(l)?.supplierId === sp.id,
      );
      const receiptIds = [...new Set(relevant.map((l) => l.receiptId))];
      const onTime = receiptIds.flatMap((id) => {
        const r = receipts.find((x) => x.id === id);
        const line = relevant.find((x) => x.receiptId === id);
        if (
          !r ||
          !line?.expectedDate ||
          !/^\d{4}-\d{2}-\d{2}$/.test(line.expectedDate)
        )
          return [];
        return [businessDate(r.createdAt, tz) <= line.expectedDate];
      });
      const lead = receiptIds.flatMap((id) => {
        const r = receipts.find((x) => x.id === id);
        const line = relevant.find((x) => x.receiptId === id);
        if (!r || !line?.orderedAt) return [];
        const start = businessDate(line.orderedAt, tz),
          end = businessDate(r.createdAt, tz);
        return [
          (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
            86400000,
        ];
      });
      const incidentsCount = incidents.filter(
        (i) =>
          i.supplierId === sp.id &&
          relevant.some((l) => l.id === i.receiptItemId),
      ).length;
      return {
        id: sp.id,
        Supplier: sp.name,
        Receipts: receiptIds.length,
        "On time": onTime.length
          ? `${onTime.filter(Boolean).length}/${onTime.length} (${((100 * onTime.filter(Boolean).length) / onTime.length).toFixed(1)}%)`
          : "Unknown",
        "Average lead days": lead.length
          ? (lead.reduce((a, b) => a + b, 0) / lead.length).toFixed(1)
          : "Unknown",
        Incidents: incidentsCount,
      };
    });
  const itemOptions = filtered.map((l) => ({
    value: l.id,
    label: `${orderFor(l)?.number} · ${materials.find((m) => m.id === l.materialId)?.name} · ${l.quantity} received · ${inspectionTotals(l, inspections).uninspected} uninspected`,
  }));
  const receiptOptions = selectedReceipts.map((r) => ({
    value: r.id,
    label: `${orders.find((o) => o.id === r.orderId)?.number} · ${formatTimestamp(r.createdAt, locale, tz)} · ${r.id.slice(0, 8)}`,
  }));
  const statusColumns = [
    "Supplier",
    "Receipts",
    "On time",
    "Average lead days",
    "Incidents",
  ].map((key) => ({ key, label: key }));
  const groups = new Map<string, typeof filtered>();
  for (const l of filtered) {
    const supplier = orderFor(l)?.supplierId;
    if (!supplier) continue;
    const key = `${supplier}:${l.materialId}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const qualityRows = [...groups.entries()].map(([key, group]) => {
    const first = group[0],
      supplier = orderFor(first)?.supplierId;
    const totals = group.map((l) => inspectionTotals(l, inspections));
    const sum = (field: "accepted" | "rejected" | "uninspected") =>
      totals.reduce((n, q) => n.add(q[field]), new Decimal(0));
    const accepted = sum("accepted"),
      rejected = sum("rejected"),
      inspected = accepted.add(rejected);
    return {
      id: key,
      Supplier: suppliers.find((x) => x.id === supplier)?.name ?? "",
      Material: materials.find((x) => x.id === first.materialId)?.name ?? "",
      Unit: materials.find((x) => x.id === first.materialId)?.unit ?? "",
      Accepted: accepted.toFixed(4),
      Rejected: rejected.toFixed(4),
      Uninspected: sum("uninspected").toFixed(4),
      "Acceptance rate": inspected.gt(0)
        ? accepted.div(inspected).mul(100).toFixed(1) + "%"
        : "Unknown",
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Supplier performance & landed costs</h1>
          <p>
            Metrics use recorded receipts and inspections; missing historical
            data remains unknown.
          </p>
        </div>
      </div>
      <p>
        Received goods enter stock immediately under the existing purchase
        workflow. Inspect them promptly; rejected quantities are removed from
        available stock, or blocked if already reserved or consumed.
        Roll-tracked rejections require the actual received roll.
      </p>
      <p>
        Each expense is allocated to receipt lines in proportion to received
        supplier value, in the purchase currency. Amounts are rounded
        cumulatively to cents; gross landed cost includes all received
        quantities, even rejected goods, and does not update stock valuation or
        supplier prices.
      </p>
      {(supplierId || orderId) && (
        <p>
          <Link href="/supplier-performance">All suppliers and purchases</Link>
        </p>
      )}
      <div className="actions">
        <ActionForm
          label="Inspect received material"
          action="inspectProcurement"
          fields={[
            {
              name: "receiptItemId",
              label: "Receipt line",
              type: "select",
              required: true,
              options: itemOptions,
            },
            {
              name: "accepted",
              label: "Accepted quantity",
              type: "number",
              required: true,
              default: "0",
            },
            {
              name: "rejected",
              label: "Rejected quantity",
              type: "number",
              required: true,
              default: "0",
            },
            {
              name: "rollId",
              label: "Received fabric roll for rejection (when tracked)",
              type: "select",
              options: rolls.map((r) => ({
                value: r.id,
                label: `${r.rollNumber} · ${r.remainingLength} remaining`,
              })),
            },
            {
              name: "notes",
              label: "Inspection findings",
              type: "textarea",
              required: true,
            },
          ]}
        />
        <ActionForm
          label="Record supplier quality incident"
          action="recordSupplierIncident"
          fields={[
            {
              name: "receiptItemId",
              label: "Receipt line",
              type: "select",
              required: true,
              options: itemOptions,
            },
            {
              name: "description",
              label: "Incident description",
              type: "textarea",
              required: true,
            },
          ]}
        />
        {can(actor.role, "procurement.cost") && (
          <ActionForm
            label="Record procurement expense"
            action="recordProcurementExpense"
            fields={[
              {
                name: "receiptId",
                label: "Receipt",
                type: "select",
                required: true,
                options: receiptOptions,
              },
              {
                name: "kind",
                label: "Expense type",
                type: "select",
                required: true,
                options: ["Freight", "Customs", "Handling", "Other"].map(
                  (x) => ({ value: x, label: x }),
                ),
              },
              {
                name: "reference",
                label: "Unique expense document reference",
                required: true,
              },
              {
                name: "amount",
                label: "Amount in purchase currency",
                type: "number",
                required: true,
              },
              {
                name: "notes",
                label: "Expense details",
                type: "textarea",
                required: true,
              },
            ]}
          />
        )}
      </div>
      <h2>Supplier performance</h2>
      <DataTable href="suppliers" columns={statusColumns} rows={supplierRows} />
      <h2>Inspection quality by supplier and material</h2>
      <DataTable
        columns={[
          "Supplier",
          "Material",
          "Unit",
          "Accepted",
          "Rejected",
          "Uninspected",
          "Acceptance rate",
        ].map((key) => ({ key, label: key }))}
        rows={qualityRows}
      />
      <h2>Received materials, price comparison and landed cost</h2>
      <DataTable
        columns={[
          "Purchase",
          "Supplier",
          "Material",
          "Received",
          "Accepted",
          "Rejected",
          "Uninspected",
          "Supplier unit price",
          "Currency",
          "Base cost",
          "Additional expenses",
          "Landed cost",
          "Landed per unit",
          "Price provenance",
        ].map((key) => ({ key, label: key }))}
        rows={filtered.map((l) => {
          const p = orderFor(l),
            q = inspectionTotals(l, inspections),
            cost = receiptLineCost(l, allocations);
          return {
            id: l.id,
            Purchase: p?.number ?? "",
            Supplier: suppliers.find((x) => x.id === p?.supplierId)?.name ?? "",
            Material: materials.find((x) => x.id === l.materialId)?.name ?? "",
            Received: l.quantity,
            Accepted: q.accepted,
            Rejected: q.rejected,
            Uninspected: q.uninspected,
            "Supplier unit price": l.unitPrice ?? "Unknown",
            Currency: l.currency,
            "Base cost": cost?.base ?? "Unknown",
            "Additional expenses": cost?.expenses ?? "Unknown",
            "Landed cost": cost?.landed ?? "Unknown",
            "Landed per unit": cost?.landedPerUnit ?? "Unknown",
            "Price provenance": l.provenance,
          };
        })}
      />
      <h2>Receipt and inspection history</h2>
    <ul>{selectedReceipts.map(r=><li key={r.id}><Link href={`/documents/material-receipt/${r.id}`}>Material receipt {r.id} / PDF</Link></li>)}</ul>
      <DataTable
        columns={[
          "Purchase",
          "Receipt",
          "Received at",
          "Inspection",
          "Accepted",
          "Rejected",
          "Findings",
        ].map((key) => ({ key, label: key }))}
        rows={filtered.flatMap((l) => {
          const checks = inspections.filter((i) => i.receiptItemId === l.id);
          const r = receipts.find((x) => x.id === l.receiptId);
          return checks.length
            ? checks.map((i) => ({
                id: i.id,
                Purchase: orderFor(l)?.number ?? "",
                Receipt: l.receiptId.slice(0, 8),
                "Received at": r
                  ? formatTimestamp(r.createdAt, locale, tz)
                  : "",
                Inspection: formatTimestamp(i.createdAt, locale, tz),
                Accepted: i.accepted,
                Rejected: i.rejected,
                Findings: i.notes,
              }))
            : [
                {
                  id: l.id,
                  Purchase: orderFor(l)?.number ?? "",
                  Receipt: l.receiptId.slice(0, 8),
                  "Received at": r
                    ? formatTimestamp(r.createdAt, locale, tz)
                    : "",
                  Inspection: "Not inspected",
                  Accepted: "",
                  Rejected: "",
                  Findings: "",
                },
              ];
        })}
      />
      <h2>Additional expense history</h2>
      <DataTable
        columns={[
          "Purchase",
          "Type",
          "Reference",
          "Amount",
          "Currency",
          "Details",
        ].map((key) => ({ key, label: key }))}
        rows={expenses
          .filter((e) => selectedReceipts.some((r) => r.id === e.receiptId))
          .map((e) => ({
            id: e.id,
            Purchase:
              orders.find(
                (o) =>
                  o.id === receipts.find((r) => r.id === e.receiptId)?.orderId,
              )?.number ?? "",
            Type: e.kind,
            Reference: e.reference,
            Amount: e.amount,
            Currency: e.currency,
            Details: e.notes,
          }))}
      />
      <h2>Quality incidents</h2>
      <DataTable
        columns={["Supplier", "Purchase", "Description", "Recorded"].map(
          (key) => ({ key, label: key }),
        )}
        rows={incidents
          .filter((i) => filtered.some((l) => l.id === i.receiptItemId))
          .map((i) => ({
            id: i.id,
            Supplier: suppliers.find((s) => s.id === i.supplierId)?.name ?? "",
            Purchase:
              orderFor(lines.find((l) => l.id === i.receiptItemId)!)?.number ??
              "",
            Description: i.description,
            Recorded: formatTimestamp(i.createdAt, locale, tz),
          }))}
      />
    </>
  );
}
