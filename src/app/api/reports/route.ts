import { currentActor } from "@/auth";
import { data } from "@/services/queries";
import Decimal from "decimal.js";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import { formatTimestamp } from "@/i18n/format";
export async function GET(request: Request) {
  if (!(await currentActor()))
    return new Response("Unauthorized", { status: 401 });
  const name = new URL(request.url).searchParams.get("report") ?? "";
  if (
    ![
      "sales",
      "manufacturing",
      "materials",
      "inventory",
      "purchases",
      "invoices",
      "movements",
    ].includes(name)
  )
    return new Response("Unknown report", { status: 400 });
  const d = await data();
  const locale = await currentLocale();
  const labels = messages[locale].reports;
  const timezone = d.settings[0]?.timezone ?? "Asia/Tashkent";
  const rows =
    name === "invoices"
      ? d.invoices.map((i) => {
          const credited = d.returnCredits
              .filter((c) => c.invoiceId === i.id)
              .reduce((n, c) => n.add(c.amount), new Decimal(0)),
            refunded = d.returnRefunds
              .filter((r) => r.invoiceId === i.id)
              .reduce((n, r) => n.add(r.amount), new Decimal(0)),
            adjusted = new Decimal(i.total).minus(credited),
            netPaid = new Decimal(i.paid).minus(refunded);
          return {
            ...i,
            credited: credited.toFixed(2),
            refunded: refunded.toFixed(2),
            adjustedTotal: adjusted.toFixed(2),
            netPaid: netPaid.toFixed(2),
            outstanding: Decimal.max(adjusted.minus(netPaid), 0).toFixed(2),
            customerCreditBalance: Decimal.max(
              netPaid.minus(adjusted),
              0,
            ).toFixed(2),
          };
        })
      : d[name === "inventory" ? "balances" : (name as "sales")];
  const keys = Object.keys(rows[0] ?? {});
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const localizedKeys: Record<string, string> = {
    number: labels.number,
    status: labels.status,
    currency: labels.currency,
    total: labels.total,
    createdAt: labels.date,
    amount: labels.amount,
  };
  const csv = [
    keys
      .map((k) => escape(locale === "en" ? k : (localizedKeys[k] ?? k)))
      .join(","),
    ...rows.map((row) =>
      keys
        .map((k) => {
          const value = (row as unknown as Record<string, unknown>)[k];
          return escape(
            value instanceof Date
              ? formatTimestamp(value, locale, timezone)
              : value,
          );
        })
        .join(","),
    ),
  ].join("\r\n");
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
