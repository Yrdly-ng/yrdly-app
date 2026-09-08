-- Migration: Add dedicated timestamps for escrow concurrency & stale recovery, and update unique post index predicate

-- 1. Add dedicated timestamp columns to escrow_transactions
ALTER TABLE public.escrow_transactions
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creating_escrow_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.escrow_transactions.processing_started_at IS
  'Timestamp when an in-flight payment claim (status = processing) was initiated. Used for stale lock recovery.';

COMMENT ON COLUMN public.escrow_transactions.creating_escrow_started_at IS
  'Timestamp when an in-flight Payluk escrow creation claim (status = creating_escrow) was initiated.';

-- 2. Drop existing index and recreate with full active status list
DROP INDEX IF EXISTS public.idx_escrow_transactions_single_active_post;

CREATE UNIQUE INDEX idx_escrow_transactions_single_active_post
ON public.escrow_transactions (item_id)
WHERE item_type = 'post' AND status IN (
  'pending',
  'creating_escrow',
  'processing',
  'reconciling',
  'reconciliation_required',
  'paid',
  'funds_held',
  'disputed'
);
