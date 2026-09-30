-- Phase 4A: Multi-Staff / Multi-Calendar (parallel track)
-- Supabase Project: yoiyqxtpmxnrrbqqidcs
-- Depends on Phase 1-3 bookings schema (service_offerings, provider_availability, availability_exceptions, bookings)

-- 1. business_staff
CREATE TABLE IF NOT EXISTS public.business_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  role text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_staff_business_id ON public.business_staff(business_id);
CREATE INDEX IF NOT EXISTS idx_business_staff_user_id ON public.business_staff(user_id) WHERE user_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_business_staff_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_business_staff_updated_at ON public.business_staff;
CREATE TRIGGER trg_business_staff_updated_at BEFORE UPDATE ON public.business_staff FOR EACH ROW EXECUTE FUNCTION public.update_business_staff_updated_at();

-- 2. service -> staff assignments (many-to-many)
CREATE TABLE IF NOT EXISTS public.service_staff_assignments (
  service_id uuid NOT NULL REFERENCES public.service_offerings(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.business_staff(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_service_staff_assignments_staff_id ON public.service_staff_assignments(staff_id);

-- 3. provider_availability: add staff_id (null = legacy single-calendar)
ALTER TABLE public.provider_availability ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.business_staff(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_provider_availability_staff_id ON public.provider_availability(staff_id) WHERE staff_id IS NOT NULL;
-- partial unique per staff+day, legacy rows (staff_id null) keep existing business_id+day unique via partial index
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_availability_business_staff_day ON public.provider_availability(business_id, staff_id, day_of_week) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_availability_business_day_legacy ON public.provider_availability(business_id, day_of_week) WHERE staff_id IS NULL;

-- 4. availability_exceptions: add staff_id
ALTER TABLE public.availability_exceptions ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.business_staff(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_availability_exceptions_staff_id ON public.availability_exceptions(staff_id) WHERE staff_id IS NOT NULL;

-- 5. bookings: add staff_id
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.business_staff(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_staff_id ON public.bookings(staff_id) WHERE staff_id IS NOT NULL;

-- 6. RLS
ALTER TABLE public.business_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_staff_assignments ENABLE ROW LEVEL SECURITY;

-- business_staff: public read active, owner write (owner_id from businesses)
DROP POLICY IF EXISTS "public read active staff" ON public.business_staff;
CREATE POLICY "public read active staff" ON public.business_staff FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "owner manage staff" ON public.business_staff;
CREATE POLICY "owner manage staff" ON public.business_staff FOR ALL USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_staff.business_id AND b.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_staff.business_id AND b.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "public read assignments" ON public.service_staff_assignments;
CREATE POLICY "public read assignments" ON public.service_staff_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "owner manage assignments" ON public.service_staff_assignments;
CREATE POLICY "owner manage assignments" ON public.service_staff_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.service_offerings so JOIN public.businesses b ON b.id = so.business_id WHERE so.id = service_staff_assignments.service_id AND b.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.service_offerings so JOIN public.businesses b ON b.id = so.business_id WHERE so.id = service_staff_assignments.service_id AND b.owner_id = auth.uid())
);
