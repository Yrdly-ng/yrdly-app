-- Preserve submissions when their creator hides them from the visible list.
CREATE TABLE public.community_submission_dismissals (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, community_id)
);
ALTER TABLE public.community_submission_dismissals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.community_submission_dismissals TO authenticated;
CREATE POLICY "Read own submission dismissals"
  ON public.community_submission_dismissals FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Dismiss own community submissions"
  ON public.community_submission_dismissals FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_id AND c.created_by = (SELECT auth.uid())
    )
  );

-- New submissions get a stable per-creator key. Existing duplicate rows remain
-- intact; one representative owns the key so future retries cannot add another.
ALTER TABLE public.communities ADD COLUMN submission_key text;
WITH ranked AS (
  SELECT id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS name_key,
    row_number() OVER (
      PARTITION BY created_by, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
      ORDER BY created_at, id
    ) AS position
  FROM public.communities
  WHERE approval_status = 'pending' AND created_by IS NOT NULL
)
UPDATE public.communities c SET submission_key = r.name_key
FROM ranked r WHERE c.id = r.id AND r.position = 1;
CREATE UNIQUE INDEX communities_pending_submission_key
  ON public.communities (created_by, submission_key)
  WHERE approval_status = 'pending';

CREATE FUNCTION public.set_community_submission_key()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.submission_key := lower(regexp_replace(btrim(NEW.name), '\s+', ' ', 'g'));
  IF NEW.approval_status = 'pending' AND EXISTS (
    SELECT 1 FROM public.communities c
    WHERE c.created_by = NEW.created_by AND c.approval_status = 'pending'
      AND c.id <> NEW.id
      AND lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = NEW.submission_key
  ) THEN
    RAISE EXCEPTION 'This community is already awaiting approval.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_community_submission_key() FROM PUBLIC;
CREATE TRIGGER set_community_submission_key
  BEFORE INSERT OR UPDATE OF name, created_by, approval_status, submission_key
  ON public.communities FOR EACH ROW
  EXECUTE FUNCTION public.set_community_submission_key();
