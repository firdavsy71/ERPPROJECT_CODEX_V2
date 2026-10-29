import { db } from "@/db";
import * as s from "@/db/schema";
import { sql } from "drizzle-orm";
function queryRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  )
    return result.rows as Record<string, unknown>[];
  throw new Error("Unsupported database result shape");
}
export async function overview() {
  return db().transaction(
    async (tx) => {
      const [settings] = await tx
        .select({ timezone: s.settings.timezone })
        .from(s.settings)
        .limit(1);
      const timezone = settings?.timezone ?? "Asia/Tashkent";
      const rows = await tx.execute(sql`select
 (select count(*) from sales_orders where status not in ('Shipped','Completed','Cancelled')) as pending,
 (select count(*) from manufacturing_orders where status not in ('Completed','Cancelled')) as active,
 (select count(*) from manufacturing_orders where status='Completed') as completed,
 (select count(*) from materials m where m.active and coalesce((select sum(b.on_hand-b.reserved-b.held) from inventory_balances b where b.material_id=m.id),0)<m.minimum) as low`);
      const revenue = await tx.execute(
        sql`select so.currency,coalesce(sum(i.total),0)::text as total,coalesce(sum(greatest(i.total-i.paid-(select coalesce(sum(c.amount),0) from return_credit_notes c where c.invoice_id=i.id)+(select coalesce(sum(r.amount),0) from return_refunds r where r.invoice_id=i.id),0)),0)::text as outstanding from invoices i join sales_orders so on so.id=i.order_id group by so.currency`,
      );
      const trends = await tx.execute(
        sql`select to_char(i.created_at at time zone ${timezone},'YYYY-MM') as month,so.currency,sum(i.total)::text as revenue from invoices i join sales_orders so on so.id=i.order_id group by 1,2 order by 1`,
      );
      return {
        kpis: queryRows(rows)[0],
        revenue: queryRows(revenue),
        trends: queryRows(trends),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function data() {
  return db().transaction(
    async (d) => {
      const [
        products,
        variants,
        materials,
        customers,
        suppliers,
        employees,
        warehouses,
        boms,
        bomItems,
        manufacturing,
        sales,
        saleItems,
        purchases,
        purchaseItems,
        invoices,
        payments,
        balances,
        movements,
        settings,
        users,
        reservations,
        returnCredits,
        returnRefunds,
      ] = await Promise.all([
        d.select().from(s.products),
        d.select().from(s.variants),
        d.select().from(s.materials),
        d.select().from(s.customers),
        d.select().from(s.suppliers),
        d.select().from(s.employees),
        d.select().from(s.warehouses),
        d.select().from(s.boms),
        d.select().from(s.bomItems),
        d.select().from(s.manufacturing),
        d.select().from(s.sales),
        d.select().from(s.saleItems),
        d.select().from(s.purchases),
        d.select().from(s.purchaseItems),
        d.select().from(s.invoices),
        d.select().from(s.payments),
        d.select().from(s.balances),
        d
          .select()
          .from(s.movements)
          .orderBy(sql`created_at desc`)
          .limit(100),
        d.select().from(s.settings),
        d
          .select({
            id: s.users.id,
            name: s.users.name,
            email: s.users.email,
            role: s.users.role,
            active: s.users.active,
          })
          .from(s.users),
        d.select().from(s.reservations),
        d.select().from(s.returnCreditNotes),
        d.select().from(s.returnRefunds),
      ]);
      return {
        products,
        variants,
        materials,
        customers,
        suppliers,
        employees,
        warehouses,
        boms,
        bomItems,
        manufacturing,
        sales,
        saleItems,
        purchases,
        purchaseItems,
        invoices,
        payments,
        balances,
        movements,
        settings,
        users,
        reservations,
        returnCredits,
        returnRefunds,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type Data = Awaited<ReturnType<typeof data>>;
