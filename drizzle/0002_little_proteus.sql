CREATE TABLE "specification_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"specification_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_attachment_size" CHECK ("specification_attachments"."bytes">0 and "specification_attachments"."bytes"<=2097152),
	CONSTRAINT "spec_attachment_type" CHECK ("specification_attachments"."mime" in ('image/png','image/jpeg','application/pdf'))
);
--> statement-breakpoint
CREATE TABLE "specification_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"specification_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"fabric_consumption" numeric(18, 4) DEFAULT '0' NOT NULL,
	"consumption_unit" text NOT NULL,
	"instructions" text NOT NULL,
	"measurements" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "spec_positive_consumption" CHECK ("specification_variants"."fabric_consumption">0)
);
--> statement-breakpoint
CREATE TABLE "product_specifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"change_note" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_status" CHECK ("product_specifications"."status" in ('Draft','In Review','Approved','Rejected')),
	CONSTRAINT "spec_approval_metadata" CHECK (("product_specifications"."status"='Approved') = ("product_specifications"."approved_by" is not null and "product_specifications"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "bom_versions" ADD COLUMN "specification_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "specification_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "specification_results" jsonb;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN "specification_id" uuid;--> statement-breakpoint
ALTER TABLE "specification_attachments" ADD CONSTRAINT "specification_attachments_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_attachments" ADD CONSTRAINT "specification_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_variants" ADD CONSTRAINT "specification_variants_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_variants" ADD CONSTRAINT "specification_variants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specifications" ADD CONSTRAINT "product_specifications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spec_variant" ON "specification_variants" USING btree ("specification_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_spec_version" ON "product_specifications" USING btree ("product_id","version");--> statement-breakpoint
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_specification_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='Approved' THEN RAISE EXCEPTION 'Approved specification versions are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.product_id<>OLD.product_id OR NEW.version<>OLD.version THEN RAISE EXCEPTION 'Specification identity is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_approved_spec BEFORE UPDATE OR DELETE ON product_specifications FOR EACH ROW EXECUTE FUNCTION guard_specification_version();
--> statement-breakpoint
CREATE FUNCTION guard_specification_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.specification_id; ELSE parent_id:=NEW.specification_id; END IF;
 IF TG_OP='UPDATE' AND NEW.specification_id<>OLD.specification_id THEN RAISE EXCEPTION 'Cannot move specification content'; END IF;
 SELECT status INTO parent_status FROM product_specifications WHERE id=parent_id FOR UPDATE;
 IF parent_status IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Only draft specification content may change'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_spec_variants BEFORE INSERT OR UPDATE OR DELETE ON specification_variants FOR EACH ROW EXECUTE FUNCTION guard_specification_child();
--> statement-breakpoint
CREATE TRIGGER immutable_spec_attachments BEFORE INSERT OR UPDATE OR DELETE ON specification_attachments FOR EACH ROW EXECUTE FUNCTION guard_specification_child();
--> statement-breakpoint
CREATE FUNCTION guard_manufacturing_specification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.specification_id IS NOT NULL AND (NEW.specification_id IS DISTINCT FROM OLD.specification_id OR NEW.variant_id<>OLD.variant_id OR NEW.bom_id<>OLD.bom_id) THEN RAISE EXCEPTION 'Manufacturing specification and variant are immutable'; END IF;
 IF TG_OP='INSERT' OR NEW.specification_id IS DISTINCT FROM OLD.specification_id THEN
  IF NOT EXISTS(SELECT 1 FROM product_specifications p JOIN specification_variants v ON v.specification_id=p.id JOIN bom_versions b ON b.variant_id=v.variant_id WHERE p.id=NEW.specification_id AND p.status='Approved' AND v.variant_id=NEW.variant_id AND b.id=NEW.bom_id AND (b.specification_id IS NULL OR b.specification_id=p.id)) THEN RAISE EXCEPTION 'Manufacturing requires a matching approved specification'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER manufacturing_approved_spec BEFORE INSERT OR UPDATE ON manufacturing_orders FOR EACH ROW EXECUTE FUNCTION guard_manufacturing_specification();
