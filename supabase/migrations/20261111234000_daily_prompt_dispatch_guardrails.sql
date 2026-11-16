-- YRD-42: durable, one-per-user-per-day editorial reminder dispatch ledger.
-- No push scheduling or mass dispatch is enabled by this migration.
CREATE TABLE IF NOT EXISTS public.daily_prompt_reminders (
  prompt_id uuid NOT NULL REFERENCES public.daily_prompts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'attempting'
    CHECK (status IN ('attempting','submitted','skipped','uncertain')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result_code text,
  PRIMARY KEY (prompt_id,user_id)
);
COMMENT ON TABLE public.daily_prompt_reminders IS 'At-most-once daily prompt campaign dispatch per user. Uncertain provider results are never automatically replayed.';
ALTER TABLE public.daily_prompt_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_prompt_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.daily_prompt_reminders TO service_role;
CREATE INDEX IF NOT EXISTS daily_prompt_reminders_status_idx
  ON public.daily_prompt_reminders(status,started_at);

-- Don't let someone reclassify or relocate an existing question response:
-- a post may still be edited for its text, but linked question context is immutable.
CREATE OR REPLACE FUNCTION public.validate_daily_prompt_post()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.daily_prompt_id IS NOT NULL THEN
    IF NEW.daily_prompt_id IS DISTINCT FROM OLD.daily_prompt_id
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.visibility IS DISTINCT FROM OLD.visibility
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.lga IS DISTINCT FROM OLD.lga THEN
       RAISE EXCEPTION 'Daily prompt response location and audience cannot be changed'
         USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.daily_prompt_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.category::text <> 'General'
     OR lower(COALESCE(NEW.visibility,'public')) <> 'public' THEN
    RAISE EXCEPTION 'Daily prompt answers must be public General posts'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_prompts p
    WHERE p.id = NEW.daily_prompt_id AND p.status='approved'
      AND p.prompt_date=(now() AT TIME ZONE 'Africa/Lagos')::date
      AND (now() AT TIME ZONE 'Africa/Lagos')::time >= time '07:00:00'
  ) THEN
    RAISE EXCEPTION 'Daily prompt is unavailable or expired' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_daily_prompt_post() FROM PUBLIC;
DROP TRIGGER IF EXISTS validate_daily_prompt_post_trigger ON public.posts;
CREATE TRIGGER validate_daily_prompt_post_trigger BEFORE INSERT
  OR UPDATE OF daily_prompt_id,category,visibility,state,lga
  ON public.posts FOR EACH ROW EXECUTE FUNCTION public.validate_daily_prompt_post();
