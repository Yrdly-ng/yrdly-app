BEGIN;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_by text[] NOT NULL DEFAULT '{}';
-- Receipts are recipient acknowledgements, never implied by an INSERT.
CREATE FUNCTION public.acknowledge_messages(p_message_ids uuid[],p_read boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.is_current_session_active() THEN
   RAISE EXCEPTION 'Active session required' USING ERRCODE='28000';
 END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>50 THEN
   RAISE EXCEPTION 'Invalid receipt batch' USING ERRCODE='22023';
 END IF;
 UPDATE public.messages m SET
   delivered_by = CASE WHEN actor::text=ANY(m.delivered_by) THEN m.delivered_by ELSE array_append(m.delivered_by,actor::text) END,
   read_by = CASE WHEN NOT p_read OR actor::text=ANY(coalesce(m.read_by,'{}'::text[])) THEN m.read_by ELSE array_append(coalesce(m.read_by,'{}'::text[]),actor::text) END,
   is_read = CASE WHEN p_read THEN true ELSE m.is_read END
 FROM public.conversations c
 WHERE m.id=ANY(p_message_ids) AND m.conversation_id=c.id
   AND actor=ANY(c.participant_ids) AND actor<>m.sender_id AND c.type IS DISTINCT FROM 'group'
   AND (NOT actor::text=ANY(m.delivered_by) OR (p_read AND NOT actor::text=ANY(coalesce(m.read_by,'{}'::text[]))));
END; $$;
REVOKE ALL ON FUNCTION public.acknowledge_messages(uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_messages(uuid[],boolean) TO authenticated;
-- Additive guard: clients cannot set the new server-owned receipt column or
-- mark their own outgoing message read. Existing recipient read markers remain compatible.
CREATE FUNCTION private.guard_message_receipts() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin') OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
   NEW.delivered_by:='{}'::text[];
   NEW.read_by:='{}'::text[];
   NEW.is_read:=false;
 ELSE
   IF NEW.delivered_by IS DISTINCT FROM OLD.delivered_by THEN
     RAISE EXCEPTION 'Delivery receipts require recipient acknowledgement' USING ERRCODE='42501';
   END IF;
   IF NEW.is_read IS DISTINCT FROM OLD.is_read AND auth.uid()=OLD.sender_id THEN
     RAISE EXCEPTION 'Senders cannot acknowledge their own messages' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.guard_message_receipts() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_message_receipts BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.guard_message_receipts();
COMMIT;
NOTIFY pgrst,'reload schema';
