CREATE TABLE "branding_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"provider" text DEFAULT 'vercel-blob-private' NOT NULL,
	"pathname" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branding_assets_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "branding_asset_size" CHECK ("branding_assets"."bytes">0 and "branding_assets"."bytes"<=2097152),
	CONSTRAINT "branding_asset_mime" CHECK ("branding_assets"."mime" in ('image/png','image/jpeg','application/pdf')),
	CONSTRAINT "branding_asset_provider" CHECK ("branding_assets"."provider"='vercel-blob-private')
);
--> statement-breakpoint
CREATE TABLE "branding_version_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"proof_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branding_file_purpose" CHECK ("branding_version_files"."purpose" in ('Logo','Design proof','Reference'))
);
--> statement-breakpoint
CREATE TABLE "branding_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"approved_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branding_requests_sale_item_id_unique" UNIQUE("sale_item_id")
);
--> statement-breakpoint
CREATE TABLE "branding_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"change_note" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"specification_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"per_unit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"setup" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"customer_approver" text,
	"approval_reference" text,
	"review_note" text,
	CONSTRAINT "branding_status" CHECK ("branding_versions"."status" in ('Draft','In Review','Approved','Rejected')),
	CONSTRAINT "branding_approval" CHECK (("branding_versions"."status"='Approved') = ("branding_versions"."approved_by" is not null and "branding_versions"."approved_at" is not null and "branding_versions"."customer_approver" is not null and "branding_versions"."approval_reference" is not null)),
	CONSTRAINT "branding_prices" CHECK ("branding_versions"."per_unit">=0 and "branding_versions"."setup">=0 and "branding_versions"."total">=0)
);
--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "branding_version_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "branding_check" text;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN "branding_version_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "branding_total" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD CONSTRAINT "branding_assets_request_id_branding_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."branding_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD CONSTRAINT "branding_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_version_files" ADD CONSTRAINT "branding_version_files_version_id_branding_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."branding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_version_files" ADD CONSTRAINT "branding_version_files_asset_id_branding_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."branding_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_requests" ADD CONSTRAINT "branding_requests_sale_item_id_sales_order_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_requests" ADD CONSTRAINT "branding_requests_approved_version_id_branding_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."branding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_requests" ADD CONSTRAINT "branding_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_versions" ADD CONSTRAINT "branding_versions_request_id_branding_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."branding_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_versions" ADD CONSTRAINT "branding_versions_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_versions" ADD CONSTRAINT "branding_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_versions" ADD CONSTRAINT "branding_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branding_file_link" ON "branding_version_files" USING btree ("version_id","asset_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "branding_request_version" ON "branding_versions" USING btree ("request_id","version");--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_branding_version_id_branding_versions_id_fk" FOREIGN KEY ("branding_version_id") REFERENCES "public"."branding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_branding_version_id_branding_versions_id_fk" FOREIGN KEY ("branding_version_id") REFERENCES "public"."branding_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_branding_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.status='Approved' THEN RAISE EXCEPTION 'Approved branding versions are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.request_id<>OLD.request_id OR NEW.version<>OLD.version OR NEW.snapshot<>OLD.snapshot) THEN RAISE EXCEPTION 'Branding version identity is immutable'; END IF;
 IF NEW.status='Approved' THEN
  IF NOT EXISTS(SELECT 1 FROM branding_version_files f WHERE f.version_id=NEW.id AND f.purpose='Design proof' AND f.proof_revision=NEW.revision) THEN RAISE EXCEPTION 'A proof for the current revision is required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'placements') p WHERE NOT EXISTS(SELECT 1 FROM branding_version_files f WHERE f.version_id=NEW.id AND f.purpose='Logo' AND f.asset_id::text=p->>'logoAssetId')) THEN RAISE EXCEPTION 'Placements require linked logos'; END IF;
  IF NOT EXISTS(SELECT 1 FROM product_specifications p JOIN specification_variants v ON v.specification_id=p.id JOIN branding_requests r ON r.id=NEW.request_id JOIN sales_order_items l ON l.id=r.sale_item_id WHERE p.id=NEW.specification_id AND p.status='Approved' AND v.variant_id=l.variant_id) THEN RAISE EXCEPTION 'Branding requires a matching approved engineering specification'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_branding_version BEFORE INSERT OR UPDATE OR DELETE ON branding_versions FOR EACH ROW EXECUTE FUNCTION guard_branding_version();
--> statement-breakpoint
CREATE FUNCTION guard_branding_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Stored branding asset metadata is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_branding_asset BEFORE UPDATE OR DELETE ON branding_assets FOR EACH ROW EXECUTE FUNCTION guard_branding_asset();
--> statement-breakpoint
CREATE FUNCTION guard_branding_file() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v branding_versions; parent_id uuid; asset_request uuid;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.version_id; ELSE parent_id:=NEW.version_id; END IF;
 SELECT * INTO v FROM branding_versions WHERE id=parent_id FOR UPDATE;
 IF v.status IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Only draft branding files can change'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.version_id<>OLD.version_id OR NEW.asset_id<>OLD.asset_id) THEN RAISE EXCEPTION 'Cannot move branding file links'; END IF;
 SELECT request_id INTO asset_request FROM branding_assets WHERE id=NEW.asset_id;
 IF asset_request IS DISTINCT FROM v.request_id THEN RAISE EXCEPTION 'Asset belongs to another branding request'; END IF;
 IF NEW.purpose='Design proof' AND NEW.proof_revision IS DISTINCT FROM v.revision THEN RAISE EXCEPTION 'Proof revision does not match the draft'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_branding_files BEFORE INSERT OR UPDATE OR DELETE ON branding_version_files FOR EACH ROW EXECUTE FUNCTION guard_branding_file();
--> statement-breakpoint
CREATE FUNCTION guard_branding_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_status text;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT o.status INTO order_status FROM sales_orders o JOIN sales_order_items l ON l.order_id=o.id WHERE l.id=NEW.sale_item_id FOR UPDATE OF o;
  IF order_status IS DISTINCT FROM 'Draft' OR EXISTS(SELECT 1 FROM manufacturing_orders m WHERE m.sale_item_id=NEW.sale_item_id) THEN RAISE EXCEPTION 'Request branding before confirmation and manufacturing'; END IF;
 ELSE
  IF NEW.sale_item_id<>OLD.sale_item_id THEN RAISE EXCEPTION 'Branding sales line is immutable'; END IF;
  IF OLD.approved_version_id IS NOT NULL AND NEW.approved_version_id IS NULL THEN RAISE EXCEPTION 'Approved branding cannot be silently removed'; END IF;
 END IF;
 IF NEW.approved_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branding_versions v WHERE v.id=NEW.approved_version_id AND v.request_id=NEW.id AND v.status='Approved') THEN RAISE EXCEPTION 'Select an approved version belonging to the request'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valid_branding_request BEFORE INSERT OR UPDATE ON branding_requests FOR EACH ROW EXECUTE FUNCTION guard_branding_request();
