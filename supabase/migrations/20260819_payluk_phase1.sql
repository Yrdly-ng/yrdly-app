-- Phase 1 — Payluk integration schema changes
-- STATUS: DRAFT — do not apply directly.
--         Review and apply via `supabase db push` or the Supabase dashboard.
-- Created: 2026-08-19

-- ── 1. Add payluk_customer_id to users ────────────────────────────────────
-- Stores the Payluk customerId returned by POST /v1/customer/create.
-- Nullable because existing users have not been onboarded into Payluk yet.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payluk_customer_id text;

COMMENT ON COLUMN public.users.payluk_customer_id IS
  'Payluk merchant customer ID (returned by POST /v1/customer/create). '
  'Null until the user has been onboarded into Payluk.';

-- ── 2. Add payluk_tx_ref to escrow_transactions ────────────────────────────
-- Stores the Payluk payment reference / paymentToken for the transaction.
-- Nullable; only populated when payment_provider = 'payluk'.

ALTER TABLE public.escrow_transactions
  ADD COLUMN IF NOT EXISTS payluk_tx_ref text;

COMMENT ON COLUMN public.escrow_transactions.payluk_tx_ref IS
  'Payluk paymentToken (e.g. PY_8AB12C9D3045) returned by POST /v1/payment/escrow. '
  'Null when payment_provider is not payluk.';

-- ── 3. Add 'wallet' to the payment_method enum ────────────────────────────
-- The existing enum values are: card, bank_transfer, mobile_money.
-- Payluk's wallet gateway requires a 'wallet' option.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'wallet';

-- ── 4. Update payment_provider default ────────────────────────────────────
-- The column currently defaults to 'flutterwave' (legacy).
-- New escrow transactions will use Payluk going forward.

ALTER TABLE public.escrow_transactions
  ALTER COLUMN payment_provider SET DEFAULT 'payluk';

-- NOTE: Existing rows keep their current payment_provider value.
--       No backfill is applied here — update existing rows separately
--       if required, with explicit WHERE payment_provider = 'flutterwave'.
