-- Production defaults grant new functions directly to client roles, in
-- addition to PUBLIC. Trigger execution does not require client RPC grants.
REVOKE EXECUTE ON FUNCTION public.set_community_submission_key()
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
