-- Preserve the deployed notification allowlist while admitting event-team invites.
-- The invite and notification share a transaction; rejecting this type rolled both back.
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
    existing_expression, 'event_team_invite'
  );
END;
$migration$;

ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;
