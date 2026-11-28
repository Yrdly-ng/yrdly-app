-- Protect catalog_items from direct Data API requests.
-- Public reads are limited to approved inventory attached to approved, active,
-- non-flagged businesses. Owners can manage their own pending items. Payment
-- transaction identifiers remain server-only; server routes use service_role.

ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view catalog items" ON public.catalog_items;
DROP POLICY IF EXISTS "Business owners can manage their catalog items" ON public.catalog_items;
DROP POLICY IF EXISTS "active_account_session" ON public.catalog_items;

REVOKE ALL PRIVILEGES ON TABLE public.catalog_items FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, business_id, title, description, price, images, category, in_stock,
  quantity, inventory_count, moderation_status, created_at, updated_at
) ON TABLE public.catalog_items TO anon, authenticated;

GRANT INSERT (
  business_id, title, description, price, images, category, in_stock,
  quantity, inventory_count
) ON TABLE public.catalog_items TO authenticated;

GRANT UPDATE (
  title, description, price, images, category, in_stock, quantity,
  inventory_count, updated_at
) ON TABLE public.catalog_items TO authenticated;

GRANT DELETE ON TABLE public.catalog_items TO authenticated;

CREATE POLICY "catalog public approved select"
  ON public.catalog_items FOR SELECT TO anon, authenticated
  USING (
    moderation_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = catalog_items.business_id
        AND businesses.is_active = true
        AND businesses.moderation_status = 'approved'
        AND businesses.is_flagged = false
    )
  );

CREATE POLICY "catalog owners manage own items"
  ON public.catalog_items FOR ALL TO authenticated
  USING (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = catalog_items.business_id
        AND businesses.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_current_session_active()
    AND EXISTS (
      SELECT 1 FROM public.businesses
      WHERE businesses.id = catalog_items.business_id
        AND businesses.owner_id = (SELECT auth.uid())
    )
  );
