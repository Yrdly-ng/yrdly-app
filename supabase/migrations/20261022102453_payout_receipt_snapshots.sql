-- Historical destinations cannot be reconstructed from mutable seller accounts.
-- Capture masked destination and quoted amounts for new execution attempts only.
ALTER TABLE public.payout_requests ADD COLUMN IF NOT EXISTS receipt_snapshot jsonb;
COMMENT ON COLUMN public.payout_requests.receipt_snapshot IS
  'Masked destination and provider fee/net amount captured for this payout attempt; null for legacy receipts.';
