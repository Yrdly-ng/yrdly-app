-- Migration: Add Row Level Security policies for public.alerts

-- 1. Ensure RLS is enabled
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- 2. SELECT Policy: Authenticated users can read active/unresolved alerts
CREATE POLICY "Authenticated users can read alerts"
  ON public.alerts
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. INSERT Policy: Admin users only
CREATE POLICY "Admins can insert alerts"
  ON public.alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- 4. UPDATE Policy: Admin users only
CREATE POLICY "Admins can update alerts"
  ON public.alerts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- 5. DELETE Policy: Admin users only
CREATE POLICY "Admins can delete alerts"
  ON public.alerts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );
