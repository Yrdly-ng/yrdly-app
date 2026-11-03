-- Keep legacy payment guards; allow the authenticated accepted-price staged contract.
CREATE OR REPLACE FUNCTION public.guard_booking_payment_and_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  provider_id uuid;
  requires_payment boolean;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO provider_id FROM public.businesses WHERE id = OLD.business_id;
  IF actor_id IS DISTINCT FROM OLD.customer_id AND actor_id IS DISTINCT FROM provider_id THEN
    RAISE EXCEPTION 'Only the booking parties may change this booking';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    RAISE EXCEPTION 'Booking identity and payment state cannot be changed by a user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status NOT IN ('confirmed', 'completed', 'no_show', 'cancelled', 'late_cancelled')
       OR (NEW.status = 'confirmed' AND OLD.status <> 'requested')
       OR (NEW.status IN ('completed', 'no_show') AND OLD.status <> 'confirmed')
       OR (NEW.status IN ('cancelled', 'late_cancelled') AND OLD.status NOT IN ('requested', 'confirmed')) THEN
      RAISE EXCEPTION 'Invalid booking status transition';
    END IF;
    IF NEW.status IN ('cancelled', 'late_cancelled')
       AND OLD.payment_status IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
      RAISE EXCEPTION 'Paid booking cancellation requires assisted refund';
    END IF;
    IF NEW.status IN ('confirmed', 'completed') AND actor_id IS DISTINCT FROM provider_id THEN
      RAISE EXCEPTION 'Only the provider may confirm or complete a booking';
    END IF;
    IF NEW.status = 'confirmed' AND NOT (NEW.payment_flow='staged_50_50' AND NEW.accepted_at IS NOT NULL AND NEW.accepted_by=actor_id AND NEW.agreed_price>=1200) THEN
      SELECT (deposit_required OR requires_full_payment OR escrow_enabled)
        INTO requires_payment FROM public.service_offerings WHERE id = OLD.service_id;
      IF (requires_payment OR OLD.quote_id IS NOT NULL)
         AND OLD.payment_status NOT IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
        RAISE EXCEPTION 'Payment is required before confirming this booking';
      END IF;
    END IF;
  END IF;
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status AND OLD.payment_flow='staged_50_50' THEN
    IF OLD.payment_status NOT IN ('fully_paid','escrow_held','escrow_released') OR NOT EXISTS(
      SELECT 1 FROM public.booking_milestone_releases WHERE booking_id=OLD.id AND position=1 AND status='released'
    ) THEN RAISE EXCEPTION 'Fund the service and verify the first release before completion'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
