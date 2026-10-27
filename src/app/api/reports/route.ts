import { currentActor } from "@/auth";
import { data } from "@/services/queries";
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
  const rows = d[name === "inventory" ? "balances" : (name as "sales")];
  const keys = Object.keys(rows[0] ?? {});
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv = [
    keys.map(escape).join(","),
    ...rows.map((row) =>
      keys
        .map((k) => escape((row as unknown as Record<string, unknown>)[k]))
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
