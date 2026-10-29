-- Preserve every deployed notification type while admitting ticket-sale notices.
-- Paystack issuance and its organiser notification are atomic; rejecting the
-- notification type otherwise rolls back both the tickets and earnings.
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
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((%s) OR type = %L) NOT VALID',
    existing_expression, 'ticket_purchase'
  );
END;
$migration$;

ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;
