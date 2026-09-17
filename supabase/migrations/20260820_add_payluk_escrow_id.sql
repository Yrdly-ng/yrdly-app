-- Add payluk_escrow_id column to store the Payluk escrow data.id
-- (distinct from payluk_tx_ref which stores the paymentToken PY_...)
-- This is needed by confirm-delivery which requires the raw escrow ID, not the payment token.
ALTER TABLE escrow_transactions
  ADD COLUMN IF NOT EXISTS payluk_escrow_id TEXT;
