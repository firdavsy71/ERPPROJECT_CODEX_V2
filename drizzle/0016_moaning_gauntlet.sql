CREATE TABLE "procurement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "procurement_allocation_nonnegative" CHECK ("procurement_allocations"."amount">=0)
);
--> statement-breakpoint
CREATE TABLE "procurement_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"notes" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_expenses_reference_unique" UNIQUE("reference"),
	CONSTRAINT "procurement_expense_positive" CHECK ("procurement_expenses"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "procurement_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"accepted" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rejected" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text NOT NULL,
	"roll_id" uuid,
	"movement_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_inspection_quantities" CHECK ("procurement_inspections"."accepted" >= 0 and "procurement_inspections"."rejected" >= 0 and "procurement_inspections"."accepted"+"procurement_inspections"."rejected" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 2),
	"currency" text NOT NULL,
	"expected_date" text,
	"ordered_at" timestamp with time zone,
	"provenance" text DEFAULT 'Recorded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_items_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "receipt_item_quantity_positive" CHECK ("purchase_receipt_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_quality_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"inspection_id" uuid,
	"description" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "ordered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "procurement_allocations" ADD CONSTRAINT "procurement_allocations_expense_id_procurement_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."procurement_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_allocations" ADD CONSTRAINT "procurement_allocations_receipt_item_id_purchase_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."purchase_receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_expenses" ADD CONSTRAINT "procurement_expenses_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_expenses" ADD CONSTRAINT "procurement_expenses_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_inspections" ADD CONSTRAINT "procurement_inspections_receipt_item_id_purchase_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."purchase_receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_inspections" ADD CONSTRAINT "procurement_inspections_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_inspections" ADD CONSTRAINT "procurement_inspections_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_inspections" ADD CONSTRAINT "procurement_inspections_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_incidents" ADD CONSTRAINT "supplier_quality_incidents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_incidents" ADD CONSTRAINT "supplier_quality_incidents_receipt_item_id_purchase_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."purchase_receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_incidents" ADD CONSTRAINT "supplier_quality_incidents_inspection_id_procurement_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."procurement_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_incidents" ADD CONSTRAINT "supplier_quality_incidents_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_expense_line" ON "procurement_allocations" USING btree ("expense_id","receipt_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_item_once" ON "purchase_receipt_items" USING btree ("receipt_id","purchase_item_id");
--> statement-breakpoint
INSERT INTO purchase_receipt_items (receipt_id,purchase_item_id,material_id,movement_id,quantity,unit_price,currency,expected_date,ordered_at,provenance,created_at)
SELECT r.id,l.id,l.material_id,m.id,m.quantity,NULL,p.currency,NULL,NULL,'Recovered',r.created_at
FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
JOIN purchase_order_items l ON l.order_id=p.id
JOIN inventory_movements m ON m.operation_key=(r.operation_key || ':' || l.id::text)
JOIN inventory_balances b ON b.id=m.balance_id AND b.material_id=l.material_id
WHERE m.reason='Purchase receipt' AND m.source=p.number AND m.quantity>0;
--> statement-breakpoint
CREATE FUNCTION immutable_procurement_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Procurement history is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_immutable BEFORE UPDATE OR DELETE ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE TRIGGER receipt_item_immutable BEFORE UPDATE OR DELETE ON purchase_receipt_items FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE TRIGGER procurement_inspection_immutable BEFORE UPDATE OR DELETE ON procurement_inspections FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE TRIGGER procurement_expense_immutable BEFORE UPDATE OR DELETE ON procurement_expenses FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE TRIGGER procurement_allocation_immutable BEFORE UPDATE OR DELETE ON procurement_allocations FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE TRIGGER supplier_incident_immutable BEFORE UPDATE OR DELETE ON supplier_quality_incidents FOR EACH ROW EXECUTE FUNCTION immutable_procurement_record();
--> statement-breakpoint
CREATE UNIQUE INDEX procurement_rejection_movement_once ON procurement_inspections(movement_id) WHERE movement_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION guard_purchase_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='purchase_orders' THEN
    IF OLD.status <> 'Draft' AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.expected_date IS DISTINCT FROM OLD.expected_date OR NEW.ordered_at IS DISTINCT FROM OLD.ordered_at OR NEW.total IS DISTINCT FROM OLD.total) THEN RAISE EXCEPTION 'Ordered purchase terms are immutable'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id=OLD.order_id AND p.status <> 'Draft')
      AND (NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.price IS DISTINCT FROM OLD.price) THEN RAISE EXCEPTION 'Ordered supplier prices and quantities are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_purchase_terms BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION guard_purchase_terms();
