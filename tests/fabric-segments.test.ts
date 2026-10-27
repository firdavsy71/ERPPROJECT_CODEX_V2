import { describe, expect, it } from "vitest";
import { damageSegments, takeSegments } from "@/lib/fabric-segments";

describe("physical fabric sections", () => {
  it("records the exact damaged section and consumes across the resulting gaps", () => {
    const damaged = damageSegments([{ start: "0", end: "100" }], "20", "25");
    expect(damaged.quantity).toBe("5.0000");
    const consumed = takeSegments(damaged.remaining, "30");
    expect(consumed.taken).toEqual([
      { start: "0.0000", end: "20.0000" },
      { start: "25.0000", end: "35.0000" },
    ]);
    expect(consumed.remaining).toEqual([{ start: "35.0000", end: "100.0000" }]);
  });
  it("does not allow double damage or consuming more than remains", () => {
    const damaged = damageSegments([{ start: "0", end: "10" }], "2", "3");
    expect(() => damageSegments(damaged.remaining, "1", "4")).toThrow();
    expect(() => takeSegments(damaged.remaining, "10")).toThrow();
  });
  it("removes stock corrections from the end without crossing gaps", () => {
    expect(takeSegments([{ start: "0", end: "2" }, { start: "4", end: "6" }], "3", true)).toEqual({
      taken: [{ start: "1.0000", end: "2.0000" }, { start: "4.0000", end: "6.0000" }],
      remaining: [{ start: "0", end: "1.0000" }],
    });
  });
});
