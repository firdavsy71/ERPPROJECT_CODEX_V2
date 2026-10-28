import Decimal from "decimal.js";
import type { Locale } from "./messages";
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const intlLocale: Record<Locale, string> = {
  en: "en-US",
  ru: "ru-RU",
  uz: "uz-UZ",
};
export function formatMoneyExact(
  value: string | number,
  currency: string,
  locale: Locale = "en",
) {
  const amount = new Money(value).toFixed(2);
  return new Intl.NumberFormat(intlLocale[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount as unknown as number);
}
export function formatNumberExact(
  value: string | number,
  locale: Locale = "en",
  digits = 2,
) {
  const amount = new Money(value).toFixed(digits);
  return new Intl.NumberFormat(intlLocale[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount as unknown as number);
}
export function formatDateOnly(date: string, locale: Locale = "en") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Expected an ISO calendar date");
  const instant = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date)
    throw new Error("Expected a valid ISO calendar date");
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(instant);
}
export function formatTimestamp(
  date: Date | string,
  locale: Locale = "en",
  timeZone = "Asia/Tashkent",
) {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(date));
}
export function businessDate(date: Date, timeZone = "Asia/Tashkent") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
