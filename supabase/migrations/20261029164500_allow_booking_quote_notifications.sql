-- Preserve the deployed allowlist while admitting persisted booking, quote and appeal actions.
-- The actor API already authorizes these actions against their database records.
DO $migration$
DECLARE
  existing_expression text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO existing_expression
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND conname = 'notifications_type_check' AND contype = 'c';

  IF existing_expression IS NULL THEN
    RAISE EXCEPTION 'Expected notifications_type_check constraint is missing';
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((%s) OR type = ANY(%L::text[])) NOT VALID',
    existing_expression, '{booking_requested,booking_confirmed,booking_cancelled,booking_no_show,quote_estimated,quote_converted,appeal_decided}'
  );
END;
$migration$;

ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;
