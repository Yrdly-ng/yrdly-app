-- Staging-only release checks. Every fixture and preference change rolls back.
BEGIN;
CREATE TEMP TABLE prompt_release_result(result text);
CREATE TEMP TABLE prompt_post_fixture(daily_prompt_id uuid,category text,visibility text,state text,lga text);
CREATE TRIGGER prompt_fixture_guard BEFORE INSERT OR UPDATE ON prompt_post_fixture
FOR EACH ROW EXECUTE FUNCTION public.validate_daily_prompt_post();
DO $$
DECLARE prompt uuid; person uuid; chosen integer;
BEGIN
  SELECT id INTO person FROM public.users ORDER BY id LIMIT 1;
  IF person IS NULL THEN RAISE EXCEPTION 'Staging profile fixture required'; END IF;
  INSERT INTO public.daily_prompts(prompt_date,question,status)
  VALUES ((now() AT TIME ZONE 'Africa/Lagos')::date,'Temporary release test question','approved')
  ON CONFLICT(prompt_date) DO UPDATE SET status='approved'
  RETURNING id INTO prompt;
  UPDATE public.users SET notification_settings=COALESCE(notification_settings,'{}'::jsonb)||'{"dailyPrompts":true}'::jsonb WHERE id=person;
  INSERT INTO public.user_push_tokens(user_id,device_id,push_token)
  VALUES(person,'daily-prompt-release-'||txid_current(),'ExpoPushToken[temporary-test]');
  SELECT count(*) INTO chosen FROM public.daily_prompt_reminder_candidates(prompt,null,50,ARRAY[person]);
  IF chosen<>1 THEN RAISE EXCEPTION 'Opted-in eligible test profile was excluded'; END IF;
  INSERT INTO public.daily_prompt_reminders(prompt_id,user_id,status) VALUES(prompt,person,'uncertain');
  IF EXISTS(SELECT 1 FROM public.daily_prompt_reminder_candidates(prompt,null,50,ARRAY[person])) THEN
    RAISE EXCEPTION 'An uncertain reservation would be replayed';
  END IF;
  DELETE FROM public.daily_prompt_reminders WHERE prompt_id=prompt AND user_id=person;
  UPDATE public.users SET notification_settings=notification_settings||'{"dailyPrompts":false}'::jsonb WHERE id=person;
  IF EXISTS(SELECT 1 FROM public.daily_prompt_reminder_candidates(prompt,null,50,ARRAY[person])) THEN
    RAISE EXCEPTION 'Opted-out profile was selected';
  END IF;
  IF EXISTS(SELECT 1 FROM public.daily_prompt_reminder_candidates(prompt,null,50,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'An empty tester cohort selected a recipient';
  END IF;
  BEGIN
    INSERT INTO prompt_post_fixture VALUES(prompt,'General','private','Lagos','Ikeja');
    RAISE EXCEPTION 'Private prompt response was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (now() AT TIME ZONE 'Africa/Lagos')::time >= time '07:00:00' THEN
    INSERT INTO prompt_post_fixture VALUES(prompt,'General','public','Lagos','Ikeja');
    BEGIN
      UPDATE prompt_post_fixture SET lga='Lekki';
      RAISE EXCEPTION 'Prompt response neighbourhood was mutable';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END IF;
  IF has_function_privilege('anon','public.daily_prompt_reminder_candidates(uuid,uuid,integer,uuid[])','execute')
    OR has_function_privilege('authenticated','public.daily_prompt_reminder_candidates(uuid,uuid,integer,uuid[])','execute') THEN
    RAISE EXCEPTION 'Private recipient selection is exposed';
  END IF;
  INSERT INTO prompt_release_result VALUES('PASS: recipient selection, opt out, duplicate prevention, tester isolation, post constraints and RPC permissions');
END $$;
SELECT * FROM prompt_release_result;
ROLLBACK;
