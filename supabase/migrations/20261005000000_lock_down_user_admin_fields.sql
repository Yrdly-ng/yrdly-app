-- Prevent authenticated users from granting themselves administrator access.
-- The existing broad policy bypasses the table's owner-only profile policies.
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.users;

CREATE OR REPLACE FUNCTION public.prevent_client_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_admin IS TRUE OR NEW.role = 'admin' THEN
      RAISE EXCEPTION 'Only the service role can grant administrator access';
    END IF;
  ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only the service role can change administrator access';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_admin_escalation ON public.users;
CREATE TRIGGER trg_prevent_client_admin_escalation
BEFORE INSERT OR UPDATE OF is_admin, role ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_admin_escalation();

REVOKE ALL ON FUNCTION public.prevent_client_admin_escalation() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
