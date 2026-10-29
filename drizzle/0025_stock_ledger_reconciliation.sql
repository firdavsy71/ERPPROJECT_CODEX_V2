DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM inventory_balances b LEFT JOIN (SELECT balance_id,sum(quantity) q,sum(reserved_delta) r,sum(held_delta) h FROM inventory_movements GROUP BY balance_id) m ON m.balance_id=b.id WHERE b.on_hand<>coalesce(m.q,0) OR b.reserved<>coalesce(m.r,0) OR b.held<>coalesce(m.h,0)) THEN
 RAISE EXCEPTION 'Stock reconciliation preflight failed; investigate historical differences before migration';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION enforce_stock_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; b inventory_balances%ROWTYPE; q numeric; r numeric; h numeric;
BEGIN
 IF TG_TABLE_NAME='inventory_balances' THEN target_id := NEW.id; ELSE target_id := NEW.balance_id; END IF;
 SELECT * INTO b FROM inventory_balances WHERE id=target_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT coalesce(sum(quantity),0),coalesce(sum(reserved_delta),0),coalesce(sum(held_delta),0) INTO q,r,h FROM inventory_movements WHERE balance_id=target_id;
 IF b.on_hand<>q OR b.reserved<>r OR b.held<>h THEN RAISE EXCEPTION 'Inventory balance must reconcile with immutable movement journal'; END IF;
 IF b.roll_tracked AND b.held<>(SELECT coalesce(sum(held_length),0) FROM fabric_rolls WHERE balance_id=b.id) THEN RAISE EXCEPTION 'Roll quality holds must reconcile with inventory'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_balance_journal_check AFTER INSERT OR UPDATE ON inventory_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_stock_journal();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_movement_journal_check AFTER INSERT ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_stock_journal();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_roll_hold_check AFTER INSERT OR UPDATE ON fabric_rolls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_stock_journal();
--> statement-breakpoint
CREATE INDEX inventory_movement_balance_idx ON inventory_movements(balance_id);
--> statement-breakpoint
CREATE INDEX material_reservation_balance_idx ON production_material_reservations(balance_id);
