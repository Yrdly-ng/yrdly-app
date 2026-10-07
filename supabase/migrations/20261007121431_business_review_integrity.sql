-- Enforce one review per user/business and keep business rating aggregates in sync.

CREATE UNIQUE INDEX IF NOT EXISTS business_reviews_one_per_user_per_business
  ON public.business_reviews (business_id, user_id);

DROP POLICY IF EXISTS "Users can create reviews" ON public.business_reviews;
CREATE POLICY "Users can create reviews"
  ON public.business_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = business_id
        AND b.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own reviews" ON public.business_reviews;
CREATE POLICY "Users can update their own reviews"
  ON public.business_reviews
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND created_at > now() - interval '24 hours'
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = business_id
        AND b.owner_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_business_self_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id
    INTO v_owner_id
    FROM public.businesses
    WHERE id = NEW.business_id;

  IF v_owner_id IS NOT NULL AND v_owner_id = NEW.user_id THEN
    RAISE EXCEPTION 'You cannot review your own business'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_business_self_review ON public.business_reviews;
CREATE TRIGGER prevent_business_self_review
  BEFORE INSERT OR UPDATE OF business_id, user_id
  ON public.business_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_business_self_review();

CREATE OR REPLACE FUNCTION public.refresh_business_review_rating(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_review_count integer;
  v_average_rating numeric;
BEGIN
  SELECT count(*)::integer, avg(rating)::numeric
    INTO v_review_count, v_average_rating
    FROM public.business_reviews
    WHERE business_id = p_business_id;

  UPDATE public.businesses
    SET review_count = v_review_count,
        rating = CASE
          WHEN v_review_count = 0 THEN 0
          ELSE round(v_average_rating, 2)
        END
    WHERE id = p_business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_review_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_business_review_rating(OLD.business_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id THEN
    PERFORM public.refresh_business_review_rating(OLD.business_id);
  END IF;

  PERFORM public.refresh_business_review_rating(NEW.business_id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_business_review_rating(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_business_review_rating() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_business_review_rating ON public.business_reviews;
CREATE TRIGGER sync_business_review_rating
  AFTER INSERT OR UPDATE OR DELETE
  ON public.business_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_business_review_rating();
