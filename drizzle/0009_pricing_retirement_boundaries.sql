CREATE OR REPLACE FUNCTION guard_pricing_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status<>'Draft') THEN RAISE EXCEPTION 'Reviewed pricing versions are immutable'; END IF;
 IF NEW.status='Approved' AND EXISTS(
  SELECT 1 FROM pricing_rules r LEFT JOIN pricing_retirements e ON e.rule_id=r.id
  WHERE r.id<>NEW.id AND r.status='Approved' AND r.kind=NEW.kind AND r.variant_id=NEW.variant_id
    AND r.customer_id IS NOT DISTINCT FROM NEW.customer_id AND r.currency=NEW.currency
    AND daterange(r.start_date::date,greatest(r.start_date::date,least(r.end_date::date,coalesce(e.effective_date::date-1,'9999-12-31'::date))+1),'[)')
        && daterange(NEW.start_date::date,NEW.end_date::date+1,'[)')
 ) THEN RAISE EXCEPTION 'Approved pricing intervals cannot overlap'; END IF;
 RETURN NEW;
END $$;
