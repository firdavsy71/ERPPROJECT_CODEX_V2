-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION guard_receipt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
    JOIN purchase_order_items l ON l.id=NEW.purchase_item_id AND l.order_id=p.id
    JOIN inventory_movements m ON m.id=NEW.movement_id
    JOIN inventory_balances b ON b.id=m.balance_id
    WHERE r.id=NEW.receipt_id AND l.material_id=NEW.material_id AND b.material_id=l.material_id
      AND m.quantity=NEW.quantity AND m.reason='Purchase receipt' AND m.source=p.number
      AND m.operation_key=(r.operation_key || ':' || l.id::text)
      AND NEW.currency=p.currency
      AND ((p.ordered_at IS NOT NULL AND NEW.provenance='Recorded' AND NEW.unit_price=l.price
        AND NEW.expected_date IS NOT DISTINCT FROM NULLIF(p.expected_date,'') AND NEW.ordered_at=p.ordered_at)
        OR (p.ordered_at IS NULL AND NEW.provenance='Legacy order' AND NEW.unit_price IS NULL
          AND NEW.expected_date IS NULL AND NEW.ordered_at IS NULL))
  ) THEN RAISE EXCEPTION 'Receipt snapshot must match purchase and inventory movement'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE purchase_receipt_items DISABLE TRIGGER receipt_snapshot_guard;
--> statement-breakpoint
INSERT INTO purchase_receipt_items (receipt_id,purchase_item_id,material_id,movement_id,quantity,unit_price,currency,expected_date,ordered_at,provenance,created_at)
SELECT r.id,l.id,l.material_id,m.id,m.quantity,NULL,p.currency,NULL,NULL,'Recovered',r.created_at
FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
JOIN purchase_order_items l ON l.order_id=p.id
JOIN inventory_movements m ON m.operation_key=(r.operation_key || ':' || l.id::text)
JOIN inventory_balances b ON b.id=m.balance_id AND b.material_id=l.material_id
WHERE m.reason='Purchase receipt' AND m.source=p.number AND m.quantity>0
  AND NOT EXISTS (SELECT 1 FROM purchase_receipt_items i WHERE i.receipt_id=r.id AND i.purchase_item_id=l.id);
--> statement-breakpoint
ALTER TABLE purchase_receipt_items ENABLE TRIGGER receipt_snapshot_guard;
--> statement-breakpoint
CREATE FUNCTION record_receipt_snapshot_from_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason <> 'Purchase receipt' OR NEW.quantity <= 0 THEN RETURN NEW; END IF;
  INSERT INTO purchase_receipt_items (receipt_id,purchase_item_id,material_id,movement_id,quantity,unit_price,currency,expected_date,ordered_at,provenance)
  SELECT r.id,l.id,l.material_id,NEW.id,NEW.quantity,
    CASE WHEN p.ordered_at IS NOT NULL THEN l.price ELSE NULL END,
    p.currency,CASE WHEN p.ordered_at IS NOT NULL THEN NULLIF(p.expected_date,'') ELSE NULL END,
    p.ordered_at,CASE WHEN p.ordered_at IS NOT NULL THEN 'Recorded' ELSE 'Legacy order' END
  FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
  JOIN purchase_order_items l ON l.order_id=p.id
  JOIN inventory_balances b ON b.id=NEW.balance_id AND b.material_id=l.material_id
  WHERE NEW.source=p.number AND NEW.operation_key=(r.operation_key || ':' || l.id::text)
  ON CONFLICT (receipt_id,purchase_item_id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER snapshot_purchase_movement AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION record_receipt_snapshot_from_movement();
