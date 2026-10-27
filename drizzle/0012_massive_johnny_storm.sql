ALTER TABLE "return_receipts" ADD COLUMN "actual_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "return_receipts" ADD COLUMN "actual_product_snapshot" text;--> statement-breakpoint
-- Earlier receipts restocked the source SKU by definition; preserve that identity
-- while enriching metadata. The table lock keeps the immutable-history guard safe.
ALTER TABLE return_receipts DISABLE TRIGGER return_receipt_immutable;
--> statement-breakpoint
UPDATE return_receipts p SET actual_variant_id=l.variant_id,actual_product_snapshot=i.product_snapshot FROM return_items i JOIN shipment_items si ON si.id=i.shipment_item_id JOIN sales_order_items l ON l.id=si.sale_item_id WHERE p.return_item_id=i.id;
--> statement-breakpoint
ALTER TABLE return_receipts ENABLE TRIGGER return_receipt_immutable;
--> statement-breakpoint
ALTER TABLE return_receipts ALTER COLUMN actual_variant_id SET NOT NULL, ALTER COLUMN actual_product_snapshot SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_actual_variant_id_product_variants_id_fk" FOREIGN KEY ("actual_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_return_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE received integer; variant uuid;
BEGIN
 SELECT p.quantity,p.actual_variant_id INTO received,variant FROM return_receipts p WHERE p.id=NEW.receipt_id;
 IF received IS NULL OR NEW.sellable+NEW.quarantined<>received THEN RAISE EXCEPTION 'Inspection must reconcile every received unit'; END IF;
 IF NEW.sellable>0 THEN
  IF NEW.condition<>'Unworn / sellable' OR NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id AND b.variant_id=variant AND m.quantity=NEW.sellable AND m.reserved_delta=0) THEN RAISE EXCEPTION 'Sellable restock must match actual inspected product identity'; END IF;
 ELSIF NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'Quarantine cannot enter available stock'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_return_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held integer; prior integer; variant uuid;
BEGIN
 SELECT i.quarantined,p.actual_variant_id INTO held,variant FROM return_inspections i JOIN return_receipts p ON p.id=i.receipt_id WHERE i.id=NEW.inspection_id FOR UPDATE OF i;
 SELECT coalesce(sum(quantity),0) INTO prior FROM return_quarantine_dispositions WHERE inspection_id=NEW.inspection_id;
 IF held IS NULL OR prior+NEW.quantity>held THEN RAISE EXCEPTION 'Quarantine disposition exceeds held units'; END IF;
 IF NEW.kind='Restock' AND NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id AND b.variant_id=variant AND m.quantity=NEW.quantity AND m.reserved_delta=0) OR NEW.kind='Scrap' AND NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'Quarantine disposition has an invalid actual-SKU inventory posting'; END IF;
 RETURN NEW;
END $$;
