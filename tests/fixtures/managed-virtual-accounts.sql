-- Run only against a disposable database after the fixture and migration.
INSERT INTO auth.users(id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,8) n;
INSERT INTO public.users(id,name,is_admin) SELECT id,'Fixture',id='00000000-0000-0000-0000-000000000001' FROM auth.users;
INSERT INTO auth.sessions(id,user_id) VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
SELECT set_config('request.jwt.claims','{"role":"service_role","session_id":"10000000-0000-0000-0000-000000000001"}',false);
UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('managed_virtual_slot',right(id::text,1)::int-1),banned_until=now()+interval '100 years' WHERE id<>'00000000-0000-0000-0000-000000000001';
SELECT public.managed_virtual_register(1,'00000000-0000-0000-0000-000000000002','{"name":"Fictional Teni"}');
SELECT public.managed_virtual_register(2,'00000000-0000-0000-0000-000000000003','{"name":"Fictional Chisom"}');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.posts(user_id,text,category) VALUES('00000000-0000-0000-0000-000000000002','Bypass','General');
  RAISE EXCEPTION 'FAIL: privileged direct virtual post succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.users SET account_kind='human' WHERE id='00000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'FAIL: managed classification was mutable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
 INSERT INTO public.notifications(user_id,sender_id)
 VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
 IF EXISTS(SELECT 1 FROM public.notifications WHERE sender_id='00000000-0000-0000-0000-000000000002') THEN
  RAISE EXCEPTION 'FAIL: synthetic notification reached human recipient';
 END IF;
 INSERT INTO public.push_notification_deliveries(user_id,payload)
 VALUES('00000000-0000-0000-0000-000000000002','{}');
 IF EXISTS(SELECT 1 FROM public.push_notification_deliveries WHERE user_id='00000000-0000-0000-0000-000000000002') THEN
  RAISE EXCEPTION 'FAIL: virtual identity received push delivery';
 END IF;
