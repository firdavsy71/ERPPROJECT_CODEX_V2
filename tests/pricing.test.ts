import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { db, localClient } from "@/db";
import * as s from "@/db/schema";
import { execute, type BusinessAction } from "@/services/operations";
import type { Actor } from "@/lib/permissions";
import { resolvePrice, ruleInput, pricingDay } from "@/services/pricing";
import type { pricingRules } from "@/db/schema";
import { discountedLineTotal } from "@/lib/money";
const customer = "11111111-1111-4111-8111-111111111111",
  variant = "22222222-2222-4222-8222-222222222222";
function rule(
  kind: string,
  tiers: { minQty: number; mode: "Price" | "Discount"; value: string }[],
  extra: Partial<typeof pricingRules.$inferSelect> = {},
): typeof pricingRules.$inferSelect {
  return {
    id: kind,
    name: kind,
    kind,
    customerId: ["Contract", "Customer"].includes(kind) ? customer : null,
    variantId: variant,
    currency: "UZS",
    startDate: "2020-01-01",
    endDate: "2099-12-31",
    minimum: 1,
    tiers,
    version: 1,
    status: "Approved",
    createdBy: customer,
    approvedBy: customer,
    createdAt: new Date(),
    ...extra,
  };
}
const price = (
  rules: (typeof pricingRules.$inferSelect)[],
  q: number,
  day = "2026-10-27",
  currency = "UZS",
) =>
  resolvePrice(rules, customer, variant, q, day, currency, {
    price: "180000",
    currency: "UZS",
  });
describe("deterministic B2B pricing", () => {
  it("uses the exact wholesale boundaries", () => {
    const r = rule("Volume", [
      { minQty: 1, mode: "Price", value: "180000" },
      { minQty: 50, mode: "Price", value: "165000" },
      { minQty: 200, mode: "Price", value: "150000" },
    ]);
    expect([1, 49, 50, 199, 200, 1000].map((q) => price([r], q).price)).toEqual(
      [
        "180000.00",
        "180000.00",
        "165000.00",
        "165000.00",
        "150000.00",
        "150000.00",
      ],
    );
  });
  it("selects contract then customer then volume without stacking", () => {
    const volume = rule("Volume", [
        { minQty: 50, mode: "Discount", value: "10" },
      ]),
      custom = rule("Customer", [{ minQty: 1, mode: "Discount", value: "5" }]),
      contract = rule("Contract", [
        { minQty: 1, mode: "Price", value: "140000" },
      ]);
    expect(price([volume, custom, contract], 200).price).toBe("140000.00");
    expect(price([volume, custom], 200).discount).toBe("5.00");
    expect(price([volume], 200).discount).toBe("10.00");
    expect(price([volume], 49).discount).toBe("0.00");
  });
  it("honors date inclusivity, MOQ and currency isolation", () => {
    const r = rule("Contract", [{ minQty: 50, mode: "Price", value: "100" }], {
      startDate: "2026-10-27",
      endDate: "2026-10-28",
      minimum: 50,
    });
    expect(() => price([r], 49)).toThrow("Minimum");
    expect(price([r], 50, "2026-10-28").price).toBe("100.00");
    expect(price([r], 50, "2026-10-29").price).toBe("180000.00");
    expect(() => price([r], 50, undefined, "USD")).toThrow("currency");
    expect(
      price(
        [
          rule("Standard", [{ minQty: 1, mode: "Price", value: "12.50" }], {
            currency: "USD",
          }),
        ],
        2,
        undefined,
        "USD",
      ).price,
    ).toBe("12.50");
  });
  it("rejects ambiguous rules and duplicate tier thresholds", () => {
    const r = rule("Customer", [{ minQty: 1, mode: "Price", value: "10" }]);
    expect(() => price([r, { ...r, id: "other" }], 1)).toThrow("Conflicting");
    expect(
      ruleInput.safeParse({ ...r, tiers: [r.tiers[0], r.tiers[0]] }).success,
    ).toBe(false);
  });
  it("rounds the discounted line once rather than multiplying a rounded unit result", () => {
    expect(discountedLineTotal(3, "0.05", "33.33")).toBe("0.10");
  });
  it("expires discounted prices when their standard-price evidence expires", () => {
    const contract = rule("Contract", [
      { minQty: 1, mode: "Discount", value: "10" },
    ]);
    const standard = rule(
      "Standard",
      [{ minQty: 1, mode: "Price", value: "200" }],
      {
        endDate: "2026-10-28",
        version: 3,
      },
    );
    const resolved = price([contract, standard], 1);
    expect(resolved.snapshot.validUntil).toBe("2026-10-28");
    expect(resolved.snapshot.baseRuleId).toBe(standard.id);
    expect(resolved.snapshot.baseRuleVersion).toBe(3);
    expect(resolved.price).toBe("200.00");
    expect(resolved.discount).toBe("10.00");
    const fixedContract = {
      ...contract,
      tiers: [{ minQty: 1, mode: "Price" as const, value: "150" }],
    };
    expect(price([fixedContract, standard], 1).snapshot.validUntil).toBe(
      contract.endDate,
    );
    expect(price([fixedContract, standard], 1).snapshot.baseRuleId).toBeNull();
  });
});

