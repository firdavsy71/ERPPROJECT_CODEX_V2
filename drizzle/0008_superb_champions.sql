CREATE TABLE "pricing_retirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"effective_date" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_retirements_rule_id_unique" UNIQUE("rule_id")
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"customer_id" uuid,
	"variant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"minimum" integer NOT NULL,
	"tiers" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rule_valid" CHECK ("pricing_rules"."kind" in ('Contract','Customer','Volume','Standard') and "pricing_rules"."currency" in ('UZS','USD') and "pricing_rules"."minimum">0 and "pricing_rules"."start_date"<="pricing_rules"."end_date" and "pricing_rules"."status" in ('Draft','Approved','Rejected') and ("pricing_rules"."status"='Approved')=("pricing_rules"."approved_by" is not null) and (("pricing_rules"."kind" in ('Contract','Customer'))=("pricing_rules"."customer_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"valid_until" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"lines" jsonb NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_number_unique" UNIQUE("number"),
	CONSTRAINT "quotation_status" CHECK ("quotations"."status" in ('Draft','Approved','Rejected','Converted') and "quotations"."total">=0 and ("quotations"."status" in ('Approved','Converted'))=("quotations"."approved_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "pricing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "quotation_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "pricing_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "pricing_retirements" ADD CONSTRAINT "pricing_retirements_rule_id_pricing_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_retirements" ADD CONSTRAINT "pricing_retirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pricing_approved_by_users_id_fk" FOREIGN KEY ("pricing_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_unique" UNIQUE("quotation_id");
--> statement-breakpoint
CREATE FUNCTION guard_pricing_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status<>'Draft') THEN RAISE EXCEPTION 'Reviewed pricing versions are immutable'; END IF;
 IF NEW.status='Approved' AND EXISTS(SELECT 1 FROM pricing_rules r LEFT JOIN pricing_retirements e ON e.rule_id=r.id WHERE r.id<>NEW.id AND r.status='Approved' AND r.kind=NEW.kind AND r.variant_id=NEW.variant_id AND r.customer_id IS NOT DISTINCT FROM NEW.customer_id AND r.currency=NEW.currency AND r.start_date<=NEW.end_date AND least(r.end_date::date,coalesce(e.effective_date::date-1,'9999-12-31'::date))>=NEW.start_date::date) THEN RAISE EXCEPTION 'Approved pricing intervals cannot overlap'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pricing_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing_rules FOR EACH ROW EXECUTE FUNCTION guard_pricing_rule();
--> statement-breakpoint
CREATE FUNCTION immutable_price_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Price retirement history is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER pricing_retirement_immutable BEFORE UPDATE OR DELETE ON pricing_retirements FOR EACH ROW EXECUTE FUNCTION immutable_price_retirement();
--> statement-breakpoint
CREATE FUNCTION guard_quotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Quotation history cannot be deleted'; END IF;
 IF OLD.status<>'Draft' AND (OLD.status<>'Approved' OR NEW.status<>'Converted' OR NEW.lines<>OLD.lines OR NEW.customer_id<>OLD.customer_id OR NEW.currency<>OLD.currency OR NEW.valid_until<>OLD.valid_until OR NEW.total<>OLD.total OR NEW.notes<>OLD.notes OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN RAISE EXCEPTION 'Approved quotation prices and terms are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER quotation_guard BEFORE UPDATE OR DELETE ON quotations FOR EACH ROW EXECUTE FUNCTION guard_quotation();
--> statement-breakpoint
CREATE FUNCTION freeze_agreed_sales_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o sales_orders;
BEGIN
 IF TG_OP='INSERT' THEN SELECT * INTO o FROM sales_orders WHERE id=NEW.order_id; IF o.status<>'Draft' THEN RAISE EXCEPTION 'Cannot add lines to confirmed orders'; END IF; RETURN NEW; END IF;
 SELECT * INTO o FROM sales_orders WHERE id=OLD.order_id;
 IF o.status<>'Draft' OR o.pricing_approved_by IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agreed order lines cannot be deleted'; END IF;
  IF NEW.order_id<>OLD.order_id OR NEW.variant_id<>OLD.variant_id OR NEW.quantity<>OLD.quantity OR NEW.price<>OLD.price OR NEW.discount<>OLD.discount OR NEW.pricing_snapshot<>OLD.pricing_snapshot OR (o.status<>'Draft' AND NEW.branding_total<>OLD.branding_total) THEN RAISE EXCEPTION 'Agreed order prices and quantities are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agreed_sales_line BEFORE INSERT OR UPDATE OR DELETE ON sales_order_items FOR EACH ROW EXECUTE FUNCTION freeze_agreed_sales_line();
--> statement-breakpoint
CREATE FUNCTION freeze_agreed_sales_header() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.status<>'Draft' OR OLD.pricing_approved_by IS NOT NULL) AND (NEW.customer_id<>OLD.customer_id OR NEW.currency<>OLD.currency OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id OR NEW.pricing_approved_by IS DISTINCT FROM OLD.pricing_approved_by OR (OLD.status<>'Draft' AND NEW.total<>OLD.total)) THEN RAISE EXCEPTION 'Agreed sales currency, customer and totals are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agreed_sales_header BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION freeze_agreed_sales_header();
--> statement-breakpoint
CREATE FUNCTION freeze_invoice_amount() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.total<>OLD.total OR NEW.order_id<>OLD.order_id THEN RAISE EXCEPTION 'Issued invoice amount is immutable'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_amount_guard BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION freeze_invoice_amount();
