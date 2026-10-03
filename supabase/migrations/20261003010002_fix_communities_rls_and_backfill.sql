-- =============================================================================
-- Communities Fix Migration 20261003010002
-- 1. Grant SELECT to both authenticated and anon roles for open/request communities
-- 2. Fix empty string home_ward/home_lga matching in auto-join trigger & backfill
-- =============================================================================

DROP POLICY IF EXISTS "communities_select" ON public.communities;
CREATE POLICY "communities_select" ON public.communities FOR SELECT TO authenticated, anon USING (
  privacy IN ('open','request')
  OR EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = id AND m.user_id = auth.uid() AND m.status = 'active'
  )
);

CREATE OR REPLACE FUNCTION public.fn_auto_join_ward_community()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ward_comm_id UUID;
  v_lga_comm_id  UUID;
BEGIN
  IF (TG_OP = 'UPDATE') AND
     (NEW.home_ward IS NOT DISTINCT FROM OLD.home_ward) AND
     (NEW.home_lga  IS NOT DISTINCT FROM OLD.home_lga)  AND
     (NEW.home_state IS NOT DISTINCT FROM OLD.home_state) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.community_memberships
  WHERE user_id = NEW.id AND is_auto_joined = true
    AND community_id IN (
      SELECT id FROM public.communities WHERE type IN ('ward','lga')
    );

  -- Re-join ward community if valid non-empty home_ward
  IF NEW.home_ward IS NOT NULL AND NEW.home_ward != '' AND NEW.home_lga IS NOT NULL AND NEW.home_lga != '' AND NEW.home_state IS NOT NULL AND NEW.home_state != '' THEN
    SELECT id INTO v_ward_comm_id FROM public.communities
    WHERE type = 'ward' AND state = NEW.home_state AND lga = NEW.home_lga AND ward = NEW.home_ward
    LIMIT 1;

    IF v_ward_comm_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_ward_comm_id, NEW.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO UPDATE
        SET status = 'active', is_auto_joined = true, updated_at = NOW();
    END IF;
  END IF;

  -- Re-join LGA community if valid non-empty home_lga
  IF NEW.home_lga IS NOT NULL AND NEW.home_lga != '' AND NEW.home_state IS NOT NULL AND NEW.home_state != '' THEN
    SELECT id INTO v_lga_comm_id FROM public.communities
    WHERE type = 'lga' AND state = NEW.home_state AND lga = NEW.home_lga AND ward IS NULL
    LIMIT 1;

    IF v_lga_comm_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_lga_comm_id, NEW.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO UPDATE
        SET status = 'active', is_auto_joined = true, updated_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  rec RECORD;
  v_ward_id UUID;
  v_lga_id  UUID;
BEGIN
  FOR rec IN SELECT id, home_state, home_lga, home_ward FROM public.users
             WHERE home_lga IS NOT NULL AND home_lga != '' AND home_state IS NOT NULL AND home_state != ''
  LOOP
    SELECT id INTO v_lga_id FROM public.communities
    WHERE type = 'lga' AND state = rec.home_state AND lga = rec.home_lga AND ward IS NULL LIMIT 1;

    IF v_lga_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_lga_id, rec.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO UPDATE SET status = 'active', is_auto_joined = true;
    END IF;

    IF rec.home_ward IS NOT NULL AND rec.home_ward != '' THEN
      SELECT id INTO v_ward_id FROM public.communities
      WHERE type = 'ward' AND state = rec.home_state AND lga = rec.home_lga AND ward = rec.home_ward LIMIT 1;

      IF v_ward_id IS NOT NULL THEN
        INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
        VALUES (v_ward_id, rec.id, 'member', 'active', true)
        ON CONFLICT (community_id, user_id) DO UPDATE SET status = 'active', is_auto_joined = true;
      END IF;
    END IF;
  END LOOP;
END;
$$;
