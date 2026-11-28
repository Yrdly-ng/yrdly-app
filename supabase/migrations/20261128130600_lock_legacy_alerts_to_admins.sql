-- Restrict legacy public.alerts to active admin accounts.
-- The public user-facing alert feed is public.safety_alerts; legacy alerts contain
-- personal missing-person/contact/location data and are only used by admin tools.
-- No data is deleted or altered by this migration.

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read alerts" ON public.alerts;
DROP POLICY IF EXISTS "active_account_session" ON public.alerts;
DROP POLICY IF EXISTS "Admins can delete alerts" ON public.alerts;
DROP POLICY IF EXISTS "Admins can insert alerts" ON public.alerts;
DROP POLICY IF EXISTS "Admins can update alerts" ON public.alerts;

REVOKE ALL PRIVILEGES ON TABLE public.alerts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.alerts TO authenticated;

CREATE POLICY "legacy alerts admin select"
  ON public.alerts FOR SELECT TO authenticated
  USING (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.is_admin = true
    )
  );

CREATE POLICY "legacy alerts admin insert"
  ON public.alerts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.is_admin = true
    )
  );

CREATE POLICY "legacy alerts admin update"
  ON public.alerts FOR UPDATE TO authenticated
  USING (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.is_admin = true
    )
  )
  WITH CHECK (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.is_admin = true
    )
  );

CREATE POLICY "legacy alerts admin delete"
  ON public.alerts FOR DELETE TO authenticated
  USING (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.is_admin = true
    )
  );
