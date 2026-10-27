CREATE TABLE "fabric_defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roll_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"start_meter" numeric(18, 4) DEFAULT '0' NOT NULL,
	"end_meter" numeric(18, 4) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_defects_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "fabric_defect_range" CHECK ("fabric_defects"."start_meter">=0 and "fabric_defects"."end_meter">"fabric_defects"."start_meter" and length(trim("fabric_defects"."description"))>0)
);
--> statement-breakpoint
CREATE TABLE "fabric_roll_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roll_id" uuid NOT NULL,
	"inventory_movement_id" uuid,
	"manufacturing_order_id" uuid,
	"material_reservation_id" uuid,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved_delta" numeric(18, 4) DEFAULT '0' NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_roll_movements_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "fabric_roll_movement_nonempty" CHECK ("fabric_roll_movements"."quantity"<>0 or "fabric_roll_movements"."reserved_delta"<>0)
);
--> statement-breakpoint
CREATE TABLE "fabric_roll_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roll_id" uuid NOT NULL,
	"manufacturing_order_id" uuid NOT NULL,
	"material_reservation_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"consumed" numeric(18, 4) DEFAULT '0' NOT NULL,
	"released" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_roll_reservation_quantities" CHECK ("fabric_roll_reservations"."quantity">0 and "fabric_roll_reservations"."consumed">=0 and "fabric_roll_reservations"."released">=0 and "fabric_roll_reservations"."consumed"+"fabric_roll_reservations"."released"<="fabric_roll_reservations"."quantity")
);
--> statement-breakpoint
CREATE TABLE "fabric_rolls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_id" uuid NOT NULL,
	"roll_number" text NOT NULL,
	"supplier_id" uuid,
	"purchase_receipt_id" uuid,
	"purchase_order_item_id" uuid,
	"supplier_batch" text,
	"supplier_lot" text,
	"color" text NOT NULL,
	"composition" text NOT NULL,
	"width_cm" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received_length" numeric(18, 4) DEFAULT '0' NOT NULL,
	"physical_length" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remaining_length" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved_length" numeric(18, 4) DEFAULT '0' NOT NULL,
	"usable_segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_location" text NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_rolls_roll_number_unique" UNIQUE("roll_number"),
	CONSTRAINT "fabric_roll_quantities" CHECK ("fabric_rolls"."width_cm">0 and "fabric_rolls"."received_length">0 and "fabric_rolls"."physical_length">="fabric_rolls"."received_length" and "fabric_rolls"."remaining_length">=0 and "fabric_rolls"."remaining_length"<="fabric_rolls"."physical_length" and "fabric_rolls"."reserved_length">=0 and "fabric_rolls"."reserved_length"<="fabric_rolls"."remaining_length"),
	CONSTRAINT "fabric_roll_identity" CHECK (length(trim("fabric_rolls"."roll_number"))>0 and length(trim("fabric_rolls"."color"))>0 and length(trim("fabric_rolls"."composition"))>0 and length(trim("fabric_rolls"."storage_location"))>0),
	CONSTRAINT "fabric_roll_receipt_pair" CHECK (("fabric_rolls"."purchase_receipt_id" is null)=("fabric_rolls"."purchase_order_item_id" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "roll_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fabric_defects" ADD CONSTRAINT "fabric_defects_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_defects" ADD CONSTRAINT "fabric_defects_movement_id_fabric_roll_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."fabric_roll_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_defects" ADD CONSTRAINT "fabric_defects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_movements" ADD CONSTRAINT "fabric_roll_movements_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_movements" ADD CONSTRAINT "fabric_roll_movements_inventory_movement_id_inventory_movements_id_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_movements" ADD CONSTRAINT "fabric_roll_movements_manufacturing_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_movements" ADD CONSTRAINT "fabric_roll_movements_material_reservation_id_production_material_reservations_id_fk" FOREIGN KEY ("material_reservation_id") REFERENCES "public"."production_material_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_movements" ADD CONSTRAINT "fabric_roll_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_reservations" ADD CONSTRAINT "fabric_roll_reservations_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_reservations" ADD CONSTRAINT "fabric_roll_reservations_manufacturing_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_roll_reservations" ADD CONSTRAINT "fabric_roll_reservations_material_reservation_id_production_material_reservations_id_fk" FOREIGN KEY ("material_reservation_id") REFERENCES "public"."production_material_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_balance_id_inventory_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fabric_roll_material_reservation" ON "fabric_roll_reservations" USING btree ("roll_id","material_reservation_id");
--> statement-breakpoint
CREATE INDEX fabric_roll_balance ON fabric_rolls(balance_id);
--> statement-breakpoint
CREATE INDEX fabric_roll_movement_roll ON fabric_roll_movements(roll_id);
--> statement-breakpoint
CREATE INDEX fabric_roll_movement_inventory ON fabric_roll_movements(inventory_movement_id);
--> statement-breakpoint
CREATE INDEX fabric_roll_reservation_order ON fabric_roll_reservations(manufacturing_order_id);
--> statement-breakpoint
-- Ranges are sorted, non-overlapping physical meter coordinates. Use numeric,
-- never floating point, for both range arithmetic and inventory reconciliation.
CREATE FUNCTION fabric_segment_length(parts jsonb, physical_limit numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part jsonb; a numeric; b numeric; previous_end numeric := 0; total numeric := 0;
BEGIN
 IF jsonb_typeof(parts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Fabric segments must be an array'; END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(parts) LOOP
  IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR NOT (part ? 'start' AND part ? 'end')
     OR jsonb_typeof(part->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(part->'end') IS DISTINCT FROM 'string'
     OR (part->>'start') !~ '^[0-9]+([.][0-9]{1,4})?$' OR (part->>'end') !~ '^[0-9]+([.][0-9]{1,4})?$'
  THEN RAISE EXCEPTION 'Fabric segment coordinates must be nonnegative decimal strings with at most four places'; END IF;
  a := (part->>'start')::numeric; b := (part->>'end')::numeric;
  IF a < previous_end OR b <= a OR b > physical_limit THEN RAISE EXCEPTION 'Fabric segments overlap or exceed physical length'; END IF;
  total := total + b - a; previous_end := b;
 END LOOP;
 RETURN total;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_fabric_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material_unit text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.roll_tracked AND
    (NOT NEW.roll_tracked OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.warehouse_id<>OLD.warehouse_id OR NEW.variant_id IS DISTINCT FROM OLD.variant_id)
 THEN RAISE EXCEPTION 'Roll tracking and its stock identity cannot be removed or changed'; END IF;
 IF NEW.roll_tracked THEN
  IF NEW.material_id IS NULL OR NEW.variant_id IS NOT NULL THEN RAISE EXCEPTION 'Roll tracking requires raw material stock'; END IF;
  SELECT unit INTO material_unit FROM materials WHERE id=NEW.material_id FOR SHARE;
  IF material_unit IS DISTINCT FROM 'Meters' THEN RAISE EXCEPTION 'Roll tracking requires a material measured in Meters'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_balance_identity BEFORE INSERT OR UPDATE ON inventory_balances FOR EACH ROW EXECUTE FUNCTION guard_fabric_balance();
--> statement-breakpoint
CREATE FUNCTION guard_fabric_material_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS(SELECT 1 FROM inventory_balances WHERE material_id=OLD.id AND roll_tracked)
 THEN RAISE EXCEPTION 'The unit of a roll-tracked material is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_material_unit BEFORE UPDATE ON materials FOR EACH ROW EXECUTE FUNCTION guard_fabric_material_unit();
--> statement-breakpoint
CREATE FUNCTION guard_fabric_roll() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b inventory_balances;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric roll traceability records cannot be deleted'; END IF;
 SELECT * INTO b FROM inventory_balances WHERE id=NEW.balance_id FOR UPDATE;
 IF NOT b.roll_tracked THEN RAISE EXCEPTION 'Enable roll tracking before registering rolls'; END IF;
 IF TG_OP='UPDATE' AND
  (NEW.balance_id<>OLD.balance_id OR NEW.roll_number<>OLD.roll_number OR NEW.received_length<>OLD.received_length
   OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.purchase_receipt_id IS DISTINCT FROM OLD.purchase_receipt_id
   OR NEW.purchase_order_item_id IS DISTINCT FROM OLD.purchase_order_item_id OR NEW.supplier_batch IS DISTINCT FROM OLD.supplier_batch
   OR NEW.supplier_lot IS DISTINCT FROM OLD.supplier_lot OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
   OR NEW.physical_length<OLD.physical_length)
 THEN RAISE EXCEPTION 'Fabric roll provenance is immutable and physical length cannot shrink'; END IF;
 IF fabric_segment_length(NEW.usable_segments, NEW.physical_length)<>NEW.remaining_length
 THEN RAISE EXCEPTION 'Usable fabric segments must equal remaining roll length'; END IF;
 IF NEW.purchase_receipt_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM purchase_receipts r JOIN purchase_order_items l ON l.order_id=r.order_id
  JOIN purchase_orders p ON p.id=r.order_id WHERE r.id=NEW.purchase_receipt_id AND l.id=NEW.purchase_order_item_id
  AND l.material_id=b.material_id AND p.supplier_id=NEW.supplier_id
 ) THEN RAISE EXCEPTION 'Roll receipt must match its material, purchase line and supplier'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_roll_guard BEFORE INSERT OR UPDATE OR DELETE ON fabric_rolls FOR EACH ROW EXECUTE FUNCTION guard_fabric_roll();
--> statement-breakpoint
CREATE FUNCTION guard_fabric_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric reservation history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.roll_id<>OLD.roll_id OR NEW.manufacturing_order_id<>OLD.manufacturing_order_id
   OR NEW.material_reservation_id<>OLD.material_reservation_id OR NEW.quantity<>OLD.quantity
   OR NEW.consumed<OLD.consumed OR NEW.released<OLD.released OR NEW.created_at<>OLD.created_at)
 THEN RAISE EXCEPTION 'Fabric allocations are immutable except for consumption and release'; END IF;
 IF NOT EXISTS(SELECT 1 FROM fabric_rolls r JOIN production_material_reservations p ON p.balance_id=r.balance_id
   WHERE r.id=NEW.roll_id AND p.id=NEW.material_reservation_id AND p.order_id=NEW.manufacturing_order_id)
 THEN RAISE EXCEPTION 'Fabric allocation must match its manufacturing material reservation'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON fabric_roll_reservations FOR EACH ROW EXECUTE FUNCTION guard_fabric_reservation();
--> statement-breakpoint
CREATE FUNCTION guard_fabric_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r fabric_rolls;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Fabric roll movements are immutable'; END IF;
 SELECT * INTO r FROM fabric_rolls WHERE id=NEW.roll_id;
 IF fabric_segment_length(NEW.segments,r.physical_length)<>abs(NEW.quantity)
 THEN RAISE EXCEPTION 'Fabric movement segments must equal its absolute quantity'; END IF;
 IF NEW.inventory_movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.id=NEW.inventory_movement_id AND m.balance_id=r.balance_id)
 THEN RAISE EXCEPTION 'Fabric movement must reference the same stock balance'; END IF;
 IF (NEW.manufacturing_order_id IS NULL)<>(NEW.material_reservation_id IS NULL)
 THEN RAISE EXCEPTION 'Manufacturing fabric movements require the material reservation'; END IF;
 IF NEW.material_reservation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_material_reservations p WHERE p.id=NEW.material_reservation_id AND p.order_id=NEW.manufacturing_order_id AND p.balance_id=r.balance_id)
 THEN RAISE EXCEPTION 'Fabric movement must match its manufacturing material reservation'; END IF;
 IF NEW.inventory_movement_id IS NULL AND (NEW.quantity<=0 OR NEW.reserved_delta<>0 OR NEW.source<>'existing stock')
 THEN RAISE EXCEPTION 'Only opening stock allocation may omit an inventory movement'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON fabric_roll_movements FOR EACH ROW EXECUTE FUNCTION guard_fabric_movement();
--> statement-breakpoint
CREATE FUNCTION guard_fabric_defect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r fabric_rolls; m fabric_roll_movements;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Fabric defects are immutable write-off records'; END IF;
 SELECT * INTO r FROM fabric_rolls WHERE id=NEW.roll_id FOR UPDATE;
 SELECT * INTO m FROM fabric_roll_movements WHERE id=NEW.movement_id;
 IF NEW.end_meter>r.physical_length OR m.roll_id IS DISTINCT FROM NEW.roll_id
   OR m.quantity IS DISTINCT FROM -(NEW.end_meter-NEW.start_meter)
   OR m.segments IS DISTINCT FROM jsonb_build_array(jsonb_build_object('start',NEW.start_meter::text,'end',NEW.end_meter::text))
 THEN RAISE EXCEPTION 'Fabric defect must match its exact roll write-off segment'; END IF;
 IF EXISTS(SELECT 1 FROM fabric_defects d WHERE d.roll_id=NEW.roll_id AND d.start_meter<NEW.end_meter AND d.end_meter>NEW.start_meter)
 THEN RAISE EXCEPTION 'Fabric defects cannot overlap'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fabric_defect_guard BEFORE INSERT OR UPDATE OR DELETE ON fabric_defects FOR EACH ROW EXECUTE FUNCTION guard_fabric_defect();
--> statement-breakpoint
CREATE FUNCTION assert_fabric_balance(balance_id_to_check uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b inventory_balances; r fabric_rolls; remaining numeric; held numeric; ledger_quantity numeric; ledger_reserved numeric; positive_quantity numeric;
BEGIN
 SELECT * INTO b FROM inventory_balances WHERE id=balance_id_to_check FOR UPDATE;
 IF NOT FOUND OR NOT b.roll_tracked THEN RETURN; END IF;
 SELECT coalesce(sum(remaining_length),0),coalesce(sum(reserved_length),0) INTO remaining,held FROM fabric_rolls WHERE balance_id=b.id;
 IF remaining<>b.on_hand OR held<>b.reserved THEN RAISE EXCEPTION 'Fabric rolls do not reconcile with material inventory'; END IF;
 FOR r IN SELECT * FROM fabric_rolls WHERE balance_id=b.id LOOP
  SELECT coalesce(sum(quantity),0),coalesce(sum(reserved_delta),0),coalesce(sum(quantity) FILTER(WHERE quantity>0),0)
    INTO ledger_quantity,ledger_reserved,positive_quantity FROM fabric_roll_movements WHERE roll_id=r.id;
  SELECT coalesce(sum(quantity-consumed-released),0) INTO held FROM fabric_roll_reservations WHERE roll_id=r.id;
  IF ledger_quantity<>r.remaining_length OR ledger_reserved<>r.reserved_length OR held<>r.reserved_length OR positive_quantity<>r.physical_length
  THEN RAISE EXCEPTION 'Fabric roll counters, allocations and movement ledger do not reconcile'; END IF;
  -- Positive ranges may never be received twice; negative ranges may never be
  -- consumed or written off twice. Usable ranges cannot include removed fabric.
  IF EXISTS(SELECT 1 FROM fabric_roll_movements a JOIN fabric_roll_movements c ON c.roll_id=a.roll_id AND a.id<c.id
     CROSS JOIN LATERAL jsonb_array_elements(a.segments) x CROSS JOIN LATERAL jsonb_array_elements(c.segments) y
     WHERE a.roll_id=r.id AND sign(a.quantity)=sign(c.quantity)
     AND (x->>'start')::numeric<(y->>'end')::numeric AND (x->>'end')::numeric>(y->>'start')::numeric)
   OR EXISTS(SELECT 1 FROM fabric_roll_movements a CROSS JOIN LATERAL jsonb_array_elements(a.segments) x
     CROSS JOIN LATERAL jsonb_array_elements(r.usable_segments) y WHERE a.roll_id=r.id AND a.quantity<0
     AND (x->>'start')::numeric<(y->>'end')::numeric AND (x->>'end')::numeric>(y->>'start')::numeric)
  THEN RAISE EXCEPTION 'Fabric physical history overlaps or contains already removed sections'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM inventory_movements m JOIN fabric_roll_movements f ON f.inventory_movement_id=m.id
   WHERE m.balance_id=b.id GROUP BY m.id,m.quantity,m.reserved_delta
   HAVING sum(f.quantity)<>m.quantity OR sum(f.reserved_delta)<>m.reserved_delta)
 THEN RAISE EXCEPTION 'Fabric movement detail must reconcile with its inventory movement'; END IF;
 IF EXISTS(SELECT 1 FROM purchase_order_items p JOIN fabric_rolls fr ON fr.purchase_order_item_id=p.id
   WHERE fr.balance_id=b.id GROUP BY p.id,p.received HAVING sum(fr.received_length)>p.received)
 THEN RAISE EXCEPTION 'Registered fabric rolls exceed the received purchase quantity'; END IF;
END $$;
--> statement-breakpoint
-- Deferred checks allow aggregate stock and individual roll detail to be
-- updated in either order, but neither can commit without the other.
CREATE FUNCTION reconcile_fabric_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock_id uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_balances' THEN stock_id:=NEW.id;
 ELSIF TG_TABLE_NAME='fabric_rolls' THEN stock_id:=NEW.balance_id;
 ELSE SELECT balance_id INTO stock_id FROM fabric_rolls WHERE id=NEW.roll_id;
 END IF;
 PERFORM assert_fabric_balance(stock_id);
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_balance_reconciliation AFTER INSERT OR UPDATE ON inventory_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_stock();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_roll_reconciliation AFTER INSERT OR UPDATE ON fabric_rolls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_stock();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_reservation_reconciliation AFTER INSERT OR UPDATE ON fabric_roll_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_stock();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_movement_reconciliation AFTER INSERT ON fabric_roll_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_stock();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_defect_reconciliation AFTER INSERT ON fabric_defects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_stock();
--> statement-breakpoint
CREATE FUNCTION reconcile_fabric_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tracked boolean; q numeric; r numeric;
BEGIN
 SELECT roll_tracked INTO tracked FROM inventory_balances WHERE id=NEW.balance_id;
 IF tracked THEN
  SELECT coalesce(sum(quantity),0),coalesce(sum(reserved_delta),0) INTO q,r FROM fabric_roll_movements WHERE inventory_movement_id=NEW.id;
  IF q<>NEW.quantity OR r<>NEW.reserved_delta THEN RAISE EXCEPTION 'Roll-tracked inventory movements require exact fabric roll detail'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fabric_inventory_movement_reconciliation AFTER INSERT ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_fabric_inventory_movement();
--> statement-breakpoint
CREATE FUNCTION guard_tracked_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM inventory_balances WHERE id=OLD.balance_id AND roll_tracked)
   OR EXISTS(SELECT 1 FROM fabric_roll_movements WHERE inventory_movement_id=OLD.id)
 THEN RAISE EXCEPTION 'Roll-tracked inventory movement history is immutable'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM inventory_balances WHERE id=NEW.balance_id AND roll_tracked)
 THEN RAISE EXCEPTION 'Cannot move inventory history into a roll-tracked balance'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tracked_inventory_movement_history BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION guard_tracked_inventory_movement();
