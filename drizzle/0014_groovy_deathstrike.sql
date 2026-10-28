CREATE TABLE "certification_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certification_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" text NOT NULL,
	"sha256" text NOT NULL,
	"material_id" uuid,
	"supplier_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certification_id" uuid NOT NULL,
	"event" text NOT NULL,
	"notes" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"specification_id" uuid,
	"standard_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"issuer" text NOT NULL,
	"issue_date" text NOT NULL,
	"expiry_date" text NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certification_version_positive" CHECK ("certifications"."version" > 0),
	CONSTRAINT "certification_status" CHECK ("certifications"."status" in ('Draft','Approved','Revoked'))
);
--> statement-breakpoint
CREATE TABLE "safety_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_standards_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "certification_attachments" ADD CONSTRAINT "certification_attachments_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_attachments" ADD CONSTRAINT "certification_attachments_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_attachments" ADD CONSTRAINT "certification_attachments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_attachments" ADD CONSTRAINT "certification_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_events" ADD CONSTRAINT "certification_events_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certification_events" ADD CONSTRAINT "certification_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_specification_id_product_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."product_specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_standard_id_safety_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."safety_standards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_standards" ADD CONSTRAINT "safety_standards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certification_group_version" ON "certifications" USING btree ("group_id","version");
--> statement-breakpoint
CREATE FUNCTION guard_certification_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certification history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN RAISE EXCEPTION 'Certifications start as drafts'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'Draft' AND (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') THEN RAISE EXCEPTION 'Approved certification details are immutable'; END IF;
  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'Draft' AND NEW.status = 'Approved' THEN
      IF (to_jsonb(NEW) - 'status' - 'approved_by' - 'approved_at') <> (to_jsonb(OLD) - 'status' - 'approved_by' - 'approved_at') THEN RAISE EXCEPTION 'Approval cannot change certification details'; END IF;
      IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR length(trim(NEW.certificate_number))=0 OR length(trim(NEW.issuer))=0 OR length(trim(NEW.scope))=0 OR NEW.issue_date::date > NEW.expiry_date::date THEN RAISE EXCEPTION 'Certification details are incomplete'; END IF;
      IF NOT EXISTS (SELECT 1 FROM certification_attachments a WHERE a.certification_id=NEW.id AND a.kind='Certificate') THEN RAISE EXCEPTION 'Certificate evidence is required'; END IF;
      IF NEW.specification_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_specifications p WHERE p.id=NEW.specification_id AND p.product_id=NEW.product_id AND p.status='Approved') THEN RAISE EXCEPTION 'Linked specification must be approved for this product'; END IF;
    ELSIF NOT (OLD.status='Approved' AND NEW.status='Revoked') THEN
      RAISE EXCEPTION 'Invalid certification state transition';
    END IF;
  ELSIF OLD.status='Draft' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A draft cannot record approval';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER certification_guard BEFORE INSERT OR UPDATE OR DELETE ON certifications FOR EACH ROW EXECUTE FUNCTION guard_certification_version();
--> statement-breakpoint
CREATE FUNCTION guard_certification_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Certification evidence and history are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM certifications c WHERE c.id=NEW.certification_id AND c.status='Draft') THEN RAISE EXCEPTION 'Evidence can only be attached to drafts'; END IF;
  IF NEW.kind NOT IN ('Certificate','Testing report','Material certification','Supplier declaration') OR NEW.bytes <= 0 OR NEW.bytes > 2097152 THEN RAISE EXCEPTION 'Invalid certification evidence'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER certification_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON certification_attachments FOR EACH ROW EXECUTE FUNCTION guard_certification_evidence();
--> statement-breakpoint
CREATE FUNCTION immutable_certification_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Certification history is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER certification_event_immutable BEFORE UPDATE OR DELETE ON certification_events FOR EACH ROW EXECUTE FUNCTION immutable_certification_event();
--> statement-breakpoint
CREATE FUNCTION guard_referenced_standard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.reference IS DISTINCT FROM OLD.reference OR NEW.title IS DISTINCT FROM OLD.title OR NEW.notes IS DISTINCT FROM OLD.notes) AND EXISTS (SELECT 1 FROM certifications c WHERE c.standard_id=OLD.id) THEN
    RAISE EXCEPTION 'Referenced standards are historical; add a new reference';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER referenced_standard_guard BEFORE UPDATE ON safety_standards FOR EACH ROW EXECUTE FUNCTION guard_referenced_standard();
