-- Keep a seller from deleting a marketplace post after payment has cleared.
-- This check runs in the database so every client and API path observes it.
CREATE OR REPLACE FUNCTION public.prevent_paid_marketplace_listing_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.escrow_transactions tx
    WHERE tx.item_id = OLD.id
      AND tx.item_type = 'post'
      AND (
        tx.paid_at IS NOT NULL
        OR tx.status IN ('paid', 'funds_held', 'disputed', 'shipped', 'delivered', 'completed', 'refunded')
      )
  ) THEN
    RAISE EXCEPTION 'This listing cannot be deleted because it has already been paid for.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_paid_marketplace_listing_delete ON public.posts;
CREATE TRIGGER prevent_paid_marketplace_listing_delete
BEFORE DELETE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_paid_marketplace_listing_delete();
