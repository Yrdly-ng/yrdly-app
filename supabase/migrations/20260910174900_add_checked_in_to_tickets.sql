-- Migration: add checked_in columns to tickets
-- The mobile scanner (scan.tsx) writes checked_in, checked_in_at, and is_used.
-- The backend checkin route uses status='USED' + scanned_at + scanned_by.
-- Adding these columns satisfies the mobile client without breaking the backend.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS is_used       BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checked_in    BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- Keep is_used and checked_in in sync with status via a trigger so both
-- conventions stay consistent regardless of which path performs the update.
CREATE OR REPLACE FUNCTION sync_ticket_checked_in()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'USED' AND (OLD.status IS DISTINCT FROM 'USED') THEN
    NEW.is_used    := TRUE;
    NEW.checked_in := TRUE;
    IF NEW.checked_in_at IS NULL THEN
      NEW.checked_in_at := COALESCE(NEW.scanned_at, NOW());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ticket_checked_in ON tickets;
CREATE TRIGGER trg_sync_ticket_checked_in
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION sync_ticket_checked_in();
