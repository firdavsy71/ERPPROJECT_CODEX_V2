import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentActor } from "@/auth";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can } from "@/lib/permissions";
import { invoiceReturnPosition } from "@/services/returns";
import { ActionForm } from "@/components/forms";
import { DataTable } from "@/components/data-table";
import type { Field } from "@/lib/modules";
export default async function ReturnDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "returns.read")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [rma] = await db()
    .select()
    .from(s.returnOrders)
    .where(eq(s.returnOrders.id, id));
  if (!rma) notFound();
  const [
    items,
    allReceipts,
    allInspections,
    allDispositions,
    allSettlements,
    credits,
    refunds,
    events,
    variants,
  ] = await Promise.all([
    db().select().from(s.returnItems).where(eq(s.returnItems.returnId, id)),
    db().select().from(s.returnReceipts),
    db().select().from(s.returnInspections),
    db().select().from(s.returnQuarantineDispositions),
    db().select().from(s.returnSettlements),
    db()
      .select()
      .from(s.returnCreditNotes)
      .where(eq(s.returnCreditNotes.invoiceId, rma.invoiceId)),
    db()
      .select()
      .from(s.returnRefunds)
      .where(eq(s.returnRefunds.invoiceId, rma.invoiceId)),
    db()
      .select()
      .from(s.returnEvents)
      .where(eq(s.returnEvents.returnId, id))
      .orderBy(s.returnEvents.createdAt),
    db().select().from(s.variants),
  ]);
  const receipts = allReceipts.filter((r) =>
      items.some((l) => l.id === r.returnItemId),
    ),
    inspections = allInspections.filter((i) =>
      receipts.some((r) => r.id === i.receiptId),
    ),
    dispositions = allDispositions.filter((d) =>
      inspections.some((i) => i.id === d.inspectionId),
    ),
    settlements = allSettlements.filter((q) =>
      items.some((l) => l.id === q.returnItemId),
    );
  const [position] = await db().transaction(async (tx) => [
    await invoiceReturnPosition(tx, rma.invoiceId),
  ]);
  const [invoice] = await db()
    .select()
    .from(s.invoices)
    .where(eq(s.invoices.id, rma.invoiceId));
  const [sale] = await db()
    .select()
    .from(s.sales)
    .where(eq(s.sales.id, rma.orderId));
  const note: Field = {
    name: "notes",
    label: "Decision / evidence notes",
    type: "textarea",
    required: true,
  };
  const itemOptions = items.map((l) => ({
    value: l.id,
    label: `${l.productSnapshot} · ${l.quantity} authorized`,
  }));
  const settlementOptions = (statuses: string[]) =>
    settlements
      .filter((q) => statuses.includes(q.status))
      .map((q) => ({
        value: q.id,
        label: `${q.kind} · ${items.find((l) => l.id === q.returnItemId)?.productSnapshot} · ${q.quantity} units · estimated ${q.amount} ${sale.currency}`,
      }));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{rma.number}</h1>
          <p>
            {rma.status} · Intake {rma.intakeClosed ? "closed" : "open"}
          </p>
          <p>{rma.notes}</p>
        </div>
        <Link href="/returns">All returns</Link>
      </div>
      <p>
        <Link href={`/sales/${rma.orderId}`}>Original sale {sale.number}</Link>{" "}
        ·{" "}
        <Link href={`/invoices/${rma.invoiceId}`}>
          Original invoice {invoice.number}
        </Link>
        {can(actor.role, "shipping.read") && (
          <> · <Link href={`/deliveries?orderId=${rma.orderId}`}>
            Original shipping history
          </Link></>
        )}
      </p>
      <p>
        Invoice credits {position.credited} · Refunds recorded{" "}
        {position.refunded} · Due {position.due} · Customer credit balance{" "}
        {position.creditBalance} {sale.currency}
      </p>
      <div className="actions">
        {can(actor.role, "returns.sales") && rma.status === "Requested" && (
          <>
            <ActionForm
              label="Approve return authorization"
              action="approveReturn"
              id={id}
              fields={[note]}
            />
            <ActionForm
              label="Reject return request"
              action="rejectReturn"
              id={id}
              fields={[note]}
            />
          </>
        )}
        {can(actor.role, "returns.sales") &&
          ["Requested", "Approved"].includes(rma.status) && (
            <ActionForm
              label="Cancel unreceived return"
              action="cancelReturn"
              id={id}
              fields={[note]}
            />
          )}{" "}
        {can(actor.role, "returns.receive") &&
          ["Approved", "Receiving"].includes(rma.status) &&
          !rma.intakeClosed && (
            <ActionForm
              label="Receive returned goods into inspection holding"
              action="receiveReturn"
              id={id}
              fields={[
                {
                  name: "returnItemId",
                  label: "Authorized return line",
                  type: "select",
                  options: itemOptions,
                  required: true,
                },
                {
                  name: "quantity",
                  label: "Quantity physically received",
                  type: "number",
                  required: true,
                },
                {
                  name: "actualVariantId",
                  label:
                    "Observed product / size / color (blank = original SKU)",
                  type: "select",
                  options: variants.map((v) => ({
                    value: v.id,
                    label: `${v.sku} · ${v.size} / ${v.color}`,
                  })),
                },
                {
                  name: "reference",
                  label: "Return receipt reference",
                  required: true,
                },
                note,
              ]}
            />
          )}{" "}
        {can(actor.role, "returns.inspect") &&
          receipts.some(
            (r) => !inspections.some((i) => i.receiptId === r.id),
          ) && (
            <ActionForm
              label="Inspect received goods"
              action="inspectReturn"
              id={id}
              fields={[
                {
                  name: "receiptId",
                  label: "Uninspected receipt",
                  type: "select",
                  options: receipts
                    .filter(
                      (r) => !inspections.some((i) => i.receiptId === r.id),
                    )
                    .map((r) => ({
                      value: r.id,
                      label: `${r.reference} · ${r.actualProductSnapshot} · ${r.quantity} units`,
                    })),
                  required: true,
                },
                {
                  name: "condition",
                  label: "Condition of sellable portion / overall findings",
                  type: "select",
                  options: [
                    "Unworn / sellable",
                    "Damaged",
                    "Manufacturing defect",
                    "Used / needs review",
                  ].map((v) => ({ value: v, label: v })),
                  required: true,
                },
                {
                  name: "sellable",
                  label: "Sellable units to restock",
                  type: "number",
                  required: true,
                },
                {
                  name: "quarantined",
                  label: "Defective / non-sellable units to quarantine",
                  type: "number",
                  required: true,
                },
                note,
              ]}
            />
          )}{" "}
        {can(actor.role, "returns.sales") && rma.status === "Receiving" && (
          <ActionForm
            label="Close short / partial return intake"
            action="closeReturnIntake"
            id={id}
            fields={[note]}
          />
        )}
      </div>
      <h2>Authorized, received and inspected quantities</h2>
      <DataTable
        rows={items.map((l) => {
          const received = receipts.filter((r) => r.returnItemId === l.id),
            checked = inspections.filter((i) =>
              received.some((r) => r.id === i.receiptId),
            );
          return {
            id: l.id,
            product: l.productSnapshot,
            reason: l.reason,
            authorized: l.quantity,
            received: received.reduce((q, r) => q + r.quantity, 0),
            sellable: checked.reduce((q, i) => q + i.sellable, 0),
            quarantine: checked.reduce(
              (q, i) =>
                q +
                i.quarantined -
                dispositions
                  .filter((d) => d.inspectionId === i.id)
                  .reduce((n, d) => n + d.quantity, 0),
              0,
            ),
            pending:
              received.reduce((q, r) => q + r.quantity, 0) -
              checked.reduce((q, i) => q + i.sellable + i.quarantined, 0),
          };
        })}
        columns={[
          { key: "product", label: "Product / size / color" },
          { key: "reason", label: "Reason" },
          { key: "authorized", label: "Authorized" },
          { key: "received", label: "Received" },
          { key: "pending", label: "Pending inspection" },
          { key: "sellable", label: "Restocked at inspection" },
          { key: "quarantine", label: "Current quarantine" },
        ]}
      />
      <h2>Quarantine reinspection / disposition</h2>
      {can(actor.role, "returns.inspect") &&
        inspections.some(
          (i) =>
            i.quarantined >
            dispositions
              .filter((d) => d.inspectionId === i.id)
              .reduce((q, d) => q + d.quantity, 0),
        ) && (
          <ActionForm
            label="Record quarantine disposition"
            action="dispositionReturnQuarantine"
            id={id}
            fields={[
              {
                name: "inspectionId",
                label: "Quarantined inspection lot",
                type: "select",
                options: inspections
                  .filter(
                    (i) =>
                      i.quarantined >
                      dispositions
                        .filter((d) => d.inspectionId === i.id)
                        .reduce((q, d) => q + d.quantity, 0),
                  )
                  .map((i) => ({
                    value: i.id,
                    label: `${receipts.find((r) => r.id === i.receiptId)?.reference} · ${i.quarantined - dispositions.filter((d) => d.inspectionId === i.id).reduce((q, d) => q + d.quantity, 0)} quarantined`,
                  })),
                required: true,
              },
              {
                name: "kind",
                label: "Quality disposition",
                type: "select",
                options: [
                  { value: "Restock", label: "Passed reinspection: restock" },
                  {
                    value: "Scrap",
                    label: "Confirmed physical disposal: scrap",
                  },
                ],
                required: true,
              },
              {
                name: "quantity",
                label: "Disposition quantity",
                type: "number",
                required: true,
              },
              {
                name: "reference",
                label: "Reinspection / disposal document",
                required: true,
              },
              note,
            ]}
          />
        )}
      <h2>Commercial resolution</h2>
      <p className="muted">
        Only inspected units can receive one commercial resolution. Credit
        amounts prorate the original invoice (including discounts, branding and
        tax); the final rounding allocation is fixed when issued.
        Exchanges/replacements create an approved no-charge product order for
        normal reservation and shipping. Source branding requires new branding
        approval.
      </p>
      {can(actor.role, "returns.sales") &&
        ["Receiving", "Inspected"].includes(rma.status) && (
          <ActionForm
            label="Request credit / refund / exchange / replacement"
            action="requestReturnSettlement"
            id={id}
            fields={[
              {
                name: "returnItemId",
                label: "Inspected return line",
                type: "select",
                options: itemOptions,
                required: true,
              },
              {
                name: "kind",
                label: "Requested commercial resolution",
                type: "select",
                options: ["Credit", "Refund", "Exchange", "Replacement"].map(
                  (v) => ({ value: v, label: v }),
                ),
                required: true,
              },
              {
                name: "quantity",
                label: "Resolution quantity",
                type: "number",
                required: true,
              },
              {
                name: "replacementVariantId",
                label: "Target variant (Exchange / Replacement only)",
                type: "select",
                options: variants.map((v) => ({
                  value: v.id,
                  label: `${v.sku} · ${v.size} / ${v.color}`,
                })),
              },
              note,
            ]}
          />
        )}
      {can(actor.role, "returns.finance") && (
        <div className="actions">
          {settlements.some((q) => q.status === "Requested") && (
            <ActionForm
              label="Approve commercial request"
              action="approveReturnSettlement"
              id={id}
              fields={[
                {
                  name: "settlementId",
                  label: "Pending commercial request",
                  type: "select",
                  options: settlementOptions(["Requested"]),
                  required: true,
                },
                note,
              ]}
            />
          )}
          {settlements.some((q) =>
            ["Requested", "Approved"].includes(q.status),
          ) && (
            <ActionForm
              label="Reject pending commercial request"
              action="rejectReturnSettlement"
              id={id}
              fields={[
                {
                  name: "settlementId",
                  label: "Commercial request",
                  type: "select",
                  options: settlementOptions(["Requested", "Approved"]),
                  required: true,
                },
                note,
              ]}
            />
          )}
          {settlements.some((q) => q.status === "Approved") && (
            <ActionForm
              label="Process approved commercial resolution"
              action="processReturnSettlement"
              id={id}
              fields={[
                {
                  name: "settlementId",
                  label: "Approved request",
                  type: "select",
                  options: settlementOptions(["Approved"]),
                  required: true,
                },
                {
                  name: "reference",
                  label:
                    "Externally paid refund reference (required for Refund)",
                },
                note,
              ]}
            />
          )}
          {Number(position.creditBalance) > 0 && (
            <ActionForm
              label="Record externally paid credit-balance refund"
              action="recordReturnRefund"
              id={id}
              fields={[
                {
                  name: "amount",
                  label: `Paid refund amount (${sale.currency})`,
                  type: "number",
                  required: true,
                },
                {
                  name: "reference",
                  label: "Unique bank / cash refund reference",
                  required: true,
                },
                note,
              ]}
            />
          )}
        </div>
      )}
      <DataTable
        rows={settlements.map((q) => ({
          id: q.id,
          kind: q.kind,
          quantity: q.quantity,
          status: q.status,
          amount: q.amount,
          target: variants.find((v) => v.id === q.replacementVariantId)?.sku,
          notes: q.notes,
        }))}
        columns={[
          { key: "kind", label: "Resolution" },
          { key: "quantity", label: "Units" },
          { key: "status", label: "Status" },
          {
            key: "amount",
            label: `Credit estimate / issued amount (${sale.currency})`,
          },
          { key: "target", label: "Exchange variant" },
          { key: "notes", label: "Request notes" },
        ]}
      />
      {settlements
        .filter((q) => q.replacementOrderId)
        .map((q) => (
          <p key={q.id}>
            <Link href={`/sales/${q.replacementOrderId}`}>
              Replacement / exchange sales order · {q.quantity} units
            </Link>
            {can(actor.role, "shipping.read") && (
              <>
                {" "}
                ·{" "}
                <Link href={`/deliveries?orderId=${q.replacementOrderId}`}>
                  Replacement picking and shipments
                </Link>
              </>
            )}
          </p>
        ))}
      <h2>Issued credit notes</h2>
      <DataTable
        rows={credits.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
        }))}
        columns={[
          { key: "number", label: "Credit note" },
          { key: "quantity", label: "Units" },
          { key: "amount", label: `Gross credit (${sale.currency})` },
          { key: "createdAt", label: "Issued (UTC)" },
        ]}
      />
      <h2>Confirmed external refunds</h2>
      <DataTable
        rows={refunds.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
        }))}
        columns={[
          { key: "reference", label: "Bank / cash reference" },
          { key: "amount", label: `Amount (${sale.currency})` },
          { key: "notes", label: "Evidence notes" },
        ]}
      />
      <h2>Return receipt history</h2>
      <DataTable
        rows={receipts.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
        columns={[
          { key: "reference", label: "Receipt reference" },
          {
            key: "actualProductSnapshot",
            label: "Physically returned product / size / color",
          },
          { key: "quantity", label: "Received units" },
          { key: "notes", label: "Receipt notes" },
          { key: "createdAt", label: "Received (UTC)" },
        ]}
      />
      <h2>Inspection history</h2>
      <DataTable
        rows={inspections.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))}
        columns={[
          { key: "condition", label: "Condition" },
          { key: "sellable", label: "Restocked" },
          { key: "quarantined", label: "Quarantined" },
          { key: "notes", label: "Inspection findings" },
        ]}
      />
      <h2>Audit history</h2>
      <DataTable
        rows={events.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
        }))}
        columns={[
          { key: "action", label: "Action" },
          { key: "notes", label: "Recorded notes" },
          { key: "createdAt", label: "Recorded (UTC)" },
        ]}
      />
    </>
  );
}
