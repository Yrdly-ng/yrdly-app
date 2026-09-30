-- Phase 4C: Quotes-for-Trades (parallel track)
-- Fixed pricing/duration doesn't fit trades -> custom quote -> optional conversion to booking

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('pending','estimated','accepted','rejected','expired','converted','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.business_staff(id) ON DELETE SET NULL,
  category text NOT NULL, -- plumbing | electrical | mechanic | custom
  title text NOT NULL,
  description text NOT NULL,
  images text[] NOT NULL DEFAULT '{}',
  location_text text,
  urgency text,
  status quote_status NOT NULL DEFAULT 'pending',
  estimated_price numeric,
  estimated_duration_minutes integer,
  estimate_notes text,
  expires_at timestamptz,
  converted_booking_id uuid UNIQUE REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_customer_id ON public.quote_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_business_id ON public.quote_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON public.quote_requests(status);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quote_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_quote_id ON public.bookings(quote_id) WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.quote_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_messages_quote_id ON public.quote_messages(quote_id);

-- updated_at
CREATE OR REPLACE FUNCTION public.update_quote_requests_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_quote_requests_updated_at ON public.quote_requests;
CREATE TRIGGER trg_quote_requests_updated_at BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION public.update_quote_requests_updated_at();

-- RLS
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer crud own quotes" ON public.quote_requests;
CREATE POLICY "customer crud own quotes" ON public.quote_requests FOR ALL USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
DROP POLICY IF EXISTS "business read own quotes" ON public.quote_requests;
CREATE POLICY "business read own quotes" ON public.quote_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = quote_requests.business_id AND b.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "business update own quotes" ON public.quote_requests;
CREATE POLICY "business update own quotes" ON public.quote_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = quote_requests.business_id AND b.owner_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = quote_requests.business_id AND b.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "participants read messages" ON public.quote_messages;
CREATE POLICY "participants read messages" ON public.quote_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.quote_requests qr WHERE qr.id = quote_messages.quote_id AND (qr.customer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = qr.business_id AND b.owner_id = auth.uid())))
);
DROP POLICY IF EXISTS "participants insert messages" ON public.quote_messages;
CREATE POLICY "participants insert messages" ON public.quote_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.quote_requests qr WHERE qr.id = quote_messages.quote_id AND (qr.customer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = qr.business_id AND b.owner_id = auth.uid())))
);
