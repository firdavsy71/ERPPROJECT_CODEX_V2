CREATE TABLE "procurement_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"roll_id" uuid,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"notes" text NOT NULL,
	"movement_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_dispositions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "procurement_dispositions_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "procurement_disposition_valid" CHECK ("procurement_dispositions"."quantity">0 and "procurement_dispositions"."kind" in ('Supplier Return','Scrap'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_procurement_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item purchase_receipt_items%ROWTYPE; used numeric; is_tracked boolean;
BEGIN
  SELECT * INTO item FROM purchase_receipt_items WHERE id=NEW.receipt_item_id FOR UPDATE;
  SELECT COALESCE(sum(accepted+rejected),0) INTO used FROM procurement_inspections WHERE receipt_item_id=NEW.receipt_item_id;
  IF used+NEW.accepted+NEW.rejected>item.quantity OR length(trim(NEW.notes))=0 THEN RAISE EXCEPTION 'Inspection exceeds receipt or lacks findings'; END IF;
  IF item.qc_required THEN
    IF NEW.accepted>0 AND NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_movements original ON original.id=item.movement_id WHERE m.id=NEW.movement_id AND m.balance_id=original.balance_id AND m.quantity=0 AND m.reserved_delta=0 AND m.held_delta=-NEW.accepted AND m.source=item.id::text AND m.reason='Incoming QC acceptance') THEN RAISE EXCEPTION 'Accepted material requires matching hold release'; END IF;
    IF NEW.accepted=0 AND NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'No release without accepted material'; END IF;
    SELECT b.roll_tracked INTO is_tracked FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=item.movement_id;
    IF is_tracked AND NOT EXISTS(SELECT 1 FROM fabric_rolls f WHERE f.id=NEW.roll_id AND f.purchase_receipt_id=item.receipt_id AND f.purchase_order_item_id=item.purchase_item_id) THEN RAISE EXCEPTION 'Inspection must identify received roll'; END IF;
    IF NOT is_tracked AND NEW.roll_id IS NOT NULL THEN RAISE EXCEPTION 'Material is not roll tracked'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.rejected=0 THEN
    IF NEW.movement_id IS NOT NULL OR NEW.roll_id IS NOT NULL THEN RAISE EXCEPTION 'No rejection movement without rejected quantity'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id AND b.material_id=item.material_id AND m.quantity=-NEW.rejected AND m.source='supplier inspection' AND m.reason='Supplier quality rejection') THEN RAISE EXCEPTION 'Rejected material requires a matching stock movement'; END IF;
    SELECT b.roll_tracked INTO is_tracked FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id;
    IF is_tracked AND NOT EXISTS (SELECT 1 FROM fabric_rolls f JOIN fabric_roll_movements fm ON fm.roll_id=f.id WHERE f.id=NEW.roll_id AND f.purchase_receipt_id=item.receipt_id AND f.purchase_order_item_id=item.purchase_item_id AND fm.inventory_movement_id=NEW.movement_id AND fm.quantity=-NEW.rejected) THEN RAISE EXCEPTION 'Rejected fabric must be traced to the received roll'; END IF;
    IF NOT is_tracked AND NEW.roll_id IS NOT NULL THEN RAISE EXCEPTION 'Material is not roll tracked'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION protect_procurement_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Procurement dispositions are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_disposition_immutable BEFORE UPDATE OR DELETE ON procurement_dispositions FOR EACH ROW EXECUTE FUNCTION protect_procurement_disposition();
