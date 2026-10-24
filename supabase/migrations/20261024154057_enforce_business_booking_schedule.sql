BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

-- A null staff choice consumes business-wide capacity; a named staff choice
-- only consumes that person's capacity. Overlap is enforced across transactions.
CREATE TYPE private.booking_staff_range AS RANGE (subtype = uuid);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings a JOIN public.bookings b
      ON a.business_id=b.business_id AND a.id<b.id
      AND (a.staff_id IS NULL OR b.staff_id IS NULL OR a.staff_id=b.staff_id)
      AND a.appointment_time<b.end_time AND b.appointment_time<a.end_time
    WHERE a.status IN ('requested','confirmed') AND b.status IN ('requested','confirmed')
  ) THEN
    RAISE EXCEPTION 'booking_schedule_existing_conflicts: resolve overlapping active appointments before applying this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE status IN ('requested','confirmed')
    AND (appointment_time IS NULL OR end_time IS NULL OR end_time<=appointment_time)) THEN
    RAISE EXCEPTION 'booking_schedule_existing_invalid_intervals';
  END IF;
END $$;

ALTER TABLE public.bookings ADD CONSTRAINT booking_active_interval_valid
  CHECK (status NOT IN ('requested','confirmed') OR
    (appointment_time IS NOT NULL AND end_time IS NOT NULL AND end_time>appointment_time));

SET LOCAL search_path = public, extensions, pg_catalog;
ALTER TABLE public.bookings ADD CONSTRAINT booking_schedule_no_overlap
  EXCLUDE USING gist (
    business_id WITH =,
    (private.booking_staff_range(staff_id,staff_id,'[]')) WITH &&,
    (tstzrange(appointment_time,end_time,'[)')) WITH &&
  ) WHERE (status IN ('requested','confirmed'));

-- Trigger-only privileged validation also protects inserts made by server code.
CREATE FUNCTION private.validate_business_booking_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  service public.service_offerings%ROWTYPE;
  business public.businesses%ROWTYPE;
  exception public.availability_exceptions%ROWTYPE;
  weekly public.provider_availability%ROWTYPE;
  local_start timestamp;
  local_end timestamp;
  opens time;
  closes time;
BEGIN
  IF NEW.status NOT IN ('requested','confirmed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status IN ('requested','confirmed') AND
      (NEW.business_id,NEW.service_id,NEW.customer_id,NEW.staff_id,NEW.appointment_time,NEW.end_time)
      IS NOT DISTINCT FROM
      (OLD.business_id,OLD.service_id,OLD.customer_id,OLD.staff_id,OLD.appointment_time,OLD.end_time)
    THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO business FROM public.businesses WHERE id=NEW.business_id;
  IF NOT FOUND OR business.is_active IS DISTINCT FROM true OR business.moderation_status IS DISTINCT FROM 'approved'
    OR coalesce(business.mode::text,'') NOT IN ('service','both') THEN
    RAISE EXCEPTION 'booking_business_unavailable' USING ERRCODE='23514';
  END IF;
  IF business.owner_id=NEW.customer_id THEN
    RAISE EXCEPTION 'booking_self_not_allowed' USING ERRCODE='23514';
  END IF;
  SELECT * INTO service FROM public.service_offerings WHERE id=NEW.service_id AND business_id=NEW.business_id;
  IF NOT FOUND OR NOT service.is_active OR service.duration_minutes IS NULL OR service.duration_minutes<=0 THEN
    RAISE EXCEPTION 'booking_service_unavailable' USING ERRCODE='23514';
  END IF;
  IF NEW.appointment_time IS NULL OR NEW.end_time IS NULL OR NEW.appointment_time<=now()
    OR NEW.end_time IS DISTINCT FROM NEW.appointment_time + service.duration_minutes * interval '1 minute' THEN
    RAISE EXCEPTION 'booking_duration_invalid' USING ERRCODE='23514';
  END IF;
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_staff s WHERE s.id=NEW.staff_id AND s.business_id=NEW.business_id AND s.is_active
  ) THEN RAISE EXCEPTION 'booking_staff_unavailable' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_staff_assignments WHERE service_id=NEW.service_id) THEN
    IF NEW.staff_id IS NULL THEN RAISE EXCEPTION 'booking_staff_required' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.service_staff_assignments WHERE service_id=NEW.service_id AND staff_id=NEW.staff_id) THEN
      RAISE EXCEPTION 'booking_staff_unassigned' USING ERRCODE='23514';
    END IF;
  END IF;
  local_start := NEW.appointment_time AT TIME ZONE 'Africa/Lagos';
  local_end := NEW.end_time AT TIME ZONE 'Africa/Lagos';
  SELECT * INTO exception FROM public.availability_exceptions
    WHERE business_id=NEW.business_id AND staff_id IS NOT DISTINCT FROM NEW.staff_id AND date=local_start::date;
  IF FOUND AND exception.is_blackout THEN
    RAISE EXCEPTION 'booking_outside_hours' USING ERRCODE='23514';
  END IF;
  IF exception.custom_start_time IS NOT NULL AND exception.custom_end_time IS NOT NULL THEN
    opens:=exception.custom_start_time; closes:=exception.custom_end_time;
  ELSE
    SELECT * INTO weekly FROM public.provider_availability
      WHERE business_id=NEW.business_id AND staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND day_of_week=extract(dow FROM local_start)::integer;
    IF NOT FOUND OR NOT weekly.is_available THEN
      RAISE EXCEPTION 'booking_outside_hours' USING ERRCODE='23514';
    END IF;
    opens:=weekly.start_time; closes:=weekly.end_time;
  END IF;
  IF opens IS NULL OR closes IS NULL OR closes<=opens OR local_end::date<>local_start::date
    OR local_start::time<opens OR local_end::time>closes
    OR mod(extract(epoch FROM (local_start - (local_start::date + opens)))::numeric,1800)<>0 THEN
    RAISE EXCEPTION 'booking_outside_hours' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.validate_business_booking_schedule() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_business_booking_schedule BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.validate_business_booking_schedule();
COMMIT;