describe("quotation price dependencies persisted in PostgreSQL", () => {
  let actor: Actor, customerId: string, variantId: string;
  const act = (action: BusinessAction, input: unknown) =>
    execute(actor, action, input, randomUUID());
  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DATA_DIR = ":memory:";
    await migrate(drizzle(localClient()!), { migrationsFolder: "drizzle" });
  });
  afterAll(async () => {
    await localClient()?.close();
  });
  beforeEach(async () => {
    await db().execute(
      sql`truncate users,warehouses,products,customers cascade`,
    );
    const [user] = await db()
      .insert(s.users)
      .values({
        name: "Pricing administrator",
        email: "pricing@example.com",
        passwordHash: "test",
        role: "admin",
      })
      .returning();
    actor = { id: user.id, role: "admin" };
    await db().insert(s.warehouses).values({ name: "Main" });
    const [customer] = await db()
      .insert(s.customers)
      .values({ name: "Contract customer" })
      .returning();
    customerId = customer.id;
    const [product] = await db()
      .insert(s.products)
      .values({ name: "Work jacket", sku: "JKT" })
      .returning();
    const [variant] = await db()
      .insert(s.variants)
      .values({
        productId: product.id,
        sku: "JKT-L",
        size: "L",
        color: "Navy",
        price: "100",
      })
      .returning();
    variantId = variant.id;
  });
  async function approveRule(
    kind: "Standard" | "Contract",
    endDate: string,
    startDate = "2020-01-01",
  ) {
    await act("savePricingRule", {
      name: `${kind} ${randomUUID()}`,
      kind,
      variantId,
      customerId: kind === "Contract" ? customerId : "",
      currency: "USD",
      startDate,
      endDate,
      minimum: 1,
      tiers: [
        {
          minQty: 1,
          mode: kind === "Contract" ? "Discount" : "Price",
          value: kind === "Contract" ? "10" : "200",
        },
      ],
    });
    const rule = (await db().select().from(s.pricingRules)).find(
      (r) => r.status === "Draft",
    )!;
    await act("approvePricingRule", { id: rule.id });
    return rule;
  }
  it("rejects quotation validity beyond the discount base's expiration", async () => {
    await approveRule("Standard", pricingDay());
    await approveRule("Contract", "2099-12-31");
    await expect(
      act("createQuotation", {
        customerId,
        currency: "USD",
        validUntil: "2099-12-31",
        lines: [{ itemId: variantId, quantity: 2 }],
      }),
    ).rejects.toThrow("expiration");
    expect(await db().select().from(s.quotations)).toHaveLength(0);
  });
  it("requires recalculation when the standard base version changes at the same price", async () => {
    const original = await approveRule("Standard", "2099-12-31");
    await approveRule("Contract", "2099-12-31");
    await act("createQuotation", {
      customerId,
      currency: "USD",
      validUntil: pricingDay(),
      lines: [{ itemId: variantId, quantity: 2 }],
    });
    const [quote] = await db().select().from(s.quotations);
    expect(quote.total).toBe("360.00");
    expect(quote.lines[0].snapshot.baseRuleId).toBe(original.id);
    await act("retirePricingRule", {
      id: original.id,
      effectiveDate: pricingDay(),
      reason: "Replace standard-price evidence",
    });
    const replacement = await approveRule(
      "Standard",
      "2099-12-31",
      pricingDay(),
    );
    await expect(act("approveQuotation", { id: quote.id })).rejects.toThrow(
      "recalculate",
    );
    expect((await db().select().from(s.quotations))[0].status).toBe("Draft");
    await act("editQuotation", {
      id: quote.id,
      customerId,
      currency: "USD",
      validUntil: pricingDay(),
      lines: [{ itemId: variantId, quantity: 2 }],
    });
    await act("approveQuotation", { id: quote.id });
    const [approved] = await db().select().from(s.quotations);
    expect(approved.status).toBe("Approved");
    expect(approved.lines[0].snapshot.baseRuleId).toBe(replacement.id);
    expect(approved.lines[0].snapshot.baseRuleVersion).toBe(2);
  });
});
