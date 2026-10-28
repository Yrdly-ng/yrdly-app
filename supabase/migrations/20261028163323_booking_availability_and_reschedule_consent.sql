BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

-- Public wrappers expose only authorized commands, never customer booking rows.
CREATE FUNCTION private.booking_busy_intervals(p_business_id uuid,p_date date,p_staff_id uuid DEFAULT NULL,p_exclude_booking_id uuid DEFAULT NULL)
RETURNS TABLE(appointment_time timestamptz,end_time timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to view availability'; END IF;
  IF p_date IS NULL OR p_date < (now() AT TIME ZONE 'Africa/Lagos')::date OR p_date > (now() AT TIME ZONE 'Africa/Lagos')::date+365 THEN
    RAISE EXCEPTION 'Choose a date within the next year';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business_id AND is_active AND moderation_status='approved' AND mode::text IN ('service','both')) THEN
    RAISE EXCEPTION 'Business is unavailable';
  END IF;
  IF p_staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_staff WHERE id=p_staff_id AND business_id=p_business_id AND is_active) THEN
    RAISE EXCEPTION 'Staff member is unavailable';
  END IF;
  IF p_exclude_booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bookings b JOIN public.businesses biz ON biz.id=b.business_id
    WHERE b.id=p_exclude_booking_id AND b.business_id=p_business_id AND b.staff_id IS NOT DISTINCT FROM p_staff_id
      AND (b.customer_id=auth.uid() OR biz.owner_id=auth.uid())) THEN RAISE EXCEPTION 'Booking not found'; END IF;
  RETURN QUERY SELECT b.appointment_time,b.end_time FROM public.bookings b
    WHERE b.business_id=p_business_id AND b.status IN ('requested','confirmed')
    AND (p_exclude_booking_id IS NULL OR b.id<>p_exclude_booking_id)
    AND (p_staff_id IS NULL OR b.staff_id IS NULL OR b.staff_id=p_staff_id)
    AND b.appointment_time<((p_date+1)::timestamp AT TIME ZONE 'Africa/Lagos')
    AND b.end_time>(p_date::timestamp AT TIME ZONE 'Africa/Lagos');
END $$;
CREATE FUNCTION public.booking_busy_intervals(p_business_id uuid,p_date date,p_staff_id uuid DEFAULT NULL,p_exclude_booking_id uuid DEFAULT NULL)
RETURNS TABLE(appointment_time timestamptz,end_time timestamptz) LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM private.booking_busy_intervals(p_business_id,p_date,p_staff_id,p_exclude_booking_id) $$;

CREATE FUNCTION private.set_booking_availability_exception(p_business_id uuid,p_date date,p_is_blackout boolean,
 p_staff_id uuid DEFAULT NULL,p_custom_start_time time DEFAULT NULL,p_custom_end_time time DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS public.availability_exceptions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.availability_exceptions;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business_id AND owner_id=auth.uid()) THEN
    RAISE EXCEPTION 'Only the business owner can change availability'; END IF;
  IF p_staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_staff WHERE id=p_staff_id AND business_id=p_business_id AND is_active) THEN
    RAISE EXCEPTION 'Staff member is unavailable'; END IF;
  IF p_date IS NULL OR p_is_blackout IS NULL OR (NOT p_is_blackout AND
      (p_custom_start_time IS NULL OR p_custom_end_time IS NULL OR p_custom_end_time<=p_custom_start_time)) THEN
    RAISE EXCEPTION 'Set valid opening and closing times'; END IF;
  -- Serialize both legacy and staff scopes, independent of partial index names.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||coalesce(p_staff_id::text,'default')||':'||p_date::text,0));
  UPDATE public.availability_exceptions SET is_blackout=p_is_blackout,
    custom_start_time=CASE WHEN p_is_blackout THEN NULL ELSE p_custom_start_time END,
    custom_end_time=CASE WHEN p_is_blackout THEN NULL ELSE p_custom_end_time END,reason=p_reason
    WHERE business_id=p_business_id AND date=p_date AND staff_id IS NOT DISTINCT FROM p_staff_id RETURNING * INTO result;
  IF NOT FOUND THEN
    INSERT INTO public.availability_exceptions(business_id,staff_id,date,is_blackout,custom_start_time,custom_end_time,reason)
    VALUES(p_business_id,p_staff_id,p_date,p_is_blackout,CASE WHEN p_is_blackout THEN NULL ELSE p_custom_start_time END,
      CASE WHEN p_is_blackout THEN NULL ELSE p_custom_end_time END,p_reason) RETURNING * INTO result;
  END IF;
  RETURN result;
