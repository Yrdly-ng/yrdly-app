-- Read-only release contract. Run explicitly against the intended project.
-- This checks database readiness, not payment settlement or mobile compatibility.
WITH required_functions(signature) AS (VALUES
  ('public.reserve_ticket_checkout(jsonb)'),
  ('public.release_ticket_checkout(uuid,text,boolean)'),
  ('public.reserve_booking_checkout(uuid,uuid,text)'),
  ('public.requeue_seller_payout(uuid,uuid,numeric,text,text)'),
  ('public.save_payluk_dispute_plan(uuid,jsonb)'),
  ('public.apply_payluk_dispute_settlement(uuid,jsonb)'),
  ('public.claim_phone_verification_attempt(text,uuid)'),
  ('public.complete_phone_verification(text,uuid,text)')
), function_checks AS (
  SELECT signature, coalesce(
    has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')
    AND NOT has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')
    AND NOT has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) AS ready
  FROM required_functions
), checks(name,ready) AS (
  SELECT 'function:' || signature,ready FROM function_checks
  UNION ALL
  SELECT 'table:' || name,to_regclass('public.' || name) IS NOT NULL
  FROM unnest(ARRAY['phone_verification_challenges','ticket_checkout_reservations']) name
  UNION ALL
  SELECT 'booking_payments.' || name,EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='booking_payments' AND column_name=name
  ) FROM unnest(ARRAY['escrow_transaction_id','commission','total_amount']) name
  UNION ALL
  SELECT 'payout_requests.execution_stage',EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payout_requests' AND column_name='execution_stage'
  )
  UNION ALL
  SELECT 'disputes.provider_settlement',EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disputes' AND column_name='provider_settlement'
  )
  UNION ALL
  SELECT 'dispute_resolution_operations.' || name,EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dispute_resolution_operations' AND column_name=name
  ) FROM unnest(ARRAY['provider_plan','provider_settlement']) name
  UNION ALL
  SELECT 'guard:' || table_name || '.' || trigger_name,EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.' || table_name)
      AND tgname=trigger_name AND NOT tgisinternal AND tgenabled <> 'D'
  ) FROM (VALUES
    ('users','audit_guard_user_trust'),
    ('escrow_transactions','audit_guard_escrow'),
    ('seller_accounts','audit_guard_seller_accounts'),
    ('payout_requests','audit_guard_payout_requests'),
    ('tickets','audit_guard_ticket_insert'),
    ('posts','guard_paid_price_minimum'),
    ('catalog_items','guard_paid_price_minimum'),
    ('ticket_tiers','guard_paid_price_minimum'),
    ('service_offerings','guard_paid_price_minimum'),
    ('quote_requests','guard_paid_price_minimum'),
    ('bookings','guard_booking_pending_checkout'),
    ('escrow_transactions','sync_booking_escrow')
  ) guards(table_name,trigger_name)
  UNION ALL
  SELECT 'users_private_read',EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='users_private_read'
  )
  UNION ALL
  SELECT 'community_role_lookup_scoped',EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid=to_regprocedure('public.is_community_mod_or_admin(uuid,uuid)')
      AND prosrc LIKE '%p_user_id = auth.uid()%'
      AND prosrc LIKE '%auth.uid() IS NOT NULL%'
  )
  UNION ALL
  SELECT 'trigger_rpc_grants_removed',NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prorettype='trigger'::regtype AND p.prosecdef
      AND (has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  )
  UNION ALL
  SELECT 'private_bucket:' || bucket,EXISTS (
    SELECT 1 FROM storage.buckets WHERE id=bucket AND NOT public
  ) FROM unnest(ARRAY['chat-images','chat-videos','reports']) bucket
)
SELECT jsonb_build_object(
  'checked_at',now(),
  'read_only',true,
  'database_contract_ready',(SELECT bool_and(ready) FROM checks),
  'checks',(SELECT jsonb_object_agg(name,ready ORDER BY name) FROM checks),
  'duplicate_customer_mapping_groups',(SELECT count(*) FROM (
    SELECT payluk_customer_id FROM public.users WHERE payluk_customer_id IS NOT NULL
    GROUP BY payluk_customer_id HAVING count(*)>1
  ) d),
  'unfulfilled_legacy_ticket_checkouts',(SELECT count(*) FROM public.escrow_transactions x
    WHERE x.item_type='ticket' AND x.status IN ('pending','creating_escrow','reconciling','paid','shipped','delivered')
      AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.payment_tx_ref=x.id::text)),
  -- This is the original migration guard count. After the migration, retained
  -- verified split fixtures legitimately appear here; do not replay migrations.
  'resolved_splits_migration_guard_count',(SELECT count(*) FROM public.disputes d
    JOIN public.escrow_transactions t ON t.id=d.transaction_id
    WHERE d.status='resolved' AND d.refund_amount>0 AND d.seller_amount>0 AND t.status='completed'),
  'pending_payouts_requiring_reconciliation',(SELECT count(*) FROM public.payout_requests WHERE status IN ('pending','processing'))
) AS release_preflight;
