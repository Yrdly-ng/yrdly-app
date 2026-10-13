-- Apply only after the matching scanner code is deployed.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.scan_ticket(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.scan_ticket(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
