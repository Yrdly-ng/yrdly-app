CREATE OR REPLACE FUNCTION public.enforce_catalog_business_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_business_type public.business_mode;
BEGIN
  SELECT mode
  INTO selected_business_type
  FROM public.businesses
  WHERE id = NEW.business_id
  FOR SHARE;

  IF selected_business_type = 'service'::public.business_mode THEN
    RAISE EXCEPTION 'Service-only businesses cannot have product catalog items.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_catalog_business_type
BEFORE INSERT OR UPDATE OF business_id ON public.catalog_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_catalog_business_type();

CREATE OR REPLACE FUNCTION public.prevent_service_type_with_catalog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.mode = 'service'::public.business_mode
     AND OLD.mode IS DISTINCT FROM NEW.mode
     AND EXISTS (
       SELECT 1
       FROM public.catalog_items
       WHERE business_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'A business with product catalog items cannot be changed to service-only.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_service_type_with_catalog
BEFORE UPDATE OF mode ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.prevent_service_type_with_catalog();
