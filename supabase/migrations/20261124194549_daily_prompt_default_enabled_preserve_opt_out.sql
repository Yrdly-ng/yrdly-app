-- Default daily prompts on, preserving explicit user choices.
ALTER TABLE public.users ALTER COLUMN notification_settings SET DEFAULT '{"comments":true,"messages":true,"postLikes":true,"postUpdates":true,"eventInvites":true,"friendRequests":true,"dailyPrompts":true}'::jsonb;

CREATE OR REPLACE FUNCTION private.ensure_daily_prompt_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.notification_settings IS NULL THEN
    NEW.notification_settings := '{}'::jsonb;
  END IF;
  IF jsonb_typeof(NEW.notification_settings) = 'object'
     AND NOT (NEW.notification_settings ? 'dailyPrompts') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.notification_settings := jsonb_set(NEW.notification_settings, '{dailyPrompts}',
        COALESCE(OLD.notification_settings->'dailyPrompts', 'true'::jsonb), true);
    ELSE
      NEW.notification_settings := jsonb_set(NEW.notification_settings, '{dailyPrompts}', 'true'::jsonb, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.ensure_daily_prompt_preference() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ensure_daily_prompt_preference ON public.users;
CREATE TRIGGER ensure_daily_prompt_preference BEFORE INSERT OR UPDATE OF notification_settings ON public.users
FOR EACH ROW EXECUTE FUNCTION private.ensure_daily_prompt_preference();

UPDATE public.users
SET notification_settings = jsonb_set(COALESCE(notification_settings,'{}'::jsonb),'{dailyPrompts}','true'::jsonb,true)
WHERE notification_settings IS NULL OR (jsonb_typeof(notification_settings)='object' AND NOT (notification_settings ? 'dailyPrompts'));
