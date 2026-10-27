CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"material_id" uuid,
	"variant_id" uuid,
	"on_hand" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "one_stock_item" CHECK (("inventory_balances"."material_id" is null) <> ("inventory_balances"."variant_id" is null)),
	CONSTRAINT "valid_balance" CHECK ("inventory_balances"."on_hand" >= 0 and "inventory_balances"."reserved" >= 0 and "inventory_balances"."reserved" <= "inventory_balances"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "bom_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "bom_positive" CHECK ("bom_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "bom_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"labor_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"email" text,
	"phone" text,
	"address" text,
	"tax_id" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"department" text,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"approved" integer NOT NULL,
	"rejected" integer NOT NULL,
	"notes" text,
	"inspector_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_inspections_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"due_date" text NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Unpaid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoice_money" CHECK ("invoices"."total">=0 and "invoices"."paid">=0 and "invoices"."paid"<="invoices"."total" and "invoices"."tax_rate">=0 and "invoices"."tax_rate"<=100)
);
--> statement-breakpoint
CREATE TABLE "manufacturing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"sale_item_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"defective" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"due_date" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "production_status" CHECK ("manufacturing_orders"."status" in ('Draft','Planned','In Progress','Quality Control','Completed','Cancelled')),
	CONSTRAINT "production_quantities" CHECK ("manufacturing_orders"."quantity">0 and "manufacturing_orders"."completed">=0 and "manufacturing_orders"."defective">=0 and "manufacturing_orders"."completed"+"manufacturing_orders"."defective"<="manufacturing_orders"."quantity")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category" text DEFAULT 'Fabric' NOT NULL,
	"unit" text NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"minimum" numeric(18, 4) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_sku_unique" UNIQUE("sku"),
	CONSTRAINT "material_nonnegative" CHECK ("materials"."price" >= 0 and "materials"."minimum" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved_delta" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_operation_key_unique" UNIQUE("operation_key")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reference" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "positive_payment" CHECK ("payments"."amount">0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category_id" uuid,
	"description" text,
	"image_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received" numeric(18, 4) DEFAULT '0' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "valid_purchase_line" CHECK ("purchase_order_items"."quantity">0 and "purchase_order_items"."received">=0 and "purchase_order_items"."received"<="purchase_order_items"."quantity" and "purchase_order_items"."price">=0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"currency" text DEFAULT 'UZS' NOT NULL,
	"expected_date" text,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_operation_key_unique" UNIQUE("operation_key")
);
--> statement-breakpoint
CREATE TABLE "production_material_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"consumed" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"shipped" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "valid_sales_line" CHECK ("sales_order_items"."quantity">0 and "sales_order_items"."price">=0 and "sales_order_items"."discount">=0 and "sales_order_items"."discount"<=100 and "sales_order_items"."reserved">=0 and "sales_order_items"."shipped">=0 and "sales_order_items"."reserved"+"sales_order_items"."shipped"<="sales_order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"currency" text DEFAULT 'UZS' NOT NULL,
	"delivery_date" text,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "sales_status" CHECK ("sales_orders"."status" in ('Draft','Confirmed','Awaiting Production','Ready for Shipment','Partially Shipped','Shipped','Completed','Cancelled'))
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'Workwear ERP' NOT NULL,
	"currency" text DEFAULT 'UZS' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
	"tax_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"address" text,
	"email" text,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_operation_key_unique" UNIQUE("operation_key")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "valid_role" CHECK ("users"."role" in ('admin','production','sales','inventory','viewer'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"size" text NOT NULL,
	"color" text NOT NULL,
	"fabric" text,
	"cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "nonnegative_prices" CHECK ("product_variants"."cost" >= 0 and "product_variants"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "warehouses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_bom_versions_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_bom_id_bom_versions_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bom_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_sale_item_id_sales_order_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_balance_id_inventory_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_reservations" ADD CONSTRAINT "production_material_reservations_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."manufacturing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_material_reservations" ADD CONSTRAINT "production_material_reservations_balance_id_inventory_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_sale_item_id_sales_order_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_warehouse" ON "inventory_balances" USING btree ("warehouse_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_warehouse" ON "inventory_balances" USING btree ("warehouse_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_material" ON "bom_items" USING btree ("bom_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_version" ON "bom_versions" USING btree ("variant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "production_balance" ON "production_material_reservations" USING btree ("order_id","balance_id");