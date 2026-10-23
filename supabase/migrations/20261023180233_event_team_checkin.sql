-- Account-bound invitations and operational check-in access. No financial permissions.
CREATE TABLE public.event_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('manager','checkin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
  invited_by uuid NOT NULL REFERENCES public.users(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,user_id)
);
CREATE INDEX event_team_user_status_idx ON public.event_team_members(user_id,status,event_id);
ALTER TABLE public.event_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_team_members FROM anon,authenticated;
GRANT SELECT ON public.event_team_members TO authenticated;
CREATE POLICY event_team_read_self_or_owner ON public.event_team_members FOR SELECT TO authenticated
USING (public.is_current_session_active() AND (user_id = (SELECT auth.uid()) OR EXISTS (
 SELECT 1 FROM public.events e WHERE e.id = event_id AND e.organizer_id = (SELECT auth.uid())
)));

CREATE TABLE public.event_checkin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE UNIQUE,
  scanned_by uuid NOT NULL REFERENCES public.users(id),
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_checkin_log_event_time_idx ON public.event_checkin_log(event_id,scanned_at DESC);
-- Preserve attributable admissions that happened before team delegation existed.
INSERT INTO public.event_checkin_log(event_id,ticket_id,scanned_by,scanned_at)
SELECT t.event_id,t.id,t.scanned_by,t.scanned_at
FROM public.tickets t JOIN public.users u ON u.id=t.scanned_by
WHERE t.status='USED' AND t.scanned_at IS NOT NULL
ON CONFLICT(ticket_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS event_team_tickets_event_status_idx ON public.tickets(event_id,status);
ALTER TABLE public.event_checkin_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_checkin_log FROM anon,authenticated;
-- Read through the role-filtered RPC only; writes are inseparable from ticket use.

-- Also audit compatible older admissions and any permitted direct ticket update.
-- The audit and admission succeed or roll back together in one transaction.
CREATE FUNCTION public.record_event_ticket_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF OLD.status='PAID' AND NEW.status='USED' AND NEW.scanned_by IS NOT NULL AND NEW.scanned_at IS NOT NULL THEN
   INSERT INTO public.event_checkin_log(event_id,ticket_id,scanned_by,scanned_at)
   VALUES(NEW.event_id,NEW.id,NEW.scanned_by,NEW.scanned_at)
   ON CONFLICT(ticket_id) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.record_event_ticket_admission() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER event_ticket_admission_audit AFTER UPDATE OF status ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.record_event_ticket_admission();

CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.require_event_team_account() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.is_current_session_active() THEN
   RAISE EXCEPTION 'Invalid session' USING ERRCODE = '28000';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor
   AND NOT coalesce(u.is_suspended,false) AND NOT coalesce(u.is_banned,false)
   AND coalesce(u.status::text,'') NOT IN ('suspended','banned')) THEN
   RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501';
 END IF;
 RETURN actor;
END; $$;
REVOKE ALL ON FUNCTION private.require_event_team_account() FROM PUBLIC,anon,authenticated;

-- The pre-existing ticket trigger also runs inside SECURITY DEFINER RPCs because
-- auth.uid() retains the caller. Keep its financial/archive guards and extend
-- only the paid-to-used transition to the accepted door team.
CREATE OR REPLACE FUNCTION public.guard_ticket_client_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); ev public.events%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RETURN NEW; END IF;
 PERFORM private.require_event_team_account();
 IF NEW.refund_status IS DISTINCT FROM OLD.refund_status OR
   (to_jsonb(NEW)-ARRAY['status','scanned_at','scanned_by','checked_in','checked_in_at','is_used','is_archived','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','scanned_at','scanned_by','checked_in','checked_in_at','is_used','is_archived','updated_at']) THEN
   RAISE EXCEPTION 'Ticket payment and identity fields cannot be changed by a user' USING ERRCODE='42501';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
   SELECT * INTO ev FROM public.events WHERE id=OLD.event_id FOR SHARE;
   IF ev.organizer_id IS DISTINCT FROM actor AND NOT EXISTS (
     SELECT 1 FROM public.event_team_members WHERE event_id=OLD.event_id AND user_id=actor AND status='accepted'
   ) THEN RAISE EXCEPTION 'Only the event team may check in an active ticket' USING ERRCODE='42501'; END IF;
   IF ev.status::text IS DISTINCT FROM 'PUBLISHED' OR OLD.status<>'PAID' OR NEW.status<>'USED'
     OR OLD.refund_status IS NOT NULL OR (OLD.expires_at IS NOT NULL AND OLD.expires_at<=now())
     OR NEW.scanned_by IS DISTINCT FROM actor OR NEW.scanned_at IS NULL THEN
     RAISE EXCEPTION 'Only an active ticket can be checked in' USING ERRCODE='42501';
   END IF;
 ELSIF actor IS DISTINCT FROM OLD.buyer_id OR
   (to_jsonb(NEW)-ARRAY['is_archived','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_archived','updated_at']) THEN
   RAISE EXCEPTION 'Only the ticket holder may archive this ticket' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_ticket_client_update() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.event_team_assignments() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_event_team_account(); result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',m.id,'event_id',m.event_id,'role',m.role,
   'status',CASE WHEN m.status='pending' AND m.expires_at <= now() THEN 'expired' WHEN m.status='accepted' THEN 'active' ELSE m.status END,
   'expires_at',m.expires_at,'event',jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time,'status',e.status)
 ) ORDER BY e.start_time DESC),'[]'::jsonb) INTO result
 FROM public.event_team_members m JOIN public.events e ON e.id=m.event_id
 WHERE m.user_id=actor AND m.status IN ('pending','accepted');
 RETURN jsonb_build_object('assignments',result);
