BEGIN;
ALTER TABLE public.bookings ADD COLUMN agreed_price numeric,
 ADD COLUMN accepted_at timestamptz, ADD COLUMN accepted_by uuid REFERENCES public.users(id),
 ADD COLUMN payment_flow text NOT NULL DEFAULT 'legacy' CHECK(payment_flow IN ('legacy','staged_50_50')),
 ADD CONSTRAINT booking_agreed_price_valid CHECK(agreed_price IS NULL OR
  (agreed_price::text NOT IN ('NaN','Infinity','-Infinity') AND agreed_price>=1200 AND round(agreed_price,2)=agreed_price));

CREATE FUNCTION private.guard_booking_acceptance_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE service public.service_offerings; quote public.quote_requests; price numeric;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='confirmed' OR NEW.agreed_price IS NOT NULL OR NEW.accepted_at IS NOT NULL OR NEW.accepted_by IS NOT NULL OR NEW.payment_flow<>'legacy' THEN
   RAISE EXCEPTION 'Create a booking request before provider acceptance'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.agreed_price,NEW.accepted_at,NEW.accepted_by,NEW.payment_flow) IS DISTINCT FROM (OLD.agreed_price,OLD.accepted_at,OLD.accepted_by,OLD.payment_flow) THEN
  RAISE EXCEPTION 'The accepted booking price and payment terms cannot be changed'; END IF;
 IF OLD.agreed_price IS NOT NULL AND (NEW.business_id,NEW.service_id,NEW.customer_id,NEW.staff_id,NEW.quote_id) IS DISTINCT FROM
 (OLD.business_id,OLD.service_id,OLD.customer_id,OLD.staff_id,OLD.quote_id) THEN RAISE EXCEPTION 'Accepted booking details cannot be changed'; END IF;
 IF OLD.status='confirmed' AND NEW.status='requested' THEN RAISE EXCEPTION 'An accepted booking cannot return to requested'; END IF;
 IF NEW.status='confirmed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  IF OLD.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'An accepted booking cannot be accepted again'; END IF;
  IF (NEW.business_id,NEW.service_id,NEW.customer_id,NEW.staff_id,NEW.quote_id) IS DISTINCT FROM
   (OLD.business_id,OLD.service_id,OLD.customer_id,OLD.staff_id,OLD.quote_id) THEN RAISE EXCEPTION 'Accept the existing booking details without changing them'; END IF;
  IF OLD.status<>'requested' OR OLD.appointment_time<=now() THEN RAISE EXCEPTION 'Only upcoming booking requests can be accepted'; END IF;
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=OLD.business_id AND owner_id=auth.uid()) THEN
   RAISE EXCEPTION 'Only the business owner can accept a booking'; END IF;
  -- Existing financial reservations retain their original contract, including legacy requested checkouts.
  IF OLD.payment_status::text IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released') OR EXISTS(
   SELECT 1 FROM public.booking_payments WHERE booking_id=OLD.id AND status::text IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released')) THEN RETURN NEW; END IF;
  SELECT * INTO service FROM public.service_offerings WHERE id=OLD.service_id AND business_id=OLD.business_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service is unavailable'; END IF;
  IF OLD.quote_id IS NULL AND NOT coalesce(service.deposit_required,false) AND NOT coalesce(service.requires_full_payment,false)
   AND NOT coalesce(service.escrow_enabled,false) THEN RETURN NEW; END IF;
  IF OLD.quote_id IS NOT NULL THEN
   SELECT * INTO quote FROM public.quote_requests WHERE id=OLD.quote_id AND customer_id=OLD.customer_id AND business_id=OLD.business_id
    AND status='converted' AND converted_booking_id=OLD.id AND (expires_at IS NULL OR expires_at>now());
   IF NOT FOUND THEN RAISE EXCEPTION 'An accepted customer quote is required to agree the final price'; END IF;
   price:=quote.estimated_price;
  ELSE
   IF service.price_is_from THEN RAISE EXCEPTION 'Agree the final price through an accepted customer quote before accepting this booking'; END IF;
   price:=service.price;
  END IF;
  IF price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price<1200 OR round(price,2)<>price THEN
   RAISE EXCEPTION 'An agreed price of at least NGN 1,200 is required'; END IF;
  NEW.agreed_price:=price; NEW.accepted_at:=now(); NEW.accepted_by:=auth.uid(); NEW.payment_flow:='staged_50_50';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_acceptance_price BEFORE INSERT OR UPDATE ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION private.guard_booking_acceptance_price();
REVOKE ALL ON FUNCTION private.guard_booking_acceptance_price() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.accept_service_booking(p_booking_id uuid) RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE booking public.bookings;
BEGIN
 SELECT * INTO booking FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=booking.business_id AND owner_id=auth.uid()) THEN
  RAISE EXCEPTION 'Only the business owner can accept a booking'; END IF;
 IF booking.status='confirmed' THEN RETURN booking; END IF;
 UPDATE public.bookings SET status='confirmed',updated_at=now() WHERE id=p_booking_id RETURNING * INTO booking;
 RETURN booking;
END $$;
CREATE FUNCTION public.accept_service_booking(p_booking_id uuid) RETURNS public.bookings
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.accept_service_booking(p_booking_id) $$;
REVOKE ALL ON FUNCTION private.accept_service_booking(uuid),public.accept_service_booking(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.accept_service_booking(uuid),public.accept_service_booking(uuid) TO authenticated;
COMMIT;
