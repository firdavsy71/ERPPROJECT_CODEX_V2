ALTER TABLE "company_settings" ADD COLUMN "primary_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_primary_warehouse_id_warehouses_id_fk" FOREIGN KEY ("primary_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE company_settings SET primary_warehouse_id=(SELECT id FROM warehouses ORDER BY id LIMIT 1);
--> statement-breakpoint
CREATE FUNCTION guard_primary_warehouse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.primary_warehouse_id IS DISTINCT FROM OLD.primary_warehouse_id AND EXISTS(SELECT 1 FROM inventory_balances WHERE reserved>0) THEN
    RAISE EXCEPTION 'Release existing reservations before changing the primary operational warehouse';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER primary_warehouse_change_guard BEFORE UPDATE ON company_settings FOR EACH ROW EXECUTE FUNCTION guard_primary_warehouse_change();