END; $$;

CREATE FUNCTION public.event_team_snapshot(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_event_team_account(); ev public.events%ROWTYPE;
 actor_role text; members jsonb; history jsonb; guests jsonb; summary jsonb;
BEGIN
 -- Shared with scans; team changes take an exclusive row lock before authorization.
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE='P0002'; END IF;
 IF ev.organizer_id=actor THEN actor_role:='organizer';
 ELSE SELECT role INTO actor_role FROM public.event_team_members
   WHERE event_id=p_event_id AND user_id=actor AND status='accepted'; END IF;
 IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,
   'status',CASE WHEN m.status='pending' AND m.expires_at<=now() THEN 'expired' WHEN m.status='accepted' THEN 'active' ELSE m.status END,
   'expires_at',m.expires_at,'name',coalesce(u.name,u.username,'Team member'),'user',jsonb_build_object('name',coalesce(u.name,u.username,'Team member'))) ORDER BY m.created_at),'[]'::jsonb)
 INTO members FROM public.event_team_members m JOIN public.users u ON u.id=m.user_id
 WHERE m.event_id=p_event_id AND (actor_role IN ('organizer','manager') OR m.user_id=actor);

 SELECT jsonb_build_object('total',count(*) FILTER (WHERE status='USED' OR (status='PAID' AND refund_status IS NULL AND (expires_at IS NULL OR expires_at>now()))),
   'checked_in',count(*) FILTER (WHERE status='USED'),
   'remaining',count(*) FILTER (WHERE status='PAID' AND refund_status IS NULL AND (expires_at IS NULL OR expires_at>now())))
 INTO summary FROM public.tickets WHERE event_id=p_event_id;

 SELECT coalesce(jsonb_agg(x.record ORDER BY x.scanned_at DESC),'[]'::jsonb) INTO history FROM (
   SELECT l.scanned_at,jsonb_build_object('id',l.id,'ticket_id',l.ticket_id,'scanned_at',l.scanned_at,
     'scanned_by',l.scanned_by,'scanner_name',coalesce(u.name,u.username,'Team member')) ||
     CASE WHEN actor_role IN ('organizer','manager') THEN jsonb_build_object('attendee_name',t.attendee_name) ELSE '{}'::jsonb END AS record
   FROM public.event_checkin_log l JOIN public.tickets t ON t.id=l.ticket_id LEFT JOIN public.users u ON u.id=l.scanned_by
   WHERE l.event_id=p_event_id AND (actor_role IN ('organizer','manager') OR l.scanned_by=actor)
   ORDER BY l.scanned_at DESC LIMIT 100
 ) x;
 guests:='[]'::jsonb;
 IF actor_role IN ('organizer','manager') THEN
   SELECT coalesce(jsonb_agg(x.record ORDER BY x.attendee_name),'[]'::jsonb) INTO guests FROM (
     SELECT t.attendee_name,jsonb_build_object('id',t.id,'attendee_name',t.attendee_name,'status',t.status,
       'tier_name',tt.name,'scanned_at',t.scanned_at) AS record
     FROM public.tickets t LEFT JOIN public.ticket_tiers tt ON tt.id=t.tier_id
     WHERE t.event_id=p_event_id AND t.status IN ('PAID','USED') ORDER BY t.attendee_name,t.id LIMIT 200
   ) x;
 END IF;
 RETURN jsonb_build_object('event',jsonb_build_object('id',ev.id,'title',ev.title,'start_time',ev.start_time,'status',ev.status),
   'role',actor_role,'members',members,'summary',summary,'history',history,'guests',guests,'history_limit',100,'guests_limit',200);
