CREATE TABLE "legacy_delivery_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_delivery_confirmations_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "return_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"settlement_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_credit_notes_number_unique" UNIQUE("number"),
	CONSTRAINT "return_credit_notes_settlement_id_unique" UNIQUE("settlement_id"),
	CONSTRAINT "return_credit_valid" CHECK ("return_credit_notes"."quantity">0 and "return_credit_notes"."amount">=0)
);
--> statement-breakpoint
CREATE TABLE "return_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"action" text NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"sellable" integer NOT NULL,
	"quarantined" integer NOT NULL,
	"condition" text NOT NULL,
	"notes" text NOT NULL,
	"movement_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_inspections_receipt_id_unique" UNIQUE("receipt_id"),
	CONSTRAINT "return_inspection_quantities" CHECK ("return_inspections"."sellable">=0 and "return_inspections"."quarantined">=0 and "return_inspections"."sellable"+"return_inspections"."quarantined">0)
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"shipment_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	"product_snapshot" text NOT NULL,
	CONSTRAINT "return_item_quantity" CHECK ("return_items"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "return_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'Requested' NOT NULL,
	"intake_closed" boolean DEFAULT false NOT NULL,
	"notes" text NOT NULL,
	"approved_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "return_status" CHECK ("return_orders"."status" in ('Requested','Approved','Receiving','Inspected','Completed','Rejected','Cancelled'))
);
--> statement-breakpoint
CREATE TABLE "return_quarantine_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"reference" text NOT NULL,
	"notes" text NOT NULL,
	"movement_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_quarantine_quantity" CHECK ("return_quarantine_dispositions"."quantity">0 and "return_quarantine_dispositions"."kind" in ('Restock','Scrap'))
);
--> statement-breakpoint
CREATE TABLE "return_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reference" text NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_receipt_quantity" CHECK ("return_receipts"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "return_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_refunds_reference_unique" UNIQUE("reference"),
	CONSTRAINT "return_refund_positive" CHECK ("return_refunds"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "return_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"replacement_variant_id" uuid,
	"replacement_order_id" uuid,
	"status" text DEFAULT 'Requested' NOT NULL,
	"notes" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approved_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_settlements_replacement_order_id_unique" UNIQUE("replacement_order_id"),
	CONSTRAINT "return_settlement_valid" CHECK ("return_settlements"."kind" in ('Credit','Refund','Exchange','Replacement') and "return_settlements"."status" in ('Requested','Approved','Processed','Rejected') and "return_settlements"."quantity">0)
);
--> statement-breakpoint
ALTER TABLE "legacy_delivery_confirmations" ADD CONSTRAINT "legacy_delivery_confirmations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_delivery_confirmations" ADD CONSTRAINT "legacy_delivery_confirmations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_credit_notes" ADD CONSTRAINT "return_credit_notes_settlement_id_return_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."return_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_credit_notes" ADD CONSTRAINT "return_credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_credit_notes" ADD CONSTRAINT "return_credit_notes_sale_item_id_sales_order_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_credit_notes" ADD CONSTRAINT "return_credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_return_id_return_orders_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_receipt_id_return_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."return_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_return_orders_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_shipment_item_id_shipment_items_id_fk" FOREIGN KEY ("shipment_item_id") REFERENCES "public"."shipment_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_quarantine_dispositions" ADD CONSTRAINT "return_quarantine_dispositions_inspection_id_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."return_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_quarantine_dispositions" ADD CONSTRAINT "return_quarantine_dispositions_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_quarantine_dispositions" ADD CONSTRAINT "return_quarantine_dispositions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_return_item_id_return_items_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "public"."return_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_receipts" ADD CONSTRAINT "return_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_refunds" ADD CONSTRAINT "return_refunds_return_id_return_orders_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."return_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_refunds" ADD CONSTRAINT "return_refunds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_refunds" ADD CONSTRAINT "return_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settlements" ADD CONSTRAINT "return_settlements_return_item_id_return_items_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "public"."return_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settlements" ADD CONSTRAINT "return_settlements_replacement_variant_id_product_variants_id_fk" FOREIGN KEY ("replacement_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settlements" ADD CONSTRAINT "return_settlements_replacement_order_id_sales_orders_id_fk" FOREIGN KEY ("replacement_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settlements" ADD CONSTRAINT "return_settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settlements" ADD CONSTRAINT "return_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_origin_line" ON "return_items" USING btree ("return_id","shipment_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_quarantine_reference" ON "return_quarantine_dispositions" USING btree ("inspection_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "return_receipt_reference" ON "return_receipts" USING btree ("return_item_id","reference");
--> statement-breakpoint
CREATE INDEX return_items_origin ON return_items(shipment_item_id);
--> statement-breakpoint
CREATE INDEX return_credits_invoice ON return_credit_notes(invoice_id);
--> statement-breakpoint
CREATE INDEX return_refunds_invoice ON return_refunds(invoice_id);
--> statement-breakpoint
CREATE FUNCTION immutable_return_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Return evidence and accounting documents are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_delivery_evidence BEFORE UPDATE OR DELETE ON legacy_delivery_confirmations FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_receipt_immutable BEFORE UPDATE OR DELETE ON return_receipts FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_inspection_immutable BEFORE UPDATE OR DELETE ON return_inspections FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_disposition_immutable BEFORE UPDATE OR DELETE ON return_quarantine_dispositions FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_credit_immutable BEFORE UPDATE OR DELETE ON return_credit_notes FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_refund_immutable BEFORE UPDATE OR DELETE ON return_refunds FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE TRIGGER return_events_immutable BEFORE UPDATE OR DELETE ON return_events FOR EACH ROW EXECUTE FUNCTION immutable_return_evidence();
--> statement-breakpoint
CREATE FUNCTION guard_return_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Authorized return lines are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM return_orders r JOIN invoices inv ON inv.id=r.invoice_id JOIN shipments sh ON sh.order_id=inv.order_id JOIN shipment_items si ON si.shipment_id=sh.id WHERE r.id=NEW.return_id AND r.status='Requested' AND r.order_id=inv.order_id AND si.id=NEW.shipment_item_id AND (EXISTS(SELECT 1 FROM delivery_orders d WHERE d.shipment_id=sh.id AND d.status='Delivered') OR (NOT EXISTS(SELECT 1 FROM delivery_orders d WHERE d.shipment_id=sh.id) AND EXISTS(SELECT 1 FROM legacy_delivery_confirmations c WHERE c.shipment_id=sh.id)))) THEN RAISE EXCEPTION 'Return line must match an actually delivered shipment and original invoice'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_item_guard BEFORE INSERT OR UPDATE OR DELETE ON return_items FOR EACH ROW EXECUTE FUNCTION guard_return_item();
--> statement-breakpoint
CREATE FUNCTION assert_return_limit(origin_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE delivered integer; claimed integer;
BEGIN
 SELECT quantity INTO delivered FROM shipment_items WHERE id=origin_id FOR UPDATE;
 SELECT coalesce(sum(CASE WHEN r.intake_closed THEN (SELECT coalesce(sum(p.quantity),0) FROM return_receipts p WHERE p.return_item_id=i.id) ELSE i.quantity END),0) INTO claimed FROM return_items i JOIN return_orders r ON r.id=i.return_id WHERE i.shipment_item_id=origin_id AND r.status NOT IN ('Cancelled','Rejected');
 IF claimed>delivered THEN RAISE EXCEPTION 'Return authorizations exceed delivered units after prior returns'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION reconcile_return_claims() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin_id uuid;
BEGIN
 IF TG_TABLE_NAME='return_orders' THEN FOR origin_id IN SELECT shipment_item_id FROM return_items WHERE return_id=NEW.id ORDER BY shipment_item_id LOOP PERFORM assert_return_limit(origin_id); END LOOP;
 ELSIF TG_TABLE_NAME='return_items' THEN PERFORM assert_return_limit(NEW.shipment_item_id);
 ELSE SELECT shipment_item_id INTO origin_id FROM return_items WHERE id=NEW.return_item_id; PERFORM assert_return_limit(origin_id); END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_header_claims AFTER INSERT OR UPDATE ON return_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_return_claims();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_item_claims AFTER INSERT ON return_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_return_claims();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_receipt_claims AFTER INSERT ON return_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_return_claims();
--> statement-breakpoint
CREATE FUNCTION guard_return_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned integer; prior integer;
BEGIN
 SELECT i.quantity INTO planned FROM return_items i JOIN return_orders r ON r.id=i.return_id WHERE i.id=NEW.return_item_id AND r.status IN ('Approved','Receiving') AND NOT r.intake_closed FOR UPDATE OF i;
 SELECT coalesce(sum(quantity),0) INTO prior FROM return_receipts WHERE return_item_id=NEW.return_item_id;
 IF planned IS NULL OR prior+NEW.quantity>planned THEN RAISE EXCEPTION 'Receipt exceeds approved, open return authorization'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_receipt_guard BEFORE INSERT ON return_receipts FOR EACH ROW EXECUTE FUNCTION guard_return_receipt();
--> statement-breakpoint
CREATE FUNCTION guard_return_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE received integer; variant uuid;
BEGIN
 SELECT p.quantity,l.variant_id INTO received,variant FROM return_receipts p JOIN return_items i ON i.id=p.return_item_id JOIN shipment_items si ON si.id=i.shipment_item_id JOIN sales_order_items l ON l.id=si.sale_item_id WHERE p.id=NEW.receipt_id;
 IF received IS NULL OR NEW.sellable+NEW.quarantined<>received THEN RAISE EXCEPTION 'Inspection must reconcile every received unit'; END IF;
 IF NEW.sellable>0 THEN
  IF NEW.condition<>'Unworn / sellable' OR NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id AND b.variant_id=variant AND m.quantity=NEW.sellable AND m.reserved_delta=0) THEN RAISE EXCEPTION 'Sellable restock must match an explicit inventory movement'; END IF;
 ELSIF NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'Quarantine cannot enter available stock'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_inspection_guard BEFORE INSERT ON return_inspections FOR EACH ROW EXECUTE FUNCTION guard_return_inspection();
--> statement-breakpoint
CREATE FUNCTION guard_return_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held integer; prior integer; variant uuid;
BEGIN
 SELECT i.quarantined,l.variant_id INTO held,variant FROM return_inspections i JOIN return_receipts p ON p.id=i.receipt_id JOIN return_items ri ON ri.id=p.return_item_id JOIN shipment_items si ON si.id=ri.shipment_item_id JOIN sales_order_items l ON l.id=si.sale_item_id WHERE i.id=NEW.inspection_id FOR UPDATE OF i;
 SELECT coalesce(sum(quantity),0) INTO prior FROM return_quarantine_dispositions WHERE inspection_id=NEW.inspection_id;
 IF held IS NULL OR prior+NEW.quantity>held THEN RAISE EXCEPTION 'Quarantine disposition exceeds held units'; END IF;
 IF NEW.kind='Restock' AND NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id WHERE m.id=NEW.movement_id AND b.variant_id=variant AND m.quantity=NEW.quantity AND m.reserved_delta=0) OR NEW.kind='Scrap' AND NEW.movement_id IS NOT NULL THEN RAISE EXCEPTION 'Quarantine disposition has an invalid inventory posting'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_quarantine_guard BEFORE INSERT ON return_quarantine_dispositions FOR EACH ROW EXECUTE FUNCTION guard_return_quarantine();
--> statement-breakpoint
CREATE FUNCTION guard_return_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE received integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return authorization history cannot be deleted'; END IF;
 IF NEW.order_id IS DISTINCT FROM (SELECT order_id FROM invoices WHERE id=NEW.invoice_id) THEN RAISE EXCEPTION 'Return invoice and sales order must match'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status IN ('Completed','Rejected','Cancelled') OR NEW.invoice_id<>OLD.invoice_id OR NEW.order_id<>OLD.order_id OR NEW.number<>OLD.number OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR OLD.intake_closed AND NOT NEW.intake_closed THEN RAISE EXCEPTION 'Closed return history and original references are immutable'; END IF;
  IF OLD.status='Requested' AND NEW.status NOT IN ('Requested','Approved','Rejected','Cancelled') OR OLD.status='Approved' AND NEW.status NOT IN ('Approved','Receiving','Rejected','Cancelled') OR OLD.status='Receiving' AND NEW.status NOT IN ('Receiving','Inspected') OR OLD.status='Inspected' AND NEW.status NOT IN ('Inspected','Completed') THEN RAISE EXCEPTION 'Invalid return status transition'; END IF;
 END IF;
 SELECT coalesce(sum(p.quantity),0) INTO received FROM return_receipts p JOIN return_items i ON i.id=p.return_item_id WHERE i.return_id=NEW.id;
 IF NEW.status IN ('Rejected','Cancelled') AND received>0 THEN RAISE EXCEPTION 'Physically received goods cannot be cancelled'; END IF;
 IF NEW.status IN ('Inspected','Completed') AND (NOT NEW.intake_closed OR received=0 OR EXISTS(SELECT 1 FROM return_receipts p JOIN return_items i ON i.id=p.return_item_id WHERE i.return_id=NEW.id AND NOT EXISTS(SELECT 1 FROM return_inspections q WHERE q.receipt_id=p.id))) THEN RAISE EXCEPTION 'Close intake and inspect every received unit first'; END IF;
 IF NEW.status='Completed' AND received<>(SELECT coalesce(sum(q.quantity),0) FROM return_settlements q JOIN return_items i ON i.id=q.return_item_id WHERE i.return_id=NEW.id AND q.status='Processed') THEN RAISE EXCEPTION 'Every received unit requires a processed commercial resolution'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_header_guard BEFORE INSERT OR UPDATE OR DELETE ON return_orders FOR EACH ROW EXECUTE FUNCTION guard_return_header();
--> statement-breakpoint
CREATE FUNCTION guard_return_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inspected integer; claimed integer;
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status IN ('Processed','Rejected')) THEN RAISE EXCEPTION 'Completed commercial decisions are immutable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.return_item_id<>OLD.return_item_id OR NEW.kind<>OLD.kind OR NEW.quantity<>OLD.quantity OR NEW.replacement_variant_id IS DISTINCT FROM OLD.replacement_variant_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at) THEN RAISE EXCEPTION 'Commercial request identity is immutable'; END IF;
 IF TG_OP='INSERT' AND NEW.status<>'Requested' OR TG_OP='UPDATE' AND OLD.status='Requested' AND NEW.status NOT IN ('Requested','Approved','Rejected') OR TG_OP='UPDATE' AND OLD.status='Approved' AND NEW.status NOT IN ('Approved','Processed','Rejected') THEN RAISE EXCEPTION 'Invalid commercial approval transition'; END IF;
 IF NEW.status IN ('Approved','Processed') AND NEW.approved_by IS NULL THEN RAISE EXCEPTION 'Commercial processing requires approval'; END IF;
 IF NEW.status='Processed' THEN
  IF NEW.kind IN ('Credit','Refund') AND NOT EXISTS(SELECT 1 FROM return_credit_notes c WHERE c.settlement_id=NEW.id AND c.quantity=NEW.quantity AND c.amount=NEW.amount) THEN RAISE EXCEPTION 'Financial processing requires the matching issued credit note'; END IF;
  IF NEW.kind IN ('Exchange','Replacement') AND NOT EXISTS(SELECT 1 FROM sales_orders o JOIN sales_order_items l ON l.order_id=o.id WHERE o.id=NEW.replacement_order_id AND o.total=0 AND l.variant_id=NEW.replacement_variant_id AND l.quantity=NEW.quantity AND l.price=0 AND l.discount=0) THEN RAISE EXCEPTION 'Replacement requires a no-charge linked sales order'; END IF;
 END IF;
 PERFORM 1 FROM return_items WHERE id=NEW.return_item_id FOR UPDATE;
 SELECT coalesce(sum(q.sellable+q.quarantined),0) INTO inspected FROM return_inspections q JOIN return_receipts p ON p.id=q.receipt_id WHERE p.return_item_id=NEW.return_item_id;
 SELECT coalesce(sum(quantity),0) INTO claimed FROM return_settlements WHERE return_item_id=NEW.return_item_id AND status<>'Rejected' AND id<>NEW.id;
 IF NEW.status<>'Rejected' AND claimed+NEW.quantity>inspected THEN RAISE EXCEPTION 'Commercial resolutions exceed inspected returned units'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON return_settlements FOR EACH ROW EXECUTE FUNCTION guard_return_settlement();
--> statement-breakpoint
CREATE FUNCTION guard_return_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original invoices; units integer; credited numeric;
BEGIN
 SELECT * INTO original FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM return_settlements q JOIN return_items ri ON ri.id=q.return_item_id JOIN return_orders r ON r.id=ri.return_id JOIN shipment_items si ON si.id=ri.shipment_item_id JOIN sales_order_items l ON l.id=si.sale_item_id WHERE q.id=NEW.settlement_id AND q.status='Approved' AND q.kind IN ('Credit','Refund') AND q.quantity=NEW.quantity AND r.invoice_id=NEW.invoice_id AND l.id=NEW.sale_item_id AND l.order_id=original.order_id) THEN RAISE EXCEPTION 'Credit note must match an approved returned invoice line'; END IF;
 SELECT coalesce(sum(quantity),0) INTO units FROM return_credit_notes WHERE sale_item_id=NEW.sale_item_id;
 SELECT coalesce(sum(amount),0) INTO credited FROM return_credit_notes WHERE invoice_id=NEW.invoice_id;
 IF units+NEW.quantity>(SELECT quantity FROM sales_order_items WHERE id=NEW.sale_item_id) OR credited+NEW.amount>original.total THEN RAISE EXCEPTION 'Credit exceeds original invoice quantities or value'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_credit_guard BEFORE INSERT ON return_credit_notes FOR EACH ROW EXECUTE FUNCTION guard_return_credit();
--> statement-breakpoint
CREATE FUNCTION guard_return_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original invoices; credited numeric; refunded numeric;
BEGIN
 SELECT * INTO original FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM return_orders WHERE id=NEW.return_id AND invoice_id=NEW.invoice_id) THEN RAISE EXCEPTION 'Refund must reference its original return invoice'; END IF;
 SELECT coalesce(sum(amount),0) INTO credited FROM return_credit_notes WHERE invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(amount),0) INTO refunded FROM return_refunds WHERE invoice_id=NEW.invoice_id;
 IF NEW.amount>greatest(original.paid-refunded-(original.total-credited),0) THEN RAISE EXCEPTION 'Refund exceeds available customer credit balance'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER return_refund_guard BEFORE INSERT ON return_refunds FOR EACH ROW EXECUTE FUNCTION guard_return_refund();
--> statement-breakpoint
CREATE FUNCTION guard_payment_after_credits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original invoices; credited numeric; refunded numeric;
BEGIN
 SELECT * INTO original FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO credited FROM return_credit_notes WHERE invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(amount),0) INTO refunded FROM return_refunds WHERE invoice_id=NEW.invoice_id;
 IF NEW.amount>greatest(original.total-credited-original.paid+refunded,0) THEN RAISE EXCEPTION 'Payment exceeds invoice balance after return credits'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_return_credit_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_after_credits();
