CREATE FUNCTION protect_inventory_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are immutable; append a correcting movement';
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_journal_immutable BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION protect_inventory_journal();
--> statement-breakpoint
CREATE FUNCTION guard_payment_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF btrim(NEW.reference)='' THEN RAISE EXCEPTION 'Payment reference is required'; END IF;
  IF EXISTS(SELECT 1 FROM payments WHERE invoice_id=NEW.invoice_id AND lower(btrim(reference))=lower(btrim(NEW.reference))) THEN
    RAISE EXCEPTION 'Payment reference already recorded for this invoice';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_reference_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_reference();