END; $$;

CREATE FUNCTION public.event_team_mutate(p_event_id uuid,p_action text,p_email text DEFAULT NULL,
 p_user_id uuid DEFAULT NULL,p_role text DEFAULT NULL,p_member_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_event_team_account(); ev public.events%ROWTYPE;
 actor_role text; target uuid; member public.event_team_members%ROWTYPE; notify boolean:=false;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE='P0002'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('invite','accept','decline','revoke','update_role') THEN
   RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF ev.organizer_id=actor THEN actor_role:='organizer';
 ELSE SELECT role INTO actor_role FROM public.event_team_members
   WHERE event_id=p_event_id AND user_id=actor AND status='accepted'; END IF;

 IF p_action IN ('accept','decline') THEN
   SELECT * INTO member FROM public.event_team_members WHERE id=p_member_id AND event_id=p_event_id AND user_id=actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found' USING ERRCODE='P0002'; END IF;
   IF (p_action='accept' AND member.status='accepted') OR (p_action='decline' AND member.status='declined') THEN
     RETURN jsonb_build_object('success',true,'member_id',member.id,'status',CASE WHEN member.status='accepted' THEN 'active' ELSE member.status END);
   END IF;
   IF member.status<>'pending' OR member.expires_at<=now() THEN RAISE EXCEPTION 'Invitation is no longer available' USING ERRCODE='22023'; END IF;
   IF p_action='accept' AND ev.status::text='CANCELLED' THEN RAISE EXCEPTION 'Event is cancelled' USING ERRCODE='22023'; END IF;
   UPDATE public.event_team_members SET status=CASE WHEN p_action='accept' THEN 'accepted' ELSE 'declined' END,
     accepted_at=CASE WHEN p_action='accept' THEN now() ELSE NULL END,updated_at=now() WHERE id=member.id RETURNING * INTO member;
 ELSE
   IF actor_role IS NULL OR actor_role NOT IN ('organizer','manager') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
   IF p_action IN ('invite','update_role') AND (p_role IS NULL OR p_role NOT IN ('manager','checkin')) THEN
     RAISE EXCEPTION 'Select a valid role' USING ERRCODE='22023'; END IF;
   IF actor_role='manager' AND (p_action='update_role' OR (p_action='invite' AND p_role<>'checkin')) THEN
     RAISE EXCEPTION 'Only the organiser can manage managers' USING ERRCODE='42501'; END IF;
   IF p_action='invite' THEN
     IF ev.status::text='CANCELLED' THEN RAISE EXCEPTION 'Event is cancelled' USING ERRCODE='22023'; END IF;
     IF p_user_id IS NOT NULL THEN
       SELECT u.id INTO target FROM auth.users u JOIN public.users p ON p.id=u.id
       WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL;
     ELSIF p_email IS NOT NULL AND length(trim(p_email)) BETWEEN 3 AND 254 THEN
       SELECT u.id INTO target FROM auth.users u JOIN public.users p ON p.id=u.id
       WHERE lower(u.email)=lower(trim(p_email)) AND u.email_confirmed_at IS NOT NULL;
     END IF;
     IF target IS NULL THEN RAISE EXCEPTION 'No YRDLY account found. Ask them to sign up and verify their email first.' USING ERRCODE='P0002'; END IF;
     IF target=ev.organizer_id OR target=actor THEN RAISE EXCEPTION 'This person already has event access' USING ERRCODE='22023'; END IF;
     SELECT * INTO member FROM public.event_team_members WHERE event_id=p_event_id AND user_id=target FOR UPDATE;
     IF FOUND THEN
       IF actor_role='manager' AND member.role<>'checkin' THEN RAISE EXCEPTION 'Only the organiser can manage managers' USING ERRCODE='42501'; END IF;
       IF member.status='accepted' OR (member.status='pending' AND member.expires_at>now()) THEN
         RETURN jsonb_build_object('success',true,'member_id',member.id,'status',CASE WHEN member.status='accepted' THEN 'active' ELSE member.status END,'already_invited',true);
       END IF;
       UPDATE public.event_team_members SET role=p_role,status='pending',invited_by=actor,expires_at=now()+interval '7 days',
         accepted_at=NULL,updated_at=now() WHERE id=member.id RETURNING * INTO member;
     ELSE
       INSERT INTO public.event_team_members(event_id,user_id,role,invited_by) VALUES(p_event_id,target,p_role,actor) RETURNING * INTO member;
     END IF;
     notify:=true;
   ELSE
     SELECT * INTO member FROM public.event_team_members WHERE id=p_member_id AND event_id=p_event_id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE='P0002'; END IF;
     IF actor_role='manager' AND member.role<>'checkin' THEN RAISE EXCEPTION 'Only the organiser can manage managers' USING ERRCODE='42501'; END IF;
     IF p_action='revoke' THEN
       UPDATE public.event_team_members SET status='revoked',updated_at=now() WHERE id=member.id RETURNING * INTO member;
     ELSE
       IF member.status NOT IN ('pending','accepted') THEN RAISE EXCEPTION 'Invite this person again to restore access' USING ERRCODE='22023'; END IF;
       UPDATE public.event_team_members SET role=p_role,updated_at=now() WHERE id=member.id RETURNING * INTO member;
     END IF;
   END IF;
 END IF;
 IF notify THEN
   PERFORM public.create_notification(member.user_id,'event_team_invite','You’re invited to an event team',
     'Join the team for '||ev.title||'. Open Assigned events to accept.',actor,p_event_id,'event_team',
     jsonb_build_object('event_id',p_event_id,'member_id',member.id,'url','/events/team'));
 END IF;
 RETURN jsonb_build_object('success',true,'member_id',member.id,'status',CASE WHEN member.status='accepted' THEN 'active' ELSE member.status END);
END; $$;

CREATE FUNCTION public.event_team_checkin(p_event_id uuid,p_ticket_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := private.require_event_team_account(); ev public.events%ROWTYPE; ticket public.tickets%ROWTYPE;
 actor_role text; code text := trim(p_ticket_code); tier_name text;
BEGIN
 IF code IS NULL OR length(code) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ticket_code and event_id are required' USING ERRCODE='22023'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE='P0002'; END IF;
 IF ev.organizer_id=actor THEN actor_role:='organizer';
 ELSE SELECT role INTO actor_role FROM public.event_team_members WHERE event_id=p_event_id AND user_id=actor AND status='accepted'; END IF;
 IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF ev.status::text<>'PUBLISHED' THEN RAISE EXCEPTION 'This event is not open for check-in' USING ERRCODE='22023'; END IF;
 IF code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   SELECT * INTO ticket FROM public.tickets WHERE id=code::uuid AND event_id=p_event_id FOR UPDATE;
 ELSE SELECT * INTO ticket FROM public.tickets WHERE ticket_code=upper(code) AND event_id=p_event_id FOR UPDATE; END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('valid',false,'error','INVALID_TICKET','message','Ticket not found for this event','http_status',404); END IF;
 IF ticket.expires_at IS NOT NULL AND ticket.expires_at<=now() THEN RETURN jsonb_build_object('valid',false,'error','TICKET_EXPIRED','message','This ticket has expired','http_status',400); END IF;
 IF ticket.status='USED' THEN RETURN jsonb_build_object('valid',false,'error','ALREADY_SCANNED','message','Ticket already used','http_status',409); END IF;
 IF ticket.status<>'PAID' THEN RETURN jsonb_build_object('valid',false,'error','TICKET_INVALID','message','Ticket is '||lower(ticket.status::text),'http_status',400); END IF;
 IF ticket.refund_status IS NOT NULL THEN RETURN jsonb_build_object('valid',false,'error','REFUND_IN_PROGRESS','message','This ticket has a refund request or review in progress','http_status',409); END IF;
 UPDATE public.tickets SET status='USED',scanned_at=now(),scanned_by=actor,updated_at=now() WHERE id=ticket.id;
 SELECT name INTO tier_name FROM public.ticket_tiers WHERE id=ticket.tier_id;
 RETURN jsonb_build_object('valid',true,'message','Check-in successful!','tier_name',tier_name,'attendee_name',ticket.attendee_name) ||
   CASE WHEN actor_role='organizer' THEN jsonb_build_object('attendee_email',ticket.attendee_email) ELSE '{}'::jsonb END;
END; $$;

REVOKE ALL ON FUNCTION public.event_team_assignments() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.event_team_snapshot(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.event_team_mutate(uuid,text,text,uuid,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.event_team_checkin(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_team_assignments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_team_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_team_mutate(uuid,text,text,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_team_checkin(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_ticket_client_update() FROM PUBLIC,anon,authenticated;
