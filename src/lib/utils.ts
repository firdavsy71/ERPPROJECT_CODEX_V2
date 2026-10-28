import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatMoneyExact } from "@/i18n/format";
import type { Locale } from "@/i18n/messages";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatMoney(
  value: string | number,
  currency = "UZS",
  locale: Locale = "en",
) {
  return formatMoneyExact(value, currency, locale);
}