--> statement-breakpoint
CREATE FUNCTION guard_manufacturing_branding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.branding_version_id IS NOT NULL AND (NEW.branding_version_id IS DISTINCT FROM OLD.branding_version_id OR NEW.sale_item_id IS DISTINCT FROM OLD.sale_item_id) THEN RAISE EXCEPTION 'Manufacturing branding version is immutable'; END IF;
 IF NEW.branding_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branding_versions v JOIN branding_requests r ON r.id=v.request_id WHERE v.id=NEW.branding_version_id AND r.sale_item_id=NEW.sale_item_id AND v.status='Approved' AND v.specification_id=NEW.specification_id) THEN RAISE EXCEPTION 'Manufacturing requires approved branding matching its sales line and engineering version'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM branding_requests r WHERE r.sale_item_id=NEW.sale_item_id) AND NEW.branding_version_id IS NULL THEN RAISE EXCEPTION 'Customized orders require an approved branding version'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER manufacturing_branding_version BEFORE INSERT OR UPDATE ON manufacturing_orders FOR EACH ROW EXECUTE FUNCTION guard_manufacturing_branding();
--> statement-breakpoint
CREATE FUNCTION guard_sales_branding_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='Draft' AND NEW.status<>'Draft' AND NEW.status<>'Cancelled' AND EXISTS(SELECT 1 FROM branding_requests r JOIN sales_order_items l ON l.id=r.sale_item_id WHERE l.order_id=NEW.id AND r.approved_version_id IS NULL) THEN RAISE EXCEPTION 'Branding approval is required before confirmation'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_branding_approval BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION guard_sales_branding_confirmation();
--> statement-breakpoint
CREATE UNIQUE INDEX branding_proof_revision ON branding_version_files(version_id,proof_revision) WHERE purpose='Design proof';
--> statement-breakpoint
CREATE FUNCTION guard_branding_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE branding_id uuid;
BEGIN
 SELECT branding_version_id INTO branding_id FROM manufacturing_orders WHERE id=NEW.order_id;
 IF NEW.branding_version_id IS DISTINCT FROM branding_id THEN RAISE EXCEPTION 'Branding inspection must reference the manufacturing design version'; END IF;
 IF branding_id IS NOT NULL AND NEW.approved>0 AND NEW.branding_check IS DISTINCT FROM 'Pass' THEN RAISE EXCEPTION 'Branding must pass inspection before accepting units'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER branding_inspection_reference BEFORE INSERT OR UPDATE ON quality_inspections FOR EACH ROW EXECUTE FUNCTION guard_branding_inspection();
