CREATE TABLE "outsourcing_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outsourcing_cost_positive" CHECK ("outsourcing_costs"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "outsourcing_custody" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"roll_id" uuid,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"consumed" numeric(18, 4) DEFAULT '0' NOT NULL,
	"returned" numeric(18, 4) DEFAULT '0' NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"movement_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_quantities" CHECK ("outsourcing_custody"."quantity">0 and "outsourcing_custody"."consumed">=0 and "outsourcing_custody"."returned">=0 and "outsourcing_custody"."consumed"+"outsourcing_custody"."returned"<="outsourcing_custody"."quantity")
);
--> statement-breakpoint
CREATE TABLE "outsourcing_material_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"custody_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reference" text NOT NULL,
	"returned_roll_id" uuid,
	"movement_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_event_kind" CHECK ("outsourcing_material_events"."kind" in ('Consumed','Returned') and "outsourcing_material_events"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "outsourcing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"manufacturing_order_id" uuid NOT NULL,
	"subcontractor_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"due_date" text NOT NULL,
	"currency" text NOT NULL,
	"unit_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"produced" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outsourcing_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "outsourcing_status" CHECK ("outsourcing_orders"."status" in ('Draft','Active','Completed','Cancelled') and "outsourcing_orders"."produced">=0 and "outsourcing_orders"."unit_cost">=0)
);
--> statement-breakpoint
CREATE TABLE "outsourcing_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"accepted" integer NOT NULL,
	"rejected" integer NOT NULL,
	"quality_results" jsonb NOT NULL,
	"branding_check" text,
	"notes" text NOT NULL,
	"movement_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outsourcing_receipt_quantity" CHECK ("outsourcing_receipts"."accepted">=0 and "outsourcing_receipts"."rejected">=0 and "outsourcing_receipts"."accepted"+"outsourcing_receipts"."rejected">0)
);
--> statement-breakpoint
CREATE TABLE "subcontractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"specialties" text NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcontractors_supplier_id_unique" UNIQUE("supplier_id"),
	CONSTRAINT "subcontractor_capacity" CHECK ("subcontractors"."capacity">=0)
);
--> statement-breakpoint
ALTER TABLE "outsourcing_costs" ADD CONSTRAINT "outsourcing_costs_order_id_outsourcing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."outsourcing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_costs" ADD CONSTRAINT "outsourcing_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_custody" ADD CONSTRAINT "outsourcing_custody_order_id_outsourcing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."outsourcing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_custody" ADD CONSTRAINT "outsourcing_custody_reservation_id_production_material_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."production_material_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_custody" ADD CONSTRAINT "outsourcing_custody_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_custody" ADD CONSTRAINT "outsourcing_custody_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_custody" ADD CONSTRAINT "outsourcing_custody_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_material_events" ADD CONSTRAINT "outsourcing_material_events_custody_id_outsourcing_custody_id_fk" FOREIGN KEY ("custody_id") REFERENCES "public"."outsourcing_custody"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_material_events" ADD CONSTRAINT "outsourcing_material_events_returned_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("returned_roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_material_events" ADD CONSTRAINT "outsourcing_material_events_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_material_events" ADD CONSTRAINT "outsourcing_material_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_orders" ADD CONSTRAINT "outsourcing_orders_manufacturing_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_orders" ADD CONSTRAINT "outsourcing_orders_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_orders" ADD CONSTRAINT "outsourcing_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_receipts" ADD CONSTRAINT "outsourcing_receipts_order_id_outsourcing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."outsourcing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_receipts" ADD CONSTRAINT "outsourcing_receipts_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outsourcing_receipts" ADD CONSTRAINT "outsourcing_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outsourcing_cost_reference" ON "outsourcing_costs" USING btree ("order_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "outsourcing_issue_reference" ON "outsourcing_custody" USING btree ("order_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "custody_document_reference" ON "outsourcing_material_events" USING btree ("custody_id","kind","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_outsourcing_per_manufacturing" ON "outsourcing_orders" USING btree ("manufacturing_order_id") WHERE "outsourcing_orders"."status"<>'Cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "outsourcing_receipt_reference" ON "outsourcing_receipts" USING btree ("order_id","reference");
--> statement-breakpoint
CREATE INDEX outsourcing_custody_reservation ON outsourcing_custody(reservation_id);
--> statement-breakpoint
CREATE FUNCTION guard_outsourcing_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Outsourcing documents are immutable; record a new document instead'; END $$;
--> statement-breakpoint
CREATE TRIGGER outsourcing_receipt_immutable BEFORE UPDATE OR DELETE ON outsourcing_receipts FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_document();
--> statement-breakpoint
CREATE TRIGGER outsourcing_event_immutable BEFORE UPDATE OR DELETE ON outsourcing_material_events FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_document();
--> statement-breakpoint
CREATE TRIGGER outsourcing_cost_immutable BEFORE UPDATE OR DELETE ON outsourcing_costs FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_document();
--> statement-breakpoint
CREATE FUNCTION guard_outsourcing_custody() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r production_material_reservations; o outsourcing_orders; m inventory_movements;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Material custody history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.order_id<>OLD.order_id OR NEW.reservation_id<>OLD.reservation_id OR NEW.roll_id IS DISTINCT FROM OLD.roll_id OR NEW.quantity<>OLD.quantity OR NEW.segments<>OLD.segments OR NEW.movement_id<>OLD.movement_id OR NEW.reference<>OLD.reference OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.consumed<OLD.consumed OR NEW.returned<OLD.returned) THEN RAISE EXCEPTION 'Issued custody identity and history are immutable'; END IF;
 SELECT * INTO r FROM production_material_reservations WHERE id=NEW.reservation_id;
 SELECT * INTO o FROM outsourcing_orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT * INTO m FROM inventory_movements WHERE id=NEW.movement_id;
 IF o.status<>'Active' OR r.order_id IS DISTINCT FROM o.manufacturing_order_id OR m.balance_id IS DISTINCT FROM r.balance_id OR m.quantity<>-NEW.quantity OR m.reserved_delta<>-NEW.quantity THEN RAISE EXCEPTION 'Custody issue must match the allocated material and physical transfer movement'; END IF;
 IF NEW.roll_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fabric_rolls f WHERE f.id=NEW.roll_id AND f.balance_id=r.balance_id) THEN RAISE EXCEPTION 'Custody roll must match material balance'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outsourcing_custody_guard BEFORE INSERT OR UPDATE OR DELETE ON outsourcing_custody FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_custody();
--> statement-breakpoint
CREATE FUNCTION reconcile_outsourcing_custody() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c outsourcing_custody; used numeric; back numeric;
BEGIN
 IF TG_TABLE_NAME='outsourcing_custody' THEN SELECT * INTO c FROM outsourcing_custody WHERE id=NEW.id; ELSE SELECT * INTO c FROM outsourcing_custody WHERE id=NEW.custody_id; END IF;
 SELECT coalesce(sum(quantity) FILTER(WHERE kind='Consumed'),0),coalesce(sum(quantity) FILTER(WHERE kind='Returned'),0) INTO used,back FROM outsourcing_material_events WHERE custody_id=c.id;
 IF used<>c.consumed OR back<>c.returned THEN RAISE EXCEPTION 'Custody quantities do not reconcile with settlement documents'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER outsourcing_custody_reconcile AFTER INSERT OR UPDATE ON outsourcing_custody DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_outsourcing_custody();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER outsourcing_event_reconcile AFTER INSERT ON outsourcing_material_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_outsourcing_custody();
--> statement-breakpoint
CREATE FUNCTION guard_outsourcing_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o outsourcing_orders; m manufacturing_orders; posted inventory_movements; delivered integer;
BEGIN
 SELECT * INTO o FROM outsourcing_orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT * INTO m FROM manufacturing_orders WHERE id=o.manufacturing_order_id;
 SELECT coalesce(sum(accepted+rejected),0) INTO delivered FROM outsourcing_receipts WHERE order_id=o.id;
 IF o.status<>'Active' OR delivered+NEW.accepted+NEW.rejected>o.produced OR o.produced>m.quantity THEN RAISE EXCEPTION 'Receipt exceeds reported subcontractor production'; END IF;
 IF NEW.accepted>0 THEN
  SELECT * INTO posted FROM inventory_movements WHERE id=NEW.movement_id;
  IF posted.quantity IS DISTINCT FROM NEW.accepted OR posted.reserved_delta<>0 OR NOT EXISTS(SELECT 1 FROM inventory_balances b WHERE b.id=posted.balance_id AND b.variant_id=m.variant_id AND b.warehouse_id=m.warehouse_id) THEN RAISE EXCEPTION 'Accepted receipt must match a finished goods inventory movement'; END IF;
 ELSE IF NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'Rejected goods cannot enter saleable inventory'; END IF; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outsourcing_receipt_guard BEFORE INSERT ON outsourcing_receipts FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_receipt();
--> statement-breakpoint
CREATE FUNCTION guard_outsourcing_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m manufacturing_orders; delivered integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outsourcing order history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.manufacturing_order_id<>OLD.manufacturing_order_id OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.number<>OLD.number THEN RAISE EXCEPTION 'Outsourcing assignment is immutable'; END IF;
  IF OLD.status<>'Draft' AND (NEW.subcontractor_id<>OLD.subcontractor_id OR NEW.due_date<>OLD.due_date OR NEW.currency<>OLD.currency OR NEW.unit_cost<>OLD.unit_cost OR NEW.notes<>OLD.notes) THEN RAISE EXCEPTION 'Activated outsourcing terms are immutable'; END IF;
  IF OLD.status IN ('Completed','Cancelled') OR NEW.produced<OLD.produced OR (OLD.status='Active' AND NEW.status NOT IN ('Active','Completed')) OR (OLD.status='Draft' AND NEW.status NOT IN ('Draft','Active','Cancelled')) THEN RAISE EXCEPTION 'Invalid outsourcing state transition'; END IF;
 END IF;
 SELECT * INTO m FROM manufacturing_orders WHERE id=NEW.manufacturing_order_id;
 IF NEW.produced>m.quantity THEN RAISE EXCEPTION 'Production progress exceeds assigned quantity'; END IF;
 IF NEW.status='Completed' THEN
  SELECT coalesce(sum(accepted+rejected),0) INTO delivered FROM outsourcing_receipts WHERE order_id=NEW.id;
  IF delivered<>m.quantity OR EXISTS(SELECT 1 FROM outsourcing_custody c WHERE c.order_id=NEW.id AND c.consumed+c.returned<>c.quantity) THEN RAISE EXCEPTION 'Deliveries and material custody must reconcile before completion'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outsourcing_order_guard BEFORE INSERT OR UPDATE OR DELETE ON outsourcing_orders FOR EACH ROW EXECUTE FUNCTION guard_outsourcing_order();
