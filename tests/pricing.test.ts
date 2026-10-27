import { describe, it, expect } from "vitest";
import { resolvePrice, ruleInput } from "@/services/pricing";
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
});