--> statement-breakpoint
CREATE FUNCTION validate_procurement_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item purchase_receipt_items%ROWTYPE; rejected numeric; disposed numeric;
BEGIN
 SELECT * INTO item FROM purchase_receipt_items WHERE id=NEW.receipt_item_id FOR UPDATE;
 IF NOT item.qc_required THEN RAISE EXCEPTION 'Disposition requires held receipt'; END IF;
 SELECT coalesce(sum(q.rejected),0) INTO rejected FROM procurement_inspections q WHERE q.receipt_item_id=item.id AND (NEW.roll_id IS NULL OR q.roll_id=NEW.roll_id);
 SELECT coalesce(sum(d.quantity),0) INTO disposed FROM procurement_dispositions d WHERE d.receipt_item_id=item.id AND (NEW.roll_id IS NULL OR d.roll_id=NEW.roll_id);
 IF NEW.quantity+disposed>rejected THEN RAISE EXCEPTION 'Disposition exceeds rejected material'; END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_movements original ON original.id=item.movement_id WHERE m.id=NEW.movement_id AND m.balance_id=original.balance_id AND m.quantity=-NEW.quantity AND m.reserved_delta=0 AND m.held_delta=-NEW.quantity AND m.source=item.id::text AND m.reason='Rejected procurement disposition') THEN RAISE EXCEPTION 'Disposition requires matching stock and hold movement'; END IF;
 IF EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=item.movement_id AND b.roll_tracked) AND NOT EXISTS(SELECT 1 FROM fabric_rolls f JOIN fabric_roll_movements fm ON fm.roll_id=f.id WHERE f.id=NEW.roll_id AND f.purchase_receipt_id=item.receipt_id AND f.purchase_order_item_id=item.purchase_item_id AND fm.inventory_movement_id=NEW.movement_id AND fm.quantity=-NEW.quantity) THEN RAISE EXCEPTION 'Disposition requires received roll trace'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_disposition_guard BEFORE INSERT ON procurement_dispositions FOR EACH ROW EXECUTE FUNCTION validate_procurement_disposition();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_receipt_snapshot_from_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason <> 'Purchase receipt' OR NEW.quantity <= 0 THEN RETURN NEW; END IF;
  INSERT INTO purchase_receipt_items (receipt_id,purchase_item_id,material_id,movement_id,quantity,unit_price,currency,expected_date,ordered_at,provenance,qc_required)
  SELECT r.id,l.id,l.material_id,NEW.id,NEW.quantity,
    CASE WHEN p.ordered_at IS NOT NULL THEN l.price ELSE NULL END,
    p.currency,CASE WHEN p.ordered_at IS NOT NULL THEN NULLIF(p.expected_date,'') ELSE NULL END,
    p.ordered_at,CASE WHEN p.ordered_at IS NOT NULL THEN 'Recorded' ELSE 'Legacy order' END,
    NEW.held_delta=NEW.quantity
  FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
  JOIN purchase_order_items l ON l.order_id=p.id
  JOIN inventory_balances b ON b.id=NEW.balance_id AND b.material_id=l.material_id
  WHERE NEW.source=p.number AND NEW.operation_key=(r.operation_key || ':' || l.id::text)
  ON CONFLICT (receipt_id,purchase_item_id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE "inventory_balances" DROP CONSTRAINT "valid_balance";--> statement-breakpoint
ALTER TABLE "fabric_rolls" DROP CONSTRAINT "fabric_roll_quantities";--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "held" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD COLUMN "held_length" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD COLUMN "held_segments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "held_delta" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN "qc_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ALTER COLUMN "qc_required" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "procurement_dispositions" ADD CONSTRAINT "procurement_dispositions_receipt_item_id_purchase_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."purchase_receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_dispositions" ADD CONSTRAINT "procurement_dispositions_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_dispositions" ADD CONSTRAINT "procurement_dispositions_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_dispositions" ADD CONSTRAINT "procurement_dispositions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "valid_balance" CHECK ("inventory_balances"."on_hand" >= 0 and "inventory_balances"."reserved" >= 0 and "inventory_balances"."held" >= 0 and "inventory_balances"."reserved" + "inventory_balances"."held" <= "inventory_balances"."on_hand");--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_roll_quantities" CHECK ("fabric_rolls"."width_cm">0 and "fabric_rolls"."received_length">0 and "fabric_rolls"."physical_length">="fabric_rolls"."received_length" and "fabric_rolls"."remaining_length">=0 and "fabric_rolls"."remaining_length"<="fabric_rolls"."physical_length" and "fabric_rolls"."reserved_length">=0 and "fabric_rolls"."held_length">=0 and "fabric_rolls"."reserved_length"+"fabric_rolls"."held_length"<="fabric_rolls"."remaining_length");
