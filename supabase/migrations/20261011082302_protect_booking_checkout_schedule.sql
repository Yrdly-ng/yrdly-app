CREATE OR REPLACE FUNCTION public.guard_booking_pending_checkout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.status IN ('cancelled','late_cancelled') AND NEW.status IS DISTINCT FROM OLD.status
      OR NEW.appointment_time IS DISTINCT FROM OLD.appointment_time
      OR NEW.end_time IS DISTINCT FROM OLD.end_time)
    AND EXISTS (SELECT 1 FROM public.booking_payments p JOIN public.escrow_transactions x ON x.id = p.escrow_transaction_id
      WHERE p.booking_id = OLD.id AND x.status IN ('pending','creating_escrow','reconciling','paid','shipped','delivered','disputed')) THEN
    RAISE EXCEPTION 'Cancel the unpaid checkout or arrange an assisted refund before cancelling or rescheduling this booking';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_booking_pending_checkout() FROM PUBLIC,anon,authenticated;
