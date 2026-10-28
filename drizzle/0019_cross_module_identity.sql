-- Custom SQL migration file, put your code below! --
CREATE FUNCTION guard_used_material_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit IS DISTINCT FROM OLD.unit AND (
    EXISTS(SELECT 1 FROM bom_items WHERE material_id=OLD.id) OR
    EXISTS(SELECT 1 FROM purchase_order_items WHERE material_id=OLD.id) OR
    EXISTS(SELECT 1 FROM inventory_balances WHERE material_id=OLD.id)
  ) THEN RAISE EXCEPTION 'Cannot change unit of a material already used in inventory, purchasing or BOM'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER used_material_unit_guard BEFORE UPDATE ON materials FOR EACH ROW EXECUTE FUNCTION guard_used_material_unit();
--> statement-breakpoint
CREATE FUNCTION guard_used_variant_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.size IS DISTINCT FROM OLD.size OR NEW.color IS DISTINCT FROM OLD.color) AND (
    EXISTS(SELECT 1 FROM bom_versions WHERE variant_id=OLD.id) OR
    EXISTS(SELECT 1 FROM sales_order_items WHERE variant_id=OLD.id) OR
    EXISTS(SELECT 1 FROM inventory_balances WHERE variant_id=OLD.id) OR
    EXISTS(SELECT 1 FROM specification_variants WHERE variant_id=OLD.id)
  ) THEN RAISE EXCEPTION 'Cannot change identity of a variant already referenced by business records'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER used_variant_identity_guard BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION guard_used_variant_identity();
