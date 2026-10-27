CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"status" text NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"picked" integer DEFAULT 0 NOT NULL,
	"packed" integer DEFAULT 0 NOT NULL,
	"product_snapshot" text NOT NULL,
	CONSTRAINT "delivery_item_quantities" CHECK ("delivery_items"."quantity">0 and "delivery_items"."picked">=0 and "delivery_items"."packed">=0 and "delivery_items"."packed"<="delivery_items"."picked" and "delivery_items"."picked"<="delivery_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "delivery_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"shipment_id" uuid,
	"status" text DEFAULT 'Picking' NOT NULL,
	"customer_name" text NOT NULL,
	"address" text NOT NULL,
	"carrier" text NOT NULL,
	"vehicle" text DEFAULT '' NOT NULL,
	"driver" text DEFAULT '' NOT NULL,
	"tracking" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "delivery_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "delivery_orders_shipment_id_unique" UNIQUE("shipment_id"),
	CONSTRAINT "delivery_status" CHECK ("delivery_orders"."status" in ('Picking','Packed','Dispatched','In Transit','Delivered','Exception','Cancelled') and (("delivery_orders"."status" in ('Picking','Packed','Cancelled'))=("delivery_orders"."shipment_id" is null and "delivery_orders"."dispatched_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "delivery_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"pathname" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_proofs_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "delivery_proof_file" CHECK ("delivery_proofs"."bytes">0 and "delivery_proofs"."bytes"<=2097152 and "delivery_proofs"."mime" in ('image/png','image/jpeg','application/pdf'))
);
--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_delivery_orders_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_delivery_orders_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_sale_item_id_sales_order_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_delivery_orders_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_sale_line" ON "delivery_items" USING btree ("delivery_id","sale_item_id");
--> statement-breakpoint
CREATE INDEX delivery_sale_order ON delivery_orders(order_id);
--> statement-breakpoint
CREATE FUNCTION guard_delivery_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d delivery_orders;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Picking history cannot be deleted'; END IF;
 SELECT * INTO d FROM delivery_orders WHERE id=NEW.delivery_id;
 IF d.status<>'Picking' THEN RAISE EXCEPTION 'Picking quantities can only change while picking is open'; END IF;
 IF TG_OP='UPDATE' AND (NEW.delivery_id<>OLD.delivery_id OR NEW.sale_item_id<>OLD.sale_item_id OR NEW.quantity<>OLD.quantity OR NEW.product_snapshot<>OLD.product_snapshot) THEN RAISE EXCEPTION 'Picking assignment and planned quantity are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_order_items l WHERE l.id=NEW.sale_item_id AND l.order_id=d.order_id) THEN RAISE EXCEPTION 'Picking item must belong to the delivery sales order'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER delivery_item_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_items FOR EACH ROW EXECUTE FUNCTION guard_delivery_item();
--> statement-breakpoint
CREATE FUNCTION guard_delivery_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shipment shipments;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Delivery history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.number<>OLD.number OR NEW.order_id<>OLD.order_id OR NEW.warehouse_id<>OLD.warehouse_id OR NEW.customer_name<>OLD.customer_name OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Delivery identity is immutable'; END IF;
  IF OLD.status IN ('Cancelled','Delivered') THEN RAISE EXCEPTION 'Closed delivery orders are immutable'; END IF;
  IF OLD.status='Picking' AND NEW.status NOT IN ('Picking','Packed','Cancelled') OR OLD.status='Packed' AND NEW.status NOT IN ('Picking','Packed','Dispatched','Cancelled') OR OLD.status IN ('Dispatched','In Transit','Exception') AND NEW.status NOT IN ('In Transit','Delivered','Exception') THEN RAISE EXCEPTION 'Invalid delivery transition; dispatched goods cannot be cancelled or restored'; END IF;
  IF OLD.shipment_id IS NOT NULL AND (NEW.shipment_id IS DISTINCT FROM OLD.shipment_id OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at OR NEW.address<>OLD.address OR NEW.carrier<>OLD.carrier OR NEW.vehicle<>OLD.vehicle OR NEW.driver<>OLD.driver OR NEW.notes<>OLD.notes) THEN RAISE EXCEPTION 'Dispatched shipment details are immutable'; END IF;
 END IF;
 IF NEW.status IN ('Packed','Dispatched') AND (NOT EXISTS(SELECT 1 FROM delivery_items i WHERE i.delivery_id=NEW.id) OR EXISTS(SELECT 1 FROM delivery_items i WHERE i.delivery_id=NEW.id AND i.packed<>i.quantity)) THEN RAISE EXCEPTION 'All picking quantities must be packed'; END IF;
 IF NEW.status IN ('Dispatched','In Transit','Delivered','Exception') THEN
  IF NEW.shipment_id IS NULL OR NEW.dispatched_at IS NULL THEN RAISE EXCEPTION 'Dispatched delivery requires a stock-posted shipment'; END IF;
  SELECT * INTO shipment FROM shipments WHERE id=NEW.shipment_id;
  IF shipment.order_id IS DISTINCT FROM NEW.order_id OR EXISTS(
   SELECT 1 FROM delivery_items i JOIN sales_order_items l ON l.id=i.sale_item_id WHERE i.delivery_id=NEW.id AND (
    NOT EXISTS(SELECT 1 FROM shipment_items si WHERE si.shipment_id=shipment.id AND si.sale_item_id=i.sale_item_id AND si.quantity=i.quantity)
    OR NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.operation_key=shipment.operation_key||':'||i.id::text AND b.warehouse_id=NEW.warehouse_id AND b.variant_id=l.variant_id AND m.quantity=-i.quantity AND m.reserved_delta=-i.quantity)
   )) THEN RAISE EXCEPTION 'Delivery dispatch must match the exact shipment and inventory deductions'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER delivery_order_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_orders FOR EACH ROW EXECUTE FUNCTION guard_delivery_order();
--> statement-breakpoint
CREATE FUNCTION assert_delivery_claim(item_id_to_check uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE held integer; claimed integer;
BEGIN
 SELECT reserved INTO held FROM sales_order_items WHERE id=item_id_to_check FOR UPDATE;
 SELECT coalesce(sum(i.quantity),0) INTO claimed FROM delivery_items i JOIN delivery_orders d ON d.id=i.delivery_id WHERE i.sale_item_id=item_id_to_check AND d.status IN ('Picking','Packed');
 IF claimed>held THEN RAISE EXCEPTION 'Picking commitments exceed reserved finished goods'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION reconcile_delivery_claims() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item uuid;
BEGIN
 IF TG_TABLE_NAME='delivery_orders' THEN FOR item IN SELECT sale_item_id FROM delivery_items WHERE delivery_id=NEW.id ORDER BY sale_item_id LOOP PERFORM assert_delivery_claim(item); END LOOP;
 ELSIF TG_TABLE_NAME='delivery_items' THEN PERFORM assert_delivery_claim(NEW.sale_item_id);
 ELSE PERFORM assert_delivery_claim(NEW.id); END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER delivery_header_claims AFTER INSERT OR UPDATE ON delivery_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_delivery_claims();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER delivery_item_claims AFTER INSERT OR UPDATE ON delivery_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_delivery_claims();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_delivery_claims AFTER UPDATE ON sales_order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_delivery_claims();
--> statement-breakpoint
CREATE FUNCTION immutable_delivery_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Delivery evidence and event history are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER delivery_event_immutable BEFORE UPDATE OR DELETE ON delivery_events FOR EACH ROW EXECUTE FUNCTION immutable_delivery_evidence();
--> statement-breakpoint
CREATE TRIGGER delivery_proof_immutable BEFORE UPDATE OR DELETE ON delivery_proofs FOR EACH ROW EXECUTE FUNCTION immutable_delivery_evidence();
