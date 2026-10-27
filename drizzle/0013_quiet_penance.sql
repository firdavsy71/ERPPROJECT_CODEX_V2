CREATE TABLE "repair_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"event" text NOT NULL,
	"notes" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_labor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"notes" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_labor_positive" CHECK ("repair_labor"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_material_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"roll_id" uuid,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"movement_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_material_usage_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "repair_usage_positive" CHECK ("repair_material_usage"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "repair_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_description" text NOT NULL,
	"activity" text NOT NULL,
	"instructions" text NOT NULL,
	"employee_id" uuid,
	"estimated_date" text,
	"cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'UZS' NOT NULL,
	"status" text DEFAULT 'Received' NOT NULL,
	"completion_notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "repair_status" CHECK ("repair_orders"."status" in ('Received','Diagnosed','Awaiting Materials','In Progress','Quality Check','Completed','Returned','Cancelled')),
	CONSTRAINT "repair_cost_nonnegative" CHECK ("repair_orders"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repair_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_requirement_positive" CHECK ("repair_requirements"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_repair_id_repair_orders_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_labor" ADD CONSTRAINT "repair_labor_repair_id_repair_orders_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_labor" ADD CONSTRAINT "repair_labor_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_labor" ADD CONSTRAINT "repair_labor_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_material_usage" ADD CONSTRAINT "repair_material_usage_repair_id_repair_orders_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_material_usage" ADD CONSTRAINT "repair_material_usage_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_material_usage" ADD CONSTRAINT "repair_material_usage_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_material_usage" ADD CONSTRAINT "repair_material_usage_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_material_usage" ADD CONSTRAINT "repair_material_usage_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requirements" ADD CONSTRAINT "repair_requirements_repair_id_repair_orders_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requirements" ADD CONSTRAINT "repair_requirements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION immutable_repair_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Repair records are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER repair_events_immutable BEFORE UPDATE OR DELETE ON repair_events FOR EACH ROW EXECUTE FUNCTION immutable_repair_evidence();
--> statement-breakpoint
CREATE TRIGGER repair_labor_immutable BEFORE UPDATE OR DELETE ON repair_labor FOR EACH ROW EXECUTE FUNCTION immutable_repair_evidence();
--> statement-breakpoint
CREATE TRIGGER repair_usage_immutable BEFORE UPDATE OR DELETE ON repair_material_usage FOR EACH ROW EXECUTE FUNCTION immutable_repair_evidence();
--> statement-breakpoint
CREATE FUNCTION validate_repair_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory_movements m JOIN inventory_balances b ON b.id=m.balance_id
    WHERE m.id=NEW.movement_id AND b.material_id=NEW.material_id AND m.quantity=-NEW.quantity AND m.source='repair')
  THEN RAISE EXCEPTION 'Repair usage must match its material inventory movement'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER repair_usage_validate BEFORE INSERT ON repair_material_usage FOR EACH ROW EXECUTE FUNCTION validate_repair_usage();
