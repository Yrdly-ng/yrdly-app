-- OTP provider challenges belong to the authenticated requester, not a caller
-- who merely knows a provider pinId. No verification codes are stored here.
CREATE TABLE public.phone_verification_challenges (
  pin_id text PRIMARY KEY CHECK (length(pin_id) BETWEEN 1 AND 200),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^234[789][0-9]{9}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  consumed_at timestamptz
);
CREATE INDEX phone_verification_challenges_user_expiry
  ON public.phone_verification_challenges (user_id, expires_at);
ALTER TABLE public.phone_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_verification_challenges TO service_role;

CREATE FUNCTION public.claim_phone_verification_attempt(p_pin_id text, p_user_id uuid)
RETURNS text LANGUAGE sql SET search_path = '' AS $$
  UPDATE public.phone_verification_challenges c
  SET attempts = c.attempts + 1
  WHERE c.pin_id = p_pin_id AND c.user_id = p_user_id
    AND c.expires_at > now() AND c.consumed_at IS NULL AND c.attempts < 3
  RETURNING c.phone;
$$;
REVOKE ALL ON FUNCTION public.claim_phone_verification_attempt(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phone_verification_attempt(text, uuid) TO service_role;

CREATE FUNCTION public.complete_phone_verification(p_pin_id text, p_user_id uuid, p_phone text)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  challenge public.phone_verification_challenges%ROWTYPE;
BEGIN
  SELECT * INTO challenge FROM public.phone_verification_challenges c
  WHERE c.pin_id = p_pin_id AND c.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR challenge.expires_at <= now() OR challenge.consumed_at IS NOT NULL
     OR challenge.attempts < 1 OR challenge.phone IS DISTINCT FROM p_phone THEN
    RETURN false;
  END IF;
  -- Serialize concurrent verification of the same phone across accounts.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('phone-verification:' || p_phone)::bigint);
  IF EXISTS (
    SELECT 1 FROM public.users u WHERE u.id <> p_user_id AND u.phone_verified
      AND pg_catalog.regexp_replace(pg_catalog.regexp_replace(u.phone, '[^0-9]', '', 'g'), '^0', '234') = p_phone
  ) THEN
    RAISE EXCEPTION 'phone_already_verified' USING ERRCODE = '23505';
  END IF;
  UPDATE public.users SET phone = p_phone, phone_verified = true WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  UPDATE public.phone_verification_challenges SET consumed_at = now() WHERE pin_id = p_pin_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_phone_verification(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_phone_verification(text, uuid, text) TO service_role;
