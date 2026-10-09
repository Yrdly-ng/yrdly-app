-- Additive prerequisite for the new checkout and webhook code; review before applying.
BEGIN;
CREATE UNIQUE INDEX idx_escrow_transactions_single_active_post
ON public.escrow_transactions(item_id)
WHERE coalesce(item_type,'post') = 'post' AND status NOT IN ('cancelled','completed');

CREATE OR REPLACE FUNCTION public.reserve_catalog_stock(p_item_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 UPDATE public.catalog_items SET
  quantity = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) - p_qty,
  inventory_count = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) - p_qty,
  in_stock = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) > p_qty,
  updated_at = now()
 WHERE id = p_item_id AND in_stock = true
 AND coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) >= p_qty;
 RETURN FOUND;
END; $$;
CREATE OR REPLACE FUNCTION public.release_catalog_stock(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 UPDATE public.catalog_items SET quantity = coalesce(quantity,inventory_count,0) + p_qty,
 inventory_count = coalesce(quantity,inventory_count,0) + p_qty, in_stock = true, updated_at = now() WHERE id = p_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog item not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.create_checkout_reservation(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 IF p_payload->>'item_type' NOT IN ('post','catalog_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
 IF p_payload->>'item_type' = 'catalog_item' AND NOT public.reserve_catalog_stock((p_payload->>'item_id')::uuid,1) THEN
  RAISE EXCEPTION 'Item no longer available' USING ERRCODE = '23514';
 END IF;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,metadata)
 VALUES(p_payload->>'item_id',(p_payload->>'buyer_id')::uuid,(p_payload->>'seller_id')::uuid,
 (p_payload->>'amount')::numeric,(p_payload->>'commission')::numeric,(p_payload->>'total_amount')::numeric,
 (p_payload->>'seller_amount')::numeric,'pending','card',p_payload->'delivery_details',p_payload->>'item_type',
 jsonb_build_object('inventory_reserved',p_payload->>'item_type' = 'catalog_item')) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.abandon_checkout_reservation(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND OR tx.status NOT IN ('pending','creating_escrow') OR tx.payluk_escrow_id IS NOT NULL THEN RETURN; END IF;
 IF tx.item_type = 'catalog_item' AND tx.metadata->>'inventory_reserved' = 'true' THEN
  PERFORM public.release_catalog_stock(tx.item_id::uuid,1);
 END IF;
 UPDATE public.escrow_transactions SET status = 'cancelled',metadata = coalesce(metadata,'{}'::jsonb) || '{"inventory_reserved":false}'::jsonb,updated_at = now() WHERE id = tx.id;
END; $$;

CREATE OR REPLACE FUNCTION public.apply_escrow_payment(p_transaction_id uuid, p_provider text, p_reference text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown transaction'; END IF;
 IF tx.status IN ('paid','shipped','delivered','completed') THEN RETURN 'replay'; END IF;
 IF tx.status NOT IN ('pending','creating_escrow','reconciling') THEN
  INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
  VALUES(p_provider,p_reference,tx.id,'late_success') ON CONFLICT DO NOTHING;
  RETURN 'review';
 END IF;
 IF tx.item_type = 'catalog_item' AND coalesce(tx.metadata->>'inventory_reserved','false') <> 'true' THEN
  IF NOT public.reserve_catalog_stock(tx.item_id::uuid,1) THEN
   INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
   VALUES(p_provider,p_reference,tx.id,'paid_without_stock') ON CONFLICT DO NOTHING;
   UPDATE public.escrow_transactions SET status = 'reconciling',updated_at = now() WHERE id = tx.id;
   RETURN 'review';
  END IF;
  tx.metadata := coalesce(tx.metadata,'{}'::jsonb) || '{"inventory_reserved":true}'::jsonb;
 END IF;
 UPDATE public.escrow_transactions SET status = 'paid',payment_provider = p_provider,
 payment_reference = p_reference,paid_at = now(),updated_at = now(),metadata = tx.metadata WHERE id = tx.id;
 IF coalesce(tx.item_type,'post') = 'post' THEN
  UPDATE public.posts SET is_sold = true,sold_to_user_id = tx.buyer_id,sold_at = now(),transaction_id = tx.id,updated_at = now()
  WHERE id::text = tx.item_id AND (is_sold = false OR transaction_id = tx.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing changed before payment'; END IF;
 END IF;
 RETURN 'applied';
END; $$;

REVOKE ALL ON FUNCTION public.reserve_catalog_stock(uuid,integer),public.release_catalog_stock(uuid,integer),
 public.create_checkout_reservation(jsonb),public.abandon_checkout_reservation(uuid),public.apply_escrow_payment(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_catalog_stock(uuid,integer),public.release_catalog_stock(uuid,integer),
 public.create_checkout_reservation(jsonb),public.abandon_checkout_reservation(uuid),public.apply_escrow_payment(uuid,text,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
