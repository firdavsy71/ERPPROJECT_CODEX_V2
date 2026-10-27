import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { discountedLineTotal } from "@/lib/money";
import { authorize, type Actor } from "@/lib/permissions";
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const currency = z.enum(["UZS", "USD"]);
export const pricingDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const ruleInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["Contract", "Customer", "Volume", "Standard"]),
    customerId: z.uuid().optional().or(z.literal("")),
    variantId: z.uuid(),
    currency,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    minimum: z.coerce.number().int().positive().max(1000000),
    tiers: z
      .array(
        z.object({
          minQty: z.coerce.number().int().positive().max(1000000),
          mode: z.enum(["Price", "Discount"]),
          value: money,
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((v, c) => {
    if (v.startDate > v.endDate)
      c.addIssue({
        code: "custom",
        message: "Expiration must not precede start",
      });
    if (["Contract", "Customer"].includes(v.kind) !== Boolean(v.customerId))
      c.addIssue({
        code: "custom",
        message: "Customer is required only for contract and customer rules",
      });
    if (
      new Set(v.tiers.map((t) => t.minQty)).size !== v.tiers.length ||
      v.tiers.some(
        (t) =>
          t.minQty < v.minimum ||
          (t.mode === "Discount" && new Decimal(t.value).gt(100)),
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Tiers must have unique thresholds at or above MOQ, and discounts from 0 to 100",
      });
    if (
      v.kind === "Standard" &&
      (v.tiers.length !== 1 ||
        v.tiers[0].mode !== "Price" ||
        v.tiers[0].minQty !== v.minimum)
    )
      c.addIssue({
        code: "custom",
        message: "Standard price requires one fixed-price tier at MOQ",
      });
  });
type Rule = typeof s.pricingRules.$inferSelect;
/** Single winning rule; implicit tier upper bound is the next threshold, exclusive. */
export function resolvePrice(
  rules: Rule[],
  customerId: string,
  variantId: string,
  quantity: number,
  asOf: string,
  currencyCode: string,
  base: { price: string; currency: string },
) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000)
    throw new Error("Use a positive whole quantity up to 1,000,000");
  const applicable = rules.filter(
    (r) =>
      r.status === "Approved" &&
      r.variantId === variantId &&
      r.currency === currencyCode &&
      r.startDate <= asOf &&
      r.endDate >= asOf &&
      (r.customerId === null || r.customerId === customerId),
  );
  const one = (kind: string) => {
    const matches = applicable.filter((r) => r.kind === kind);
    if (matches.length > 1)
      throw new Error("Conflicting approved pricing rules");
    return matches[0];
  };
  const standard = one("Standard");
  let selected: Rule | undefined;
  for (const kind of ["Contract", "Customer", "Volume", "Standard"]) {
    const rule = one(kind);
    if (!rule) continue;
    if (
      kind === "Volume" &&
      quantity < Math.min(...rule.tiers.map((t) => t.minQty))
    )
      continue;
    selected = rule;
    break;
  }
  if (selected && quantity < selected.minimum)
    throw new Error(`Minimum order quantity is ${selected.minimum}`);
  const tier = selected?.tiers
    .filter((t) => t.minQty <= quantity)
    .sort((a, b) => b.minQty - a.minQty)[0];
  if (selected && !tier)
    throw new Error("Quantity is below the first applicable price tier");
  let price: string,
    discount = "0";
  if (tier?.mode === "Price") price = tier.value;
  else {
    if (standard) {
      if (quantity < standard.minimum)
        throw new Error(
          `Standard minimum order quantity is ${standard.minimum}`,
        );
      price = standard.tiers[0].value;
    } else {
      if (currencyCode !== base.currency)
        throw new Error(
          "No standard price exists in the requested currency; configure an explicit price instead of implicit FX",
        );
      price = base.price;
    }
    if (tier) discount = tier.value;
  }
  return {
    price: new Decimal(price).toFixed(2),
    discount: new Decimal(discount).toFixed(2),
    snapshot: {
      source: selected?.kind ?? "Catalog",
      ruleId: selected?.id ?? null,
      version: selected?.version ?? null,
      baseRuleId: tier?.mode === "Discount" ? (standard?.id ?? null) : null,
      currency: currencyCode,
      asOf,
      quantity,
      minimum: selected?.minimum ?? 1,
      validUntil: selected?.endDate ?? null,
    },
  };
}
async function approvedRules(tx: Tx) {
  const [rules, retirements] = await Promise.all([
    tx.select().from(s.pricingRules),
    tx.select().from(s.pricingRetirements),
  ]);
  return rules.map((r) => {
    const retirement = retirements.find((e) => e.ruleId === r.id);
    if (!retirement) return r;
    const last = new Date(`${retirement.effectiveDate}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    return {
      ...r,
      endDate:
        r.endDate < last.toISOString().slice(0, 10)
          ? r.endDate
          : last.toISOString().slice(0, 10),
    };
  });
}
export async function calculatePricedLines(
  tx: Tx,
  customerId: string,
  currencyCode: string,
  input: { itemId: string; quantity: number }[],
  asOf = pricingDay(),
) {
  if (new Set(input.map((l) => l.itemId)).size !== input.length)
    throw new Error(
      "Each product variant must appear once; combine quantities to select a volume tier",
    );
  const [customer] = await tx
    .select()
    .from(s.customers)
    .where(eq(s.customers.id, customerId));
  if (!customer?.active) throw new Error("Choose an active customer");
  const [rules, settings] = await Promise.all([
    approvedRules(tx),
    tx.select().from(s.settings),
  ]);
  const lines: s.QuotationLine[] = [];
  for (const l of input) {
    const [v] = await tx
      .select()
      .from(s.variants)
      .where(eq(s.variants.id, l.itemId));
    if (!v) throw new Error("Product variant not found");
    const [p] = await tx
      .select()
      .from(s.products)
      .where(eq(s.products.id, v.productId));
    if (!p.active) throw new Error("Product is archived");
    const resolved = resolvePrice(
      rules,
      customerId,
      v.id,
      l.quantity,
      asOf,
      currencyCode,
      { price: v.price, currency: settings[0]?.currency ?? "UZS" },
    );
    lines.push({ ...l, ...resolved });
  }
  return lines;
}
const total = (lines: s.QuotationLine[]) =>
  lines
    .reduce(
      (n, l) => n.add(discountedLineTotal(l.quantity, l.price, l.discount)),
      new Decimal(0),
    )
    .toFixed(2);
export async function pricingAction(
  tx: Tx,
  action: string,
  input: unknown,
  actor: Actor,
) {
  if (action === "savePricingRule") {
    const v = ruleInput.parse(input);
    const rows = await tx.select().from(s.pricingRules);
    const id = z.object({ id: z.uuid().optional() }).parse(input).id;
    const values = {
      ...v,
      customerId: v.customerId || null,
      tiers: [...v.tiers].sort((a, b) => a.minQty - b.minQty),
    };
    if (id) {
      if (rows.find((r) => r.id === id)?.status !== "Draft")
        throw new Error("Only draft price rules can be edited");
      await tx
        .update(s.pricingRules)
        .set(values)
        .where(eq(s.pricingRules.id, id));
    } else
      await tx.insert(s.pricingRules).values({
        ...values,
        version:
          Math.max(
            0,
            ...rows
              .filter(
                (r) =>
                  r.variantId === v.variantId &&
                  r.kind === v.kind &&
                  r.customerId === values.customerId &&
                  r.currency === v.currency,
              )
              .map((r) => r.version),
          ) + 1,
        createdBy: actor.id,
      });
    return;
  }
  if (action === "approvePricingRule" || action === "rejectPricingRule") {
    authorize(actor, "pricing.approve");
    const { id } = z.object({ id: z.uuid() }).parse(input);
    const [r] = await tx
      .select()
      .from(s.pricingRules)
      .where(eq(s.pricingRules.id, id));
    if (!r || r.status !== "Draft")
      throw new Error("Only draft rules can be reviewed");
    if (action === "approvePricingRule") {
      const rules = await approvedRules(tx);
      if (
        rules.some(
          (o) =>
            o.status === "Approved" &&
            o.startDate <= o.endDate &&
            o.kind === r.kind &&
            o.variantId === r.variantId &&
            o.customerId === r.customerId &&
            o.currency === r.currency &&
            o.startDate <= r.endDate &&
            o.endDate >= r.startDate,
        )
      )
        throw new Error(
          "Overlapping approved rules are ambiguous; retire the previous rule or use non-overlapping dates",
        );
    }
    await tx
      .update(s.pricingRules)
      .set(
        action === "approvePricingRule"
          ? { status: "Approved", approvedBy: actor.id }
          : { status: "Rejected" },
      )
      .where(eq(s.pricingRules.id, id));
    return;
  }
  if (action === "retirePricingRule") {
    authorize(actor, "pricing.approve");
    const v = z
      .object({
        id: z.uuid(),
        effectiveDate: z.iso.date(),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(input);
    if (v.effectiveDate < pricingDay())
      throw new Error("Retirement cannot be retroactive");
    const [r] = await tx
      .select()
      .from(s.pricingRules)
      .where(eq(s.pricingRules.id, v.id));
    if (r?.status !== "Approved")
      throw new Error("Only approved rules can be retired");
    await tx.insert(s.pricingRetirements).values({
      ruleId: v.id,
      effectiveDate: v.effectiveDate,
      reason: v.reason,
      createdBy: actor.id,
    });
    return;
  }
  if (action === "createQuotation" || action === "editQuotation") {
    const v = z
      .object({
        customerId: z.uuid(),
        currency,
        validUntil: z.iso.date(),
        notes: z.string().max(3000).default(""),
        lines: z
          .array(
            z.object({
              itemId: z.uuid(),
              quantity: z.coerce.number().int().positive().max(1000000),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input);
    if (v.validUntil < pricingDay())
      throw new Error("Quotation has already expired");
    const lines = await calculatePricedLines(
      tx,
      v.customerId,
      v.currency,
      v.lines,
    );
    if (
      lines.some(
        (l) =>
          l.snapshot.validUntil && String(l.snapshot.validUntil) < v.validUntil,
      )
    )
      throw new Error(
        "Quotation validity cannot exceed the selected rule's expiration",
      );
    if (action === "editQuotation") {
      const { id } = z.object({ id: z.uuid() }).parse(input);
      const [q] = await tx
        .select()
        .from(s.quotations)
        .where(eq(s.quotations.id, id));
      if (q?.status !== "Draft")
        throw new Error("Only draft quotations can be recalculated");
      await tx
        .update(s.quotations)
        .set({ ...v, lines, total: total(lines) })
        .where(eq(s.quotations.id, id));
    } else
      await tx.insert(s.quotations).values({
        ...v,
        number: `QUO-${randomUUID().slice(0, 8).toUpperCase()}`,
        lines,
        total: total(lines),
        createdBy: actor.id,
      });
    return;
  }
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const [q] = await tx
    .select()
    .from(s.quotations)
    .where(eq(s.quotations.id, id))
    .for("update");
  if (!q) throw new Error("Quotation not found");
  if (action === "approveQuotation" || action === "rejectQuotation") {
    authorize(actor, "pricing.approve");
    if (q.status !== "Draft")
      throw new Error("Only draft quotations can be reviewed");
    if (q.validUntil < pricingDay()) throw new Error("Quotation expired");
    if (action === "approveQuotation") {
      const current = await calculatePricedLines(
        tx,
        q.customerId,
        q.currency,
        q.lines,
      );
      if (
        current.some(
          (l, i) =>
            l.price !== q.lines[i].price ||
            l.discount !== q.lines[i].discount ||
            l.snapshot.ruleId !== q.lines[i].snapshot.ruleId ||
            Boolean(
              l.snapshot.validUntil &&
              String(l.snapshot.validUntil) < q.validUntil,
            ),
        )
      )
        throw new Error(
          "Pricing changed; recalculate the draft quotation before approval",
        );
    }
    await tx
      .update(s.quotations)
      .set(
        action === "approveQuotation"
          ? { status: "Approved", approvedBy: actor.id }
          : { status: "Rejected" },
      )
      .where(eq(s.quotations.id, id));
    return;
  }
  if (action === "convertQuotation") {
    if (q.status !== "Approved" || q.validUntil < pricingDay())
      throw new Error(
        "Only approved, unexpired quotations can become sales orders",
      );
    const [order] = await tx
      .insert(s.sales)
      .values({
        number: `SO-${randomUUID().slice(0, 8).toUpperCase()}`,
        customerId: q.customerId,
        currency: q.currency,
        total: q.total,
        quotationId: q.id,
        pricingApprovedBy: q.approvedBy,
      })
      .returning();
    await tx.insert(s.saleItems).values(
      q.lines.map((l) => ({
        orderId: order.id,
        variantId: l.itemId,
        quantity: l.quantity,
        price: l.price,
        discount: l.discount,
        pricingSnapshot: { ...l.snapshot, quotationId: q.id },
      })),
    );
    await tx
      .update(s.quotations)
      .set({ status: "Converted" })
      .where(eq(s.quotations.id, id));
    return;
  }
  throw new Error("Unknown pricing action");
}
export async function approveSalePricing(
  tx: Tx,
  order: typeof s.sales.$inferSelect,
  actor: Actor,
) {
  if (order.pricingApprovedBy) return;
  const lines = await tx
    .select()
    .from(s.saleItems)
    .where(eq(s.saleItems.orderId, order.id));
  if (actor.role !== "admin") {
    const expected = await calculatePricedLines(
      tx,
      order.customerId,
      order.currency,
      lines.map((l) => ({ itemId: l.variantId, quantity: l.quantity })),
    );
    if (
      lines.some(
        (l, i) =>
          !new Decimal(l.price).eq(expected[i].price) ||
          !new Decimal(l.discount).eq(expected[i].discount),
      )
    )
      throw new Error(
        "Manual price or discount differs from approved rules; an administrator must approve this sale by confirming it",
      );
    for (let i = 0; i < lines.length; i++)
      await tx
        .update(s.saleItems)
        .set({ pricingSnapshot: expected[i].snapshot })
        .where(eq(s.saleItems.id, lines[i].id));
  } else {
    for (const l of lines)
      await tx
        .update(s.saleItems)
        .set({
          pricingSnapshot: {
            ...l.pricingSnapshot,
            approval: "Administrator manual price approval",
            approvedBy: actor.id,
            asOf: pricingDay(),
          },
        })
        .where(eq(s.saleItems.id, l.id));
  }
  await tx
    .update(s.sales)
    .set({ pricingApprovedBy: actor.id })
    .where(eq(s.sales.id, order.id));
}
