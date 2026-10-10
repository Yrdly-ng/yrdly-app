BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'qa_prefix' IS DISTINCT FROM 'YRDLY-QA')
    OR (SELECT count(*) FROM auth.users WHERE raw_user_meta_data->>'qa_prefix' = 'YRDLY-QA') < 3 THEN
    RAISE EXCEPTION 'This rollback regression requires the isolated QA database';
  END IF;
END $$;
DO $test$
DECLARE
  buyer uuid;
  outsider uuid;
  phone text := '2347000000099';
BEGIN
  SELECT id INTO buyer FROM auth.users WHERE email LIKE '%buyer%' LIMIT 1;
  SELECT id INTO outsider FROM auth.users WHERE id <> buyer LIMIT 1;
  IF buyer IS NULL OR outsider IS NULL THEN RAISE EXCEPTION 'QA fixtures required'; END IF;
  INSERT INTO public.phone_verification_challenges(pin_id, user_id, phone)
    VALUES ('YRDLY-QA-otp-owner', buyer, phone);
  IF public.claim_phone_verification_attempt('YRDLY-QA-otp-owner', outsider) IS NOT NULL THEN RAISE EXCEPTION 'Cross-account attempt accepted'; END IF;
  IF public.claim_phone_verification_attempt('YRDLY-QA-otp-owner', buyer) IS DISTINCT FROM phone THEN RAISE EXCEPTION 'Owner attempt failed'; END IF;
  IF public.complete_phone_verification('YRDLY-QA-otp-owner', buyer, '2347000000088') THEN RAISE EXCEPTION 'Mismatched phone accepted'; END IF;
  IF NOT public.complete_phone_verification('YRDLY-QA-otp-owner', buyer, phone) THEN RAISE EXCEPTION 'Owner completion failed'; END IF;
  IF public.complete_phone_verification('YRDLY-QA-otp-owner', buyer, phone) THEN RAISE EXCEPTION 'Completion replay accepted'; END IF;
  IF public.claim_phone_verification_attempt('YRDLY-QA-otp-owner', buyer) IS NOT NULL THEN RAISE EXCEPTION 'Consumed attempt accepted'; END IF;
  INSERT INTO public.phone_verification_challenges(pin_id, user_id, phone, expires_at)
    VALUES ('YRDLY-QA-otp-expired', buyer, phone, now() - interval '1 second');
  IF public.claim_phone_verification_attempt('YRDLY-QA-otp-expired', buyer) IS NOT NULL THEN RAISE EXCEPTION 'Expired attempt accepted'; END IF;
  INSERT INTO public.phone_verification_challenges(pin_id, user_id, phone, attempts)
    VALUES ('YRDLY-QA-otp-limit', buyer, phone, 3);
  IF public.claim_phone_verification_attempt('YRDLY-QA-otp-limit', buyer) IS NOT NULL THEN RAISE EXCEPTION 'Attempt limit exceeded'; END IF;
  INSERT INTO public.phone_verification_challenges(pin_id, user_id, phone, attempts)
    VALUES ('YRDLY-QA-otp-duplicate', outsider, phone, 1);
  BEGIN
    PERFORM public.complete_phone_verification('YRDLY-QA-otp-duplicate', outsider, phone);
    RAISE EXCEPTION 'Duplicate phone accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF has_table_privilege('authenticated', 'public.phone_verification_challenges', 'SELECT')
    OR has_table_privilege('anon', 'public.phone_verification_challenges', 'INSERT')
    OR has_function_privilege('authenticated', 'public.complete_phone_verification(text,uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.claim_phone_verification_attempt(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'OTP grants exposed';
  END IF;
END $test$;
SELECT 'PASS: 10 owner, phone binding, replay, expiry, attempt limit, uniqueness and grant assertions; rolled back' result;
ROLLBACK;
