-- Apply only AFTER matching web code and shared clients resolve private media.
-- Requires launch_lockdown_a; never apply by generic timestamp-order db push.
-- Supabase CLI draft creation was unavailable because its telemetry write was
-- denied by the local filesystem sandbox. This draft was created manually.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.users'::regclass
    AND tgname = 'audit_guard_user_trust' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Apply launch_lockdown_a after matching code deployment first';
  END IF;
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('chat-images','chat-videos','reports')) <> 3 THEN
    RAISE EXCEPTION 'Expected private media buckets are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id IN ('chat-images','chat-videos')
    AND NOT EXISTS (SELECT 1 FROM public.conversations c
      WHERE c.id::text = CASE WHEN (storage.foldername(o.name))[1] = 'chat'
      THEN (storage.foldername(o.name))[2] ELSE (storage.foldername(o.name))[1] END)
  ) THEN
    RAISE EXCEPTION 'Unmapped historical chat media requires ownership review';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'reports'
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id::text = (storage.foldername(o.name))[1])) THEN
    RAISE EXCEPTION 'Unmapped historical report media requires ownership review';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Allow authenticated users to upload chat images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own chat images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users upload chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Public read report images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload report images to their folder" ON storage.objects;
DROP POLICY audit_chat_media_read ON storage.objects;
DROP POLICY audit_owned_media_update ON storage.objects;
DROP POLICY audit_owned_media_delete ON storage.objects;

-- Public post media keeps owner-only modification from lockdown A.
CREATE POLICY audit_owned_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'post-images' AND owner_id = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'post-images' AND owner_id = (SELECT auth.uid())::text);
CREATE POLICY audit_owned_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'post-images' AND owner_id = (SELECT auth.uid())::text);

CREATE POLICY audit_chat_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('chat-images','chat-videos') AND EXISTS (
  SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
  AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
  THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END
));
CREATE POLICY audit_chat_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('chat-images','chat-videos') AND owner_id = (SELECT auth.uid())::text
AND EXISTS (SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
  AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
  THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END
));
CREATE POLICY audit_chat_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('chat-images','chat-videos') AND owner_id = (SELECT auth.uid())::text
AND EXISTS (SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
  AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
  THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END
))
WITH CHECK (bucket_id IN ('chat-images','chat-videos') AND owner_id = (SELECT auth.uid())::text
AND EXISTS (SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
  AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
  THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END
));
CREATE POLICY audit_chat_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('chat-images','chat-videos') AND owner_id = (SELECT auth.uid())::text
AND EXISTS (SELECT 1 FROM public.conversations c WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
  AND c.id::text = CASE WHEN (storage.foldername(name))[1] = 'chat'
  THEN (storage.foldername(name))[2] ELSE (storage.foldername(name))[1] END
));

CREATE POLICY audit_report_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'reports' AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
  OR (SELECT public.audit_is_admin())));
CREATE POLICY audit_report_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reports' AND owner_id = (SELECT auth.uid())::text
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY audit_report_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'reports' AND owner_id = (SELECT auth.uid())::text
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'reports' AND owner_id = (SELECT auth.uid())::text
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY audit_report_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'reports' AND owner_id = (SELECT auth.uid())::text
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

UPDATE storage.buckets SET public = false WHERE id IN ('chat-images','chat-videos','reports');
COMMIT;
NOTIFY pgrst, 'reload schema';