END $$;
CREATE FUNCTION public.set_booking_availability_exception(p_business_id uuid,p_date date,p_is_blackout boolean,
 p_staff_id uuid DEFAULT NULL,p_custom_start_time time DEFAULT NULL,p_custom_end_time time DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS public.availability_exceptions LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.set_booking_availability_exception(p_business_id,p_date,p_is_blackout,p_staff_id,p_custom_start_time,p_custom_end_time,p_reason) $$;

CREATE TABLE public.booking_reschedule_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES public.users(id),appointment_time timestamptz NOT NULL,end_time timestamptz NOT NULL,
 original_appointment_time timestamptz NOT NULL,original_end_time timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(),responded_at timestamptz,
 CHECK(end_time>appointment_time)
);
CREATE UNIQUE INDEX booking_one_pending_reschedule ON public.booking_reschedule_requests(booking_id) WHERE status='pending';
ALTER TABLE public.booking_reschedule_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_reschedule_participant_read ON public.booking_reschedule_requests FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.bookings b JOIN public.businesses biz ON biz.id=b.business_id
  WHERE b.id=booking_id AND (b.customer_id=auth.uid() OR biz.owner_id=auth.uid())));
REVOKE ALL ON public.booking_reschedule_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.booking_reschedule_requests TO authenticated;

