import { sql } from "drizzle-orm";
import { db } from "@/db";
/** Read-only checks of existing ledgers and document counters; never repairs stock. */
export async function checkConsistency() {
  return db().transaction(
    async (tx) => {
      const result = await tx.execute(sql`
      SELECT 'stock_ledger' AS check, count(*)::int AS violations FROM inventory_balances b
      WHERE b.on_hand<>(SELECT coalesce(sum(m.quantity),0) FROM inventory_movements m WHERE m.balance_id=b.id)
         OR b.reserved<>(SELECT coalesce(sum(m.reserved_delta),0) FROM inventory_movements m WHERE m.balance_id=b.id)
      UNION ALL
      SELECT 'finished_reservations',count(*)::int FROM (
        SELECT b.variant_id FROM inventory_balances b WHERE b.variant_id IS NOT NULL GROUP BY b.variant_id
        HAVING sum(b.reserved)<>(SELECT coalesce(sum(l.reserved),0) FROM sales_order_items l WHERE l.variant_id=b.variant_id)
      ) q
      UNION ALL
      SELECT 'material_reservations',count(*)::int FROM inventory_balances b WHERE b.material_id IS NOT NULL
        AND b.reserved<>(SELECT coalesce(sum(r.quantity),0) FROM production_material_reservations r JOIN manufacturing_orders o ON o.id=r.order_id WHERE r.balance_id=b.id AND o.status IN ('Planned','In Progress','Quality Control'))
      UNION ALL
      SELECT 'shipment_counters',count(*)::int FROM sales_order_items l
        WHERE l.shipped<>(SELECT coalesce(sum(i.quantity),0) FROM shipment_items i WHERE i.sale_item_id=l.id)
      UNION ALL
      SELECT 'purchase_receipt_counters',count(*)::int FROM purchase_order_items l
        WHERE l.received<>(SELECT coalesce(sum(i.quantity),0) FROM purchase_receipt_items i WHERE i.purchase_item_id=l.id)
      UNION ALL
      SELECT 'invoice_payments',count(*)::int FROM invoices i
        WHERE i.paid<>(SELECT coalesce(sum(p.amount),0) FROM payments p WHERE p.invoice_id=i.id)
      UNION ALL
      SELECT 'manufacturing_variant_links',count(*)::int FROM manufacturing_orders m JOIN bom_versions b ON b.id=m.bom_id LEFT JOIN sales_order_items l ON l.id=m.sale_item_id
        WHERE m.variant_id<>b.variant_id OR (l.id IS NOT NULL AND l.variant_id<>m.variant_id)
      UNION ALL
      SELECT 'manufacturing_qc',count(*)::int FROM manufacturing_orders m WHERE m.status='Completed'
        AND NOT EXISTS(SELECT 1 FROM quality_inspections q WHERE q.order_id=m.id AND q.approved=m.completed AND q.specification_id=m.specification_id)
        AND NOT EXISTS(SELECT 1 FROM outsourcing_orders o WHERE o.manufacturing_order_id=m.id AND o.status='Completed' AND m.completed=(SELECT coalesce(sum(r.accepted),0) FROM outsourcing_receipts r WHERE r.order_id=o.id))
      UNION ALL
      SELECT 'roll_balances',count(*)::int FROM inventory_balances b WHERE b.roll_tracked AND (
        b.on_hand<>(SELECT coalesce(sum(f.remaining_length),0) FROM fabric_rolls f WHERE f.balance_id=b.id)
        OR b.reserved<>(SELECT coalesce(sum(f.reserved_length),0) FROM fabric_rolls f WHERE f.balance_id=b.id))
      UNION ALL
      SELECT 'return_claims',count(*)::int FROM shipment_items si WHERE si.quantity < (
        SELECT coalesce(sum(CASE WHEN r.intake_closed THEN (SELECT coalesce(sum(p.quantity),0) FROM return_receipts p WHERE p.return_item_id=ri.id) ELSE ri.quantity END),0)
        FROM return_items ri JOIN return_orders r ON r.id=ri.return_id WHERE ri.shipment_item_id=si.id AND r.status NOT IN ('Rejected','Cancelled'))
    `);
      const rows = Array.isArray(result)
        ? result
        : (result as unknown as { rows: unknown[] }).rows;
      return rows as unknown as { check: string; violations: number }[];
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
