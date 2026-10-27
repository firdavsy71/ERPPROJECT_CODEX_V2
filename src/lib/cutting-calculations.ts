import Decimal from "decimal.js";
import { z } from "zod";

const decimal = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);
const positive = decimal.refine((value) => new Decimal(value).gt(0));
const units = z.number().int().positive().max(1_000_000);

/** A rate must already be resolved against the approved BOM and specification. */
const planLine = z.object({
  manufacturingOrderId: z.uuid(),
  variantId: z.uuid(),
  size: z.string().trim().min(1).max(100),
  materialId: z.uuid(),
  quantity: units,
  consumptionPerUnit: positive,
});

/** Exact decimal planning across independently approved size/variant lines. */
export function calculateCuttingPlan(input: unknown) {
  const lines = z.array(planLine).min(1).max(1000).parse(input);
  const keys = lines.map(
    (line) => `${line.manufacturingOrderId}:${line.materialId}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error(
      "Each manufacturing order and material must appear only once.",
    );
  const totals = new Map<string, Decimal>();
  const requirements = lines.map((line) => {
    const planned = new Decimal(line.consumptionPerUnit).mul(line.quantity);
    totals.set(
      line.materialId,
      (totals.get(line.materialId) ?? new Decimal(0)).add(planned),
    );
    return { ...line, planned: planned.toFixed(4) };
  });
  return {
    requirements,
    materials: Array.from(totals, ([materialId, planned]) => ({
      materialId,
      planned: planned.toFixed(4),
    })),
  };
}

/** Issued fabric is partitioned into incorporated fabric, waste and usable return. */
export function calculateCuttingResult(input: unknown) {
  const value = z
    .object({
      issued: positive,
      incorporated: decimal,
      waste: decimal,
      returned: decimal,
      planned: decimal,
      piecesCut: z.number().int().nonnegative().max(1_000_000),
      rejectedPieces: z.number().int().nonnegative().max(1_000_000),
    })
    .parse(input);
  const issued = new Decimal(value.issued);
  const incorporated = new Decimal(value.incorporated);
  const waste = new Decimal(value.waste);
  const returned = new Decimal(value.returned);
  if (!incorporated.add(waste).add(returned).eq(issued))
    throw new Error(
      "Issued length must equal incorporated fabric, waste and usable return.",
    );
  if (value.rejectedPieces > value.piecesCut)
    throw new Error("Rejected pieces cannot exceed pieces cut.");
  const consumed = incorporated.add(waste);
  return {
    consumed: consumed.toFixed(4),
    variance: consumed.minus(value.planned).toFixed(4),
    acceptedPieces: value.piecesCut - value.rejectedPieces,
    // Return is excluded from the denominator because it remains usable stock.
    efficiencyPercent: consumed.isZero()
      ? null
      : incorporated.div(consumed).mul(100).toFixed(2),
    wastePercent: consumed.isZero()
      ? null
      : waste.div(consumed).mul(100).toFixed(2),
  };
}
