import { describe, expect, it } from "vitest";
import {
  calculateCuttingPlan,
  calculateCuttingResult,
} from "@/lib/cutting-calculations";

const materialId = "11111111-1111-4111-8111-111111111111";
const lines = [
  {
    manufacturingOrderId: "22222222-2222-4222-8222-222222222222",
    variantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    size: "M",
    quantity: 50,
    consumptionPerUnit: "2.1",
    materialId,
  },
  {
    manufacturingOrderId: "33333333-3333-4333-8333-333333333333",
    variantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    size: "L",
    quantity: 100,
    consumptionPerUnit: "2.3",
    materialId,
  },
  {
    manufacturingOrderId: "44444444-4444-4444-8444-444444444444",
    variantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    size: "XL",
    quantity: 50,
    consumptionPerUnit: "2.5",
    materialId,
  },
];

describe("cutting calculations", () => {
  it("sums size-specific consumption with exact decimal arithmetic", () => {
    const result = calculateCuttingPlan(lines);
    expect(result.requirements.map((line) => line.planned)).toEqual([
      "105.0000",
      "230.0000",
      "125.0000",
    ]);
    expect(result.materials[0].planned).toBe("460.0000");
  });
  it("rejects duplicate order-material lines rather than double-counting", () => {
    expect(() => calculateCuttingPlan([...lines, lines[0]])).toThrow(
      "only once",
    );
  });
  it("excludes usable returns from consumption and efficiency", () => {
    expect(
      calculateCuttingResult({
        issued: "100",
        incorporated: "75",
        waste: "5",
        returned: "20",
        planned: "78",
        piecesCut: 50,
        rejectedPieces: 2,
      }),
    ).toEqual({
      consumed: "80.0000",
      variance: "2.0000",
      acceptedPieces: 48,
      efficiencyPercent: "93.75",
      wastePercent: "6.25",
    });
  });
  it("rejects unreconciled lengths and more rejected than cut pieces", () => {
    expect(() =>
      calculateCuttingResult({
        issued: "100",
        incorporated: "75",
        waste: "5",
        returned: "19",
        planned: "78",
        piecesCut: 50,
        rejectedPieces: 2,
      }),
    ).toThrow("Issued length");
    expect(() =>
      calculateCuttingResult({
        issued: "100",
        incorporated: "75",
        waste: "5",
        returned: "20",
        planned: "78",
        piecesCut: 50,
        rejectedPieces: 51,
      }),
    ).toThrow("Rejected pieces");
  });
});