-- Single-use permission consumed by the booking trigger in this transaction.
CREATE TABLE private.booking_reschedule_permissions(booking_id uuid PRIMARY KEY,transaction_id bigint NOT NULL);
REVOKE ALL ON private.booking_reschedule_permissions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.check_booking_reschedule_payment(p_booking_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.bookings WHERE id=p_booking_id AND payment_status::text IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released'))
 OR EXISTS(SELECT 1 FROM public.booking_payments p LEFT JOIN public.escrow_transactions x ON x.id=p.escrow_transaction_id
   WHERE p.booking_id=p_booking_id AND (p.status::text IN ('deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released')
   OR x.status IN ('pending','creating_escrow','reconciling','paid','shipped','delivered','disputed','completed'))) THEN
   RAISE EXCEPTION 'Contact support to reschedule a booking with an active checkout or payment';
 END IF;
END $$;

CREATE FUNCTION private.request_booking_reschedule(p_booking_id uuid,p_appointment_time timestamptz)
RETURNS public.booking_reschedule_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE booking public.bookings; result public.booking_reschedule_requests; duration interval;
BEGIN
 SELECT * INTO booking FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR (booking.customer_id<>auth.uid() AND NOT EXISTS(
  SELECT 1 FROM public.businesses WHERE id=booking.business_id AND owner_id=auth.uid())) THEN RAISE EXCEPTION 'Booking not found'; END IF;
 IF booking.status NOT IN ('requested','confirmed') OR booking.appointment_time<=now() THEN RAISE EXCEPTION 'Only upcoming active bookings can be rescheduled'; END IF;
 IF p_appointment_time IS NULL OR p_appointment_time<=now() OR p_appointment_time>now()+interval '365 days' OR p_appointment_time=booking.appointment_time THEN
  RAISE EXCEPTION 'Choose a different future time within the next year'; END IF;
 PERFORM private.check_booking_reschedule_payment(booking.id);
 IF EXISTS(SELECT 1 FROM public.booking_reschedule_requests WHERE booking_id=booking.id AND status='pending') THEN
  RAISE EXCEPTION 'Respond to or withdraw the existing time change first'; END IF;
 duration:=booking.end_time-booking.appointment_time;
 INSERT INTO public.booking_reschedule_requests(booking_id,requested_by,appointment_time,end_time,original_appointment_time,original_end_time)
 VALUES(booking.id,auth.uid(),p_appointment_time,p_appointment_time+duration,booking.appointment_time,booking.end_time) RETURNING * INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.request_booking_reschedule(p_booking_id uuid,p_appointment_time timestamptz)
RETURNS public.booking_reschedule_requests LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.request_booking_reschedule(p_booking_id,p_appointment_time) $$;

CREATE FUNCTION private.respond_booking_reschedule(p_request_id uuid,p_action text)
RETURNS public.booking_reschedule_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.booking_reschedule_requests; booking public.bookings; target uuid;
BEGIN
 SELECT booking_id INTO target FROM public.booking_reschedule_requests WHERE id=p_request_id;
 SELECT * INTO booking FROM public.bookings WHERE id=target FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR (booking.customer_id<>auth.uid() AND NOT EXISTS(
 SELECT 1 FROM public.businesses WHERE id=booking.business_id AND owner_id=auth.uid())) THEN RAISE EXCEPTION 'Booking not found'; END IF;
 SELECT * INTO request FROM public.booking_reschedule_requests WHERE id=p_request_id FOR UPDATE;
 IF request.status<>'pending' THEN RAISE EXCEPTION 'This time change has already been handled'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('accept','reject','withdraw') THEN RAISE EXCEPTION 'Invalid response'; END IF;
 IF (p_action='withdraw' AND request.requested_by<>auth.uid()) OR (p_action IN ('accept','reject') AND request.requested_by=auth.uid()) THEN
  RAISE EXCEPTION 'The other party must approve or decline this time change'; END IF;
 IF p_action='accept' THEN
  IF booking.status NOT IN ('requested','confirmed') OR booking.appointment_time<=now() OR request.appointment_time<=now()
  OR (booking.appointment_time,booking.end_time) IS DISTINCT FROM (request.original_appointment_time,request.original_end_time) THEN
   RAISE EXCEPTION 'Booking changed; withdraw this request and choose a new time'; END IF;
  PERFORM private.check_booking_reschedule_payment(booking.id);
  INSERT INTO private.booking_reschedule_permissions VALUES(booking.id,txid_current());
  -- Existing schedule trigger and GiST exclusion revalidate hours, staff, duration and conflicts atomically.
  UPDATE public.bookings SET appointment_time=request.appointment_time,end_time=request.end_time,
   reminder_24h_sent=false,reminder_2h_sent=false,updated_at=now() WHERE id=booking.id;
 END IF;
 UPDATE public.booking_reschedule_requests SET status=CASE p_action WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' ELSE 'withdrawn' END,
 responded_at=now() WHERE id=p_request_id RETURNING * INTO request;
 RETURN request;
END $$;
CREATE FUNCTION public.respond_booking_reschedule(p_request_id uuid,p_action text)
RETURNS public.booking_reschedule_requests LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.respond_booking_reschedule(p_request_id,p_action) $$;

CREATE FUNCTION private.guard_booking_time_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status AND OLD.end_time>now() THEN
  RAISE EXCEPTION 'Wait until the appointment has ended before completing it'; END IF;
 IF (NEW.appointment_time,NEW.end_time) IS DISTINCT FROM (OLD.appointment_time,OLD.end_time) THEN
  DELETE FROM private.booking_reschedule_permissions WHERE booking_id=OLD.id AND transaction_id=txid_current();
  IF NOT FOUND THEN RAISE EXCEPTION 'Request a time change and have the other party approve it'; END IF;
 END IF;
 IF NEW.status NOT IN ('requested','confirmed') AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE public.booking_reschedule_requests SET status='withdrawn',responded_at=now() WHERE booking_id=OLD.id AND status='pending';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_time_changes BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.guard_booking_time_changes();

GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON FUNCTION private.check_booking_reschedule_payment(uuid),private.guard_booking_time_changes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.booking_busy_intervals(uuid,date,uuid,uuid),public.booking_busy_intervals(uuid,date,uuid,uuid),
 private.set_booking_availability_exception(uuid,date,boolean,uuid,time,time,text),public.set_booking_availability_exception(uuid,date,boolean,uuid,time,time,text),
 private.request_booking_reschedule(uuid,timestamptz),public.request_booking_reschedule(uuid,timestamptz),
 private.respond_booking_reschedule(uuid,text),public.respond_booking_reschedule(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.booking_busy_intervals(uuid,date,uuid,uuid),public.booking_busy_intervals(uuid,date,uuid,uuid),
 private.set_booking_availability_exception(uuid,date,boolean,uuid,time,time,text),public.set_booking_availability_exception(uuid,date,boolean,uuid,time,time,text),
 private.request_booking_reschedule(uuid,timestamptz),public.request_booking_reschedule(uuid,timestamptz),
 private.respond_booking_reschedule(uuid,text),public.respond_booking_reschedule(uuid,text) TO authenticated;
-- A linked booking is evidence of a completed service, not a caller-supplied badge.
CREATE FUNCTION private.guard_booking_review_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.booking_id,NEW.user_id,NEW.business_id) IS DISTINCT FROM (OLD.booking_id,OLD.user_id,OLD.business_id) THEN
   RAISE EXCEPTION 'Review author, business and booking cannot be changed'; END IF;
 END IF;
 IF NEW.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bookings b
  WHERE b.id=NEW.booking_id AND b.customer_id=NEW.user_id AND b.business_id=NEW.business_id AND b.status='completed') THEN
  RAISE EXCEPTION 'Only the customer of a completed booking can leave a verified service review'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_booking_review_link() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_booking_review_link BEFORE INSERT OR UPDATE ON public.business_reviews
 FOR EACH ROW EXECUTE FUNCTION private.guard_booking_review_link();
COMMIT;
