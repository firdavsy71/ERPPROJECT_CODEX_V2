import { describe, it, expect } from "vitest";
import {
  businessDate,
  formatDateOnly,
  formatMoneyExact,
  formatNumberExact,
  formatTimestamp,
} from "../src/i18n/format";
import { messages, resolveLocale } from "../src/i18n/messages";
import { discountedLineTotal } from "../src/lib/money";
import { documentLabel, documentTitle } from "../src/i18n/documents";
describe("localization", () => {
  it("has matching structured dictionaries and safely resolves languages", () => {
    for (const section of Object.keys(
      messages.en,
    ) as (keyof typeof messages.en)[]) {
      expect(Object.keys(messages.ru[section]).sort()).toEqual(
        Object.keys(messages.en[section]).sort(),
      );
      expect(Object.keys(messages.uz[section]).sort()).toEqual(
        Object.keys(messages.en[section]).sort(),
      );
    }
    expect(resolveLocale("uz")).toBe("uz");
    expect(resolveLocale("ru")).toBe("ru");
    expect(resolveLocale("../invalid")).toBe("en");
  });
  it("formats exact decimal money without converting large amounts to binary floats", () => {
    expect(formatMoneyExact("9007199254740993.12", "USD", "en")).toBe(
      "$9,007,199,254,740,993.12",
    );
    expect(formatMoneyExact("180000.00", "UZS", "ru")).toContain("180");
    expect(formatNumberExact("1234.56", "uz")).toContain("1");
    expect(discountedLineTotal("3", "0.10", "0")).toBe("0.30");
    expect(discountedLineTotal("999999999999", "9999.99", "10")).toBe(
      "8999990999991000.01",
    );
  });
  it("separates calendar dates from business-zone timestamps", () => {
    const instant = new Date("2026-01-01T20:30:00.000Z");
    expect(businessDate(instant, "Asia/Tashkent")).toBe("2026-01-02");
    expect(businessDate(instant, "UTC")).toBe("2026-01-01");
    expect(formatTimestamp(instant, "en", "Asia/Tashkent")).toContain(
      "Jan 2, 2026",
    );
    expect(formatDateOnly("2026-01-01", "en")).toContain("Jan 1, 2026");
    expect(formatDateOnly("2024-02-29", "en")).toContain("Feb 29, 2024");
    for (const invalid of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01"])
      expect(() => formatDateOnly(invalid)).toThrow("valid ISO calendar date");
  });
  it("localizes document templates without translating persisted descriptions", () => {
    expect(documentTitle("purchase-order", "ru")).toBe("Заказ поставщику");
    expect(documentTitle("packing-list", "uz")).toBe("Qadoqlash ro‘yxati");
    expect(documentLabel("Tax rate", "uz")).toBe("Soliq stavkasi");
    expect(documentLabel("Expected date", "ru")).toBe("Ожидаемая дата");
    expect(documentLabel("Special instructions from customer", "ru")).toBe("Special instructions from customer");
  });
});
