-- YRD-38: editorially approved daily neighbourhood questions.
-- Intentionally does not publish any question or enable push reminders.
CREATE TABLE IF NOT EXISTS public.daily_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_date date NOT NULL UNIQUE,
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 12 AND 300),
  category text NOT NULL DEFAULT 'neighbourhood'
    CHECK (category IN ('neighbourhood','businesses','food','services','events','community')),
  push_title text CHECK (push_title IS NULL OR char_length(push_title) BETWEEN 3 AND 90),
  push_body text CHECK (push_body IS NULL OR char_length(push_body) BETWEEN 3 AND 220),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','paused','retired')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.daily_prompts IS 'Approved daily YRDLY questions, date interpreted in Africa/Lagos. The feature is disabled unless DAILY_PROMPTS_ENABLED=true.';
CREATE INDEX IF NOT EXISTS daily_prompts_status_date_idx ON public.daily_prompts (status, prompt_date);

ALTER TABLE public.daily_prompts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_prompts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.daily_prompts TO anon, authenticated;
GRANT ALL ON TABLE public.daily_prompts TO service_role;
DROP POLICY IF EXISTS daily_prompts_public_read ON public.daily_prompts;
CREATE POLICY daily_prompts_public_read ON public.daily_prompts FOR SELECT TO anon, authenticated
USING (
  status = 'approved'
  AND (
    prompt_date < ((now() AT TIME ZONE 'Africa/Lagos')::date)
    OR (
      prompt_date = ((now() AT TIME ZONE 'Africa/Lagos')::date)
      AND ((now() AT TIME ZONE 'Africa/Lagos')::time >= time '07:00:00')
    )
  )
);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS daily_prompt_id uuid REFERENCES public.daily_prompts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_daily_prompt_recent_idx
  ON public.posts (daily_prompt_id, created_at DESC) WHERE daily_prompt_id IS NOT NULL;
COMMENT ON COLUMN public.posts.daily_prompt_id IS 'If set, the General post is a user-authored answer to a published daily prompt.';

-- Direct PostgREST writes use the existing posts RLS; the trigger prevents
-- inventing, backdating, or forging answers via direct client table writes.
CREATE OR REPLACE FUNCTION public.validate_daily_prompt_post()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.daily_prompt_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.daily_prompt_id IS NOT DISTINCT FROM OLD.daily_prompt_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category::text <> 'General'
     OR lower(COALESCE(NEW.visibility,'public')) <> 'public' THEN
    RAISE EXCEPTION 'Daily prompt answers must be public General posts' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_prompts p
    WHERE p.id = NEW.daily_prompt_id AND p.status = 'approved'
      AND p.prompt_date = (now() AT TIME ZONE 'Africa/Lagos')::date
      AND (now() AT TIME ZONE 'Africa/Lagos')::time >= time '07:00:00'
  ) THEN
    RAISE EXCEPTION 'Daily prompt is unavailable or expired' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_daily_prompt_post() FROM PUBLIC;
DROP TRIGGER IF EXISTS validate_daily_prompt_post_trigger ON public.posts;
CREATE TRIGGER validate_daily_prompt_post_trigger BEFORE INSERT OR UPDATE OF daily_prompt_id
  ON public.posts FOR EACH ROW EXECUTE FUNCTION public.validate_daily_prompt_post();
