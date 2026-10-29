import { currentActor } from "@/auth";
import { data } from "@/services/queries";
import Decimal from "decimal.js";
import { currentLocale } from "@/i18n/server";
import { messages } from "@/i18n/messages";
import { businessDate, formatTimestamp } from "@/i18n/format";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { canExportReport } from "@/lib/permissions";
import { db } from "@/db";
import { balances, movements } from "@/db/schema";
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid ISO calendar date");
const filtersSchema = z.object({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  warehouseId: z.uuid().optional(),
}).refine(v => !v.from || !v.to || v.from <= v.to, "Start date must not follow end date");
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams;
  const name = params.get("report") ?? "";
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
  if (!canExportReport(actor.role, name))
    return new Response("Forbidden", { status: 403 });
  const parsed = filtersSchema.safeParse(Object.fromEntries(
    ["from", "to", "warehouseId"].filter(key => params.has(key) && params.get(key) !== "").map(key => [key, params.get(key)]),
  ));
  if (!parsed.success) return new Response("Invalid report filters", { status: 400 });
  const filters = parsed.data;
  if ((filters.from || filters.to) && ["inventory", "materials"].includes(name))
    return new Response("Stock reports show current balances; date filters require a movement report.", { status: 400 });
  if (filters.warehouseId && !["inventory", "materials", "movements"].includes(name))
    return new Response("This report does not support warehouse filtering.", { status: 400 });
  const d = await data();
  if (filters.warehouseId && !d.warehouses.some(w => w.id === filters.warehouseId))
    return new Response("Warehouse not found", { status: 404 });
  const locale = await currentLocale();
  const labels = messages[locale].reports;
  const timezone = d.settings[0]?.timezone ?? "Asia/Tashkent";
  const inPeriod = (row: { createdAt: Date }) => {
    const date = businessDate(row.createdAt, timezone);
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  };
  const rows =
    name === "invoices"
      ? d.invoices.filter(inPeriod).map((i) => {
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
            currency: d.sales.find((o) => o.id === i.orderId)?.currency,
            orderNumber: d.sales.find((o) => o.id === i.orderId)?.number,
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
      : name === "movements"
        ? await db().select().from(movements).where(and(
          filters.warehouseId ? sql`${movements.balanceId} in (select ${balances.id} from ${balances} where ${eq(balances.warehouseId, filters.warehouseId)})` : undefined,
          filters.from ? sql`(${movements.createdAt} at time zone ${timezone})::date >= ${filters.from}::date` : undefined,
          filters.to ? sql`(${movements.createdAt} at time zone ${timezone})::date <= ${filters.to}::date` : undefined,
        )).orderBy(movements.createdAt, movements.id)
        : name === "inventory"
          ? d.balances.filter(b => !filters.warehouseId || b.warehouseId === filters.warehouseId)
          : name === "materials"
            ? d.materials.filter(m => !filters.warehouseId || d.balances.some(b => b.warehouseId === filters.warehouseId && b.materialId === m.id))
            : d[name as "sales" | "manufacturing" | "purchases"].filter(inPeriod);
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
      "X-Report-Time-Zone": timezone,
      "X-Report-Basis": ["inventory", "materials"].includes(name) ? "current-state" : "created-at",
    },
  });
}
