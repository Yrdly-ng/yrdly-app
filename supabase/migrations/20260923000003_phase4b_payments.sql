-- Phase 4B: Payments (Payluk deposit + escrow) — parallel track, but booking staff_id from 4A is optional
-- Business chooses per service: deposit_required OR escrow_enabled (or neither)

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('unpaid','deposit_pending','deposit_paid','fully_paid','escrow_held','escrow_released','refunded','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_type_enum AS ENUM ('deposit','full','escrow');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- service_offerings payment config: per-service toggle (Both option)
ALTER TABLE public.service_offerings ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_offerings ADD COLUMN IF NOT EXISTS deposit_amount numeric;
ALTER TABLE public.service_offerings ADD COLUMN IF NOT EXISTS deposit_percent integer CHECK (deposit_percent IS NULL OR (deposit_percent >= 0 AND deposit_percent <= 100));
ALTER TABLE public.service_offerings ADD COLUMN IF NOT EXISTS requires_full_payment boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_offerings ADD COLUMN IF NOT EXISTS escrow_enabled boolean NOT NULL DEFAULT false;

-- bookings payment tracking
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_status payment_status_enum NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;

-- booking_payments: one row per Payluk intent/verify (idempotent via payluk_reference)
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  type payment_type_enum NOT NULL,
  status payment_status_enum NOT NULL DEFAULT 'deposit_pending',
  provider text NOT NULL DEFAULT 'payluk',
  payluk_reference text UNIQUE,
  payluk_checkout_url text,
  escrow_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking_id ON public.booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_payluk_reference ON public.booking_payments(payluk_reference) WHERE payluk_reference IS NOT NULL;

-- RLS
ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer read own payments" ON public.booking_payments;
CREATE POLICY "customer read own payments" ON public.booking_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_payments.booking_id AND b.customer_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.bookings b JOIN public.businesses biz ON biz.id = b.business_id WHERE b.id = booking_payments.booking_id AND biz.owner_id = auth.uid())
);
-- inserts/updates via service_role (webhook); no anon insert policy
