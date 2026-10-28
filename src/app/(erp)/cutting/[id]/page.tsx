import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentActor } from "@/auth";
import { can } from "@/lib/permissions";
import { ActionForm } from "@/components/forms";
export default async function CuttingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "manufacturing")) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [b] = await db()
    .select()
    .from(s.cuttingBatches)
    .where(eq(s.cuttingBatches.id, id));
  if (!b) notFound();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cutting batch · {b.size}</h1>
          <p>
            {b.status} · {b.quantity} garment sets · {b.planned} m planned ·{" "}
            {b.rateSource}
          </p>
        </div>
        <Link href="/cutting">Cutting room</Link>
      </div>
      <p style={{ whiteSpace: "pre-wrap" }}>{b.layout}</p>
      <p>
        <Link href={`/manufacturing/${b.orderId}`}>Manufacturing order</Link> ·{" "}
        <Link href={`/fabric-rolls/${b.rollId}`}>Roll and supplier batch</Link>{" "}
        ·{" "}
        <Link href={`/specifications/${b.specificationId}`}>
          Fixed specification
        </Link>
      </p>
      {b.result && (
        <dl>
          {Object.entries(b.result).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {Array.isArray(value)
                  ? value
                      .map(
                        (p) =>
                          `${p.part}: ${p.quantity} cut, ${p.rejected} rejected`,
                      )
                      .join("; ")
                  : (value ?? "—")}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {b.status === "Planned" && can(actor.role, "manufacturing") && (
        <div className="actions">
          <ActionForm
            label="Record completed cutting"
            action="completeCutting"
            id={b.id}
            lines={{
              name: "cutPieces",
              label: "Cut-piece quantities",
              fields: [
                {
                  name: "part",
                  label: "Pattern part (for example sleeve)",
                  required: true,
                },
                {
                  name: "quantity",
                  label: "Pieces cut",
                  type: "number",
                  required: true,
                },
                {
                  name: "rejected",
                  label: "Rejected pieces",
                  type: "number",
                  required: true,
                },
              ],
            }}
            fields={[
              {
                name: "issued",
                label: "Fabric issued (m)",
                type: "number",
                required: true,
              },
              {
                name: "incorporated",
                label: "Fabric incorporated in cut pieces (m)",
                type: "number",
                required: true,
              },
              {
                name: "waste",
                label: "Waste (m)",
                type: "number",
                required: true,
              },
              {
                name: "returned",
                label: "Remaining usable fabric returned (m)",
                type: "number",
                required: true,
              },
              {
                name: "piecesCut",
                label: "Garment sets cut (including rejected)",
                type: "number",
                required: true,
              },
              {
                name: "rejectedPieces",
                label: "Rejected garment sets",
                type: "number",
                required: true,
              },
            ]}
          />
          <ActionForm
            label="Cancel cutting batch"
            action="cancelCutting"
            id={b.id}
          />
        </div>
      )}
    </>
  );
}
