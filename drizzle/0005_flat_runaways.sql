CREATE TABLE "cutting_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"roll_id" uuid NOT NULL,
	"specification_id" uuid NOT NULL,
	"size" text NOT NULL,
	"layout" text NOT NULL,
	"rate_source" text NOT NULL,
	"quantity" integer NOT NULL,
	"planned" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Planned' NOT NULL,
	"result" jsonb,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cutting_batch_valid" CHECK ("cutting_batches"."quantity">0 and "cutting_batches"."planned">0 and "cutting_batches"."status" in ('Planned','Completed','Cancelled') and ("cutting_batches"."status"='Completed')=("cutting_batches"."result" is not null and "cutting_batches"."completed_by" is not null))
);
--> statement-breakpoint
CREATE FUNCTION guard_cutting_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cutting history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (OLD.status<>'Planned' OR NEW.order_id<>OLD.order_id OR NEW.reservation_id<>OLD.reservation_id OR NEW.roll_id<>OLD.roll_id OR NEW.specification_id<>OLD.specification_id OR NEW.quantity<>OLD.quantity OR NEW.planned<>OLD.planned OR NEW.size<>OLD.size OR NEW.layout<>OLD.layout OR NEW.rate_source<>OLD.rate_source OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at) THEN RAISE EXCEPTION 'Cutting plans and completed records are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM production_material_reservations r JOIN manufacturing_orders o ON o.id=r.order_id JOIN fabric_rolls f ON f.balance_id=r.balance_id WHERE r.id=NEW.reservation_id AND o.id=NEW.order_id AND o.specification_id=NEW.specification_id AND f.id=NEW.roll_id) THEN RAISE EXCEPTION 'Cutting references must match manufacturing material and specification'; END IF;
 IF NEW.status='Completed' AND ((NEW.result->>'issued')::numeric<>(NEW.result->>'incorporated')::numeric+(NEW.result->>'waste')::numeric+(NEW.result->>'returned')::numeric OR (NEW.result->>'consumed')::numeric<>(NEW.result->>'incorporated')::numeric+(NEW.result->>'waste')::numeric) THEN RAISE EXCEPTION 'Cutting fabric reconciliation failed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cutting_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON cutting_batches FOR EACH ROW EXECUTE FUNCTION guard_cutting_batch();
--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_reservation_id_production_material_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."production_material_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_roll_id_fabric_rolls_id_fk" FOREIGN KEY ("roll_id") REFERENCES "public"."fabric_rolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_batches" ADD CONSTRAINT "cutting_batches_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
