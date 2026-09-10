-- Migration: auto-expire stale PENDING escrow transactions via pg_cron
-- Runs every 30 minutes and cancels any PENDING transaction older than 2 hours
-- that has never been paid (no payluk_escrow_id set, or has one but status never advanced).
-- This frees the item for other buyers without requiring a new purchase attempt to trigger cleanup.

-- Enable pg_cron extension (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the cleanup job
SELECT cron.schedule(
  'expire-stale-pending-escrow',   -- job name (idempotent)
  '*/30 * * * *',                  -- every 30 minutes
  $$
    UPDATE escrow_transactions
    SET
      status     = 'cancelled',
      updated_at = NOW()
    WHERE
      status     = 'pending'
      AND created_at < NOW() - INTERVAL '2 hours';
  $$
);