END $$;
SELECT public.managed_virtual_register(3,'00000000-0000-0000-0000-000000000004','{"name":"Fictional Ebiere"}');
SELECT public.managed_virtual_register(4,'00000000-0000-0000-0000-000000000005','{"name":"Fictional Hauwa"}');
SELECT public.managed_virtual_register(5,'00000000-0000-0000-0000-000000000006','{"name":"Fictional Sani"}');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE response jsonb; draft jsonb; job public.managed_virtual_jobs; managed_post uuid; human_post uuid; comment_id uuid; before_count integer; uid uuid;
BEGIN
 IF (SELECT enabled FROM public.managed_virtual_config) THEN RAISE EXCEPTION 'FAIL: enabled by default'; END IF;
 BEGIN
  PERFORM public.managed_virtual_admin('configure','{"enabled":true}');
  RAISE EXCEPTION 'FAIL: enabled without disclosure readiness';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.managed_virtual_admin('configure','{"enabled":true,"client_disclosure_ready":true,"posting_enabled":true,"commenting_enabled":true,"liking_enabled":true,"start_hour":0,"end_hour":24}');
 FOR uid IN SELECT user_id FROM public.managed_virtual_accounts LOOP
  PERFORM public.managed_virtual_admin('account',jsonb_build_object('user_id',uid,'status','active'));
 END LOOP;
 INSERT INTO public.posts(user_id,text,category) VALUES('00000000-0000-0000-0000-000000000001','Human authored discussion','General') RETURNING id INTO human_post;
 draft:=public.managed_virtual_admin('draft','{"account_id":"00000000-0000-0000-0000-000000000002","action":"post","text":"What creative gardening projects are you enjoying this weekend?","topic":"gardening"}');
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','post-test-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(100);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'done' THEN RAISE EXCEPTION 'FAIL: approved post failed: %',response; END IF;
 managed_post:=(response->>'result_id')::uuid;
 IF (SELECT activity_origin FROM public.posts WHERE id=managed_post)<>'synthetic' THEN RAISE EXCEPTION 'FAIL: missing attribution'; END IF;
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF (SELECT count(*) FROM public.posts WHERE user_id='00000000-0000-0000-0000-000000000002')<>1 THEN RAISE EXCEPTION 'FAIL: duplicate retry'; END IF;
 -- Direct service-like updates and inserts cannot target humans or rewrite attribution.
 BEGIN
  INSERT INTO public.comments(post_id,user_id,text) VALUES(human_post,'00000000-0000-0000-0000-000000000003','Forbidden human reply');
  RAISE EXCEPTION 'FAIL: direct human comment succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.posts SET liked_by=ARRAY['00000000-0000-0000-0000-000000000002'::uuid] WHERE id=human_post;
  RAISE EXCEPTION 'FAIL: synthetic like polluted ranking';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.conversations(participant_ids) VALUES(ARRAY['00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid]);
  RAISE EXCEPTION 'FAIL: inbound direct message conversation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.business_reviews(user_id,comment) VALUES('00000000-0000-0000-0000-000000000002','Not allowed');
  RAISE EXCEPTION 'FAIL: managed review';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.posts SET category='For Sale' WHERE id=managed_post;
  RAISE EXCEPTION 'FAIL: managed marketplace category';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 draft:=public.managed_virtual_admin('draft',jsonb_build_object('account_id','00000000-0000-0000-0000-000000000003','action','comment','text','Container herbs might be a rewarding place to begin.','topic','herb containers','target_post_id',managed_post));
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','comment-test-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'done' THEN RAISE EXCEPTION 'FAIL: virtual comment rejected: %',response; END IF;
 comment_id:=(response->>'result_id')::uuid;
 IF (SELECT comment_count FROM public.posts WHERE id=managed_post)<>0 OR(SELECT synthetic_comment_count FROM public.posts WHERE id=managed_post)<>1 THEN RAISE EXCEPTION 'FAIL: comment counts mixed'; END IF;
 BEGIN
  UPDATE public.comments SET post_id=human_post WHERE id=comment_id;
  RAISE EXCEPTION 'FAIL: virtual comment moved to human post';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.comments(post_id,user_id,text) VALUES(managed_post,'00000000-0000-0000-0000-000000000001','Human organic reply');
 IF (SELECT comment_count FROM public.posts WHERE id=managed_post)<>1 THEN RAISE EXCEPTION 'FAIL: human count regression'; END IF;
 UPDATE public.posts SET comment_count=900,synthetic_comment_count=900 WHERE id=managed_post;
 IF (SELECT comment_count FROM public.posts WHERE id=managed_post)<>1 OR(SELECT synthetic_comment_count FROM public.posts WHERE id=managed_post)<>1 THEN RAISE EXCEPTION 'FAIL: client counters accepted'; END IF;
 draft:=public.managed_virtual_admin('draft',jsonb_build_object('account_id','00000000-0000-0000-0000-000000000004','action','like','target_post_id',human_post));
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','like-test-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'done' THEN RAISE EXCEPTION 'FAIL: synthetic like rejected: %',response; END IF;
 IF (SELECT cardinality(liked_by) FROM public.posts WHERE id=human_post)<>0 OR(SELECT synthetic_like_count FROM public.posts WHERE id=human_post)<>1 THEN RAISE EXCEPTION 'FAIL: synthetic like counts mixed'; END IF;
 -- A backend key must not let virtual accounts reach friends-only human content.
 UPDATE public.posts SET visibility='friends' WHERE id=human_post;
 draft:=public.managed_virtual_admin('draft',jsonb_build_object('account_id','00000000-0000-0000-0000-000000000005','action','like','target_post_id',human_post));
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','private-like-test'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'failed' OR response->>'reason' NOT LIKE '%Target is ineligible%' THEN RAISE EXCEPTION 'FAIL: virtual like reached private post: %',response; END IF;
 IF (SELECT synthetic_like_count FROM public.posts WHERE id=human_post)<>1 THEN RAISE EXCEPTION 'FAIL: private post gained synthetic interaction'; END IF;
 UPDATE public.posts SET visibility='public' WHERE id=human_post;
 draft:=public.managed_virtual_admin('draft',jsonb_build_object('account_id','00000000-0000-0000-0000-000000000005','action','comment','text','This should never appear beneath a human authored post.','topic','forbidden target','target_post_id',human_post));
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','comment-human-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'failed' OR response->>'reason' NOT LIKE '%never comment%' THEN RAISE EXCEPTION 'FAIL: worker human target: %',response; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.managed_virtual_audit WHERE job_id=job.id AND outcome='rejected') THEN RAISE EXCEPTION 'FAIL: missing rejection audit'; END IF;
 draft:=public.managed_virtual_admin('draft','{"account_id":"00000000-0000-0000-0000-000000000006","action":"post","text":"What creative gardening projects are you enjoying this weekend?","topic":"duplicate gardening"}');
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','duplicate-test-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 response:=public.execute_managed_virtual_job(job.id,job.lease_token);
 IF response->>'status'<>'failed' OR response->>'reason' NOT LIKE '%Duplicate%' THEN RAISE EXCEPTION 'FAIL: duplicate content allowed: %',response; END IF;
 draft:=public.managed_virtual_admin('draft','{"account_id":"00000000-0000-0000-0000-000000000006","action":"post","text":"Which traditional board games would make a fun evening?","topic":"board games"}');
 PERFORM public.managed_virtual_admin('review',jsonb_build_object('draft_id',draft->>'id','approved',true));
 PERFORM public.managed_virtual_admin('schedule',jsonb_build_object('draft_id',draft->>'id','scheduled_at',clock_timestamp(),'idempotency_key','stop-test-one'));
 SELECT * INTO job FROM public.claim_managed_virtual_jobs(5);
 PERFORM public.managed_virtual_admin('stop');
 BEGIN
  PERFORM public.execute_managed_virtual_job(job.id,job.lease_token);
  RAISE EXCEPTION 'FAIL: claimed job executed after stop';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.claim_managed_virtual_jobs(5)) THEN RAISE EXCEPTION 'FAIL: claimed while stopped'; END IF;
 -- Ordinary authenticated callers never gain backend provisioning/execution.
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","session_id":"10000000-0000-0000-0000-000000000001"}',true);
 BEGIN
  PERFORM public.claim_managed_virtual_jobs(5);
  RAISE EXCEPTION 'FAIL: interactive caller claimed jobs';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
 BEGIN
  PERFORM public.managed_virtual_admin('status');
  RAISE EXCEPTION 'FAIL: ordinary user read private admin data';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","session_id":"10000000-0000-0000-0000-000000000099"}',true);
 BEGIN
  PERFORM public.managed_virtual_admin('status');
  RAISE EXCEPTION 'FAIL: inactive administrator session read managed data';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
