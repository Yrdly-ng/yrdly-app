-- Phase 4D: Admin Appeals Queue (parallel track)
-- Admin gated via auth custom claim app_metadata.role=admin OR users.is_admin (middleware checks is_admin boolean).
-- This migration does NOT create is_admin if exists (yrdly-app already has it per admin/layout.tsx).

-- ensure users.is_admin exists for admin guard (idempotent)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text;

-- strike_appeals: customer or provider disputes a late_cancelled/no_show strike on a booking
CREATE TABLE IF NOT EXISTS public.strike_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  appellant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  appellant_type text NOT NULL CHECK (appellant_type IN ('customer','provider')),
  reason text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strike_appeals_booking_id ON public.strike_appeals(booking_id);
CREATE INDEX IF NOT EXISTS idx_strike_appeals_appellant_id ON public.strike_appeals(appellant_id);
CREATE INDEX IF NOT EXISTS idx_strike_appeals_status ON public.strike_appeals(status);

ALTER TABLE public.strike_appeals ENABLE ROW LEVEL SECURITY;

-- appellant can insert own appeal, read own appeals
DROP POLICY IF EXISTS "appellant insert own appeal" ON public.strike_appeals;
CREATE POLICY "appellant insert own appeal" ON public.strike_appeals FOR INSERT WITH CHECK (appellant_id = auth.uid());
DROP POLICY IF EXISTS "appellant read own appeals" ON public.strike_appeals;
CREATE POLICY "appellant read own appeals" ON public.strike_appeals FOR SELECT USING (appellant_id = auth.uid());
-- admin read/update all (checks users.is_admin; service_role bypasses RLS anyway)
DROP POLICY IF EXISTS "admin read all appeals" ON public.strike_appeals;
CREATE POLICY "admin read all appeals" ON public.strike_appeals FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true)
);
DROP POLICY IF EXISTS "admin update appeals" ON public.strike_appeals;
CREATE POLICY "admin update appeals" ON public.strike_appeals FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true)
);

-- helper view for admin flagged entities (no hard blocks, friction model only)
-- not a materialized view to keep it simple; query users/businesses is_flagged directly
