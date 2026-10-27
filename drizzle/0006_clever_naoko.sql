CREATE TABLE "labor_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_routing_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"employee_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"completed" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "labor_quantities" CHECK ("labor_entries"."sequence">=0 and "labor_entries"."completed">=0 and "labor_entries"."rejected">=0 and ("labor_entries"."ended_at" is null or "labor_entries"."ended_at">="labor_entries"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "order_routings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"routing_id" uuid NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_routings_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "production_routings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_order_routing_id_order_routings_id_fk" FOREIGN KEY ("order_routing_id") REFERENCES "public"."order_routings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_routings" ADD CONSTRAINT "order_routings_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_routings" ADD CONSTRAINT "order_routings_routing_id_production_routings_id_fk" FOREIGN KEY ("routing_id") REFERENCES "public"."production_routings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routings" ADD CONSTRAINT "production_routings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_routings" ADD CONSTRAINT "production_routings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_one_active_operation" ON "labor_entries" USING btree ("employee_id") WHERE "labor_entries"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_one_active_session" ON "labor_entries" USING btree ("order_routing_id","sequence") WHERE "labor_entries"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_routing_version" ON "production_routings" USING btree ("product_id","version");
--> statement-breakpoint
CREATE FUNCTION immutable_production_routing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Routing versions and manufacturing snapshots are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_product_routing BEFORE UPDATE OR DELETE ON production_routings FOR EACH ROW EXECUTE FUNCTION immutable_production_routing();
--> statement-breakpoint
CREATE TRIGGER immutable_order_routing BEFORE UPDATE OR DELETE ON order_routings FOR EACH ROW EXECUTE FUNCTION immutable_production_routing();
--> statement-breakpoint
CREATE FUNCTION validate_order_routing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM manufacturing_orders o JOIN product_variants v ON v.id=o.variant_id JOIN production_routings r ON r.product_id=v.product_id WHERE o.id=NEW.order_id AND r.id=NEW.routing_id AND r.steps=NEW.steps AND o.status IN ('Draft','Planned')) THEN RAISE EXCEPTION 'Routing snapshot must match the product version and be fixed before production starts'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER validate_order_routing BEFORE INSERT ON order_routings FOR EACH ROW EXECUTE FUNCTION validate_order_routing();
--> statement-breakpoint
CREATE FUNCTION guard_labor_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r order_routings; o manufacturing_orders; applicable integer; good integer; bad integer; processed integer; i integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Labor history cannot be deleted'; END IF;
 SELECT * INTO r FROM order_routings WHERE id=NEW.order_routing_id FOR UPDATE;
 SELECT * INTO o FROM manufacturing_orders WHERE id=r.order_id FOR UPDATE;
 IF o.status<>'In Progress' OR NEW.sequence>=jsonb_array_length(r.steps) THEN RAISE EXCEPTION 'Invalid operation or manufacturing status'; END IF;
 IF TG_OP='UPDATE' AND (OLD.ended_at IS NOT NULL OR NEW.order_routing_id<>OLD.order_routing_id OR NEW.sequence<>OLD.sequence OR NEW.employee_id<>OLD.employee_id OR NEW.started_at<>OLD.started_at OR NEW.created_by<>OLD.created_by) THEN RAISE EXCEPTION 'Finished labor sessions and assignments are immutable'; END IF;
 IF NEW.ended_at IS NULL AND (NEW.completed<>0 OR NEW.rejected<>0) THEN RAISE EXCEPTION 'Running sessions cannot contain finished quantities'; END IF;
 applicable:=o.quantity;
 FOR i IN 0..NEW.sequence LOOP
  SELECT coalesce(sum(completed),0),coalesce(sum(rejected),0) INTO good,bad FROM labor_entries WHERE order_routing_id=r.id AND sequence=i AND id<>NEW.id;
  IF i=NEW.sequence THEN
   IF good+bad+NEW.completed+NEW.rejected>applicable THEN RAISE EXCEPTION 'Operation quantities exceed applicable units'; END IF;
  ELSE
   IF good+bad<>applicable OR EXISTS(SELECT 1 FROM labor_entries WHERE order_routing_id=r.id AND sequence=i AND ended_at IS NULL) THEN RAISE EXCEPTION 'Complete predecessor operations first'; END IF;
   applicable:=good;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER labor_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON labor_entries FOR EACH ROW EXECUTE FUNCTION guard_labor_entry();