--> statement-breakpoint
CREATE TRIGGER immutable_purchase_line_terms BEFORE UPDATE ON purchase_order_items FOR EACH ROW EXECUTE FUNCTION guard_purchase_terms();
--> statement-breakpoint
CREATE FUNCTION guard_receipt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provenance<>'Recorded' OR NOT EXISTS (
    SELECT 1 FROM purchase_receipts r JOIN purchase_orders p ON p.id=r.order_id
    JOIN purchase_order_items l ON l.id=NEW.purchase_item_id AND l.order_id=p.id
    JOIN inventory_movements m ON m.id=NEW.movement_id
    JOIN inventory_balances b ON b.id=m.balance_id
    WHERE r.id=NEW.receipt_id AND l.material_id=NEW.material_id AND b.material_id=l.material_id
      AND m.quantity=NEW.quantity AND m.reason='Purchase receipt' AND m.source=p.number
      AND m.operation_key=(r.operation_key || ':' || l.id::text)
      AND NEW.unit_price=l.price AND NEW.currency=p.currency
      AND NEW.expected_date IS NOT DISTINCT FROM NULLIF(p.expected_date,'')
      AND NEW.ordered_at IS NOT DISTINCT FROM p.ordered_at
  ) THEN RAISE EXCEPTION 'Receipt snapshot must match purchase and inventory movement'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER receipt_snapshot_guard BEFORE INSERT ON purchase_receipt_items FOR EACH ROW EXECUTE FUNCTION guard_receipt_snapshot();
--> statement-breakpoint
CREATE FUNCTION guard_procurement_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item purchase_receipt_items%ROWTYPE; used numeric; is_tracked boolean;
BEGIN
  SELECT * INTO item FROM purchase_receipt_items WHERE id=NEW.receipt_item_id FOR UPDATE;
  SELECT COALESCE(sum(accepted+rejected),0) INTO used FROM procurement_inspections WHERE receipt_item_id=NEW.receipt_item_id;
  IF used+NEW.accepted+NEW.rejected>item.quantity OR length(trim(NEW.notes))=0 THEN RAISE EXCEPTION 'Inspection exceeds receipt or lacks findings'; END IF;
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
CREATE TRIGGER procurement_inspection_guard BEFORE INSERT ON procurement_inspections FOR EACH ROW EXECUTE FUNCTION guard_procurement_inspection();
--> statement-breakpoint
CREATE FUNCTION guard_procurement_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM procurement_expenses e JOIN purchase_receipt_items i ON i.receipt_id=e.receipt_id WHERE e.id=NEW.expense_id AND i.id=NEW.receipt_item_id AND i.currency=e.currency AND i.unit_price IS NOT NULL) THEN RAISE EXCEPTION 'Allocation must reference a priced line from the expense receipt'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_allocation_guard BEFORE INSERT ON procurement_allocations FOR EACH ROW EXECUTE FUNCTION guard_procurement_allocation();
--> statement-breakpoint
CREATE FUNCTION check_procurement_allocation_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_expense_id uuid; expected numeric; allocated numeric;
BEGIN
  IF TG_TABLE_NAME='procurement_expenses' THEN target_expense_id=NEW.id; ELSE target_expense_id=NEW.expense_id; END IF;
  SELECT amount INTO expected FROM procurement_expenses WHERE id=target_expense_id;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM procurement_allocations WHERE procurement_allocations.expense_id=target_expense_id;
  IF expected IS DISTINCT FROM allocated THEN RAISE EXCEPTION 'Expense allocation must equal the expense amount'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER procurement_expense_total AFTER INSERT ON procurement_expenses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_procurement_allocation_total();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER procurement_allocation_total AFTER INSERT ON procurement_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_procurement_allocation_total();
