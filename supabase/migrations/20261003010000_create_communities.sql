-- =============================================================================
-- Communities Feature — Phase 1: Schema, RLS, Triggers, Seed
-- Applied to BOTH yrdly-app and yrdly-mobile Supabase projects.
-- =============================================================================

-- 0. Extend moderation_queue.table_name CHECK to accept community tables
ALTER TABLE public.moderation_queue
  DROP CONSTRAINT IF EXISTS moderation_queue_table_name_check;
ALTER TABLE public.moderation_queue
  ADD CONSTRAINT moderation_queue_table_name_check
  CHECK (table_name IN ('posts','events','businesses','catalog_items','users','community_posts','community_comments'));

-- =============================================================================
-- 1. COMMUNITIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.communities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  description         TEXT,
  avatar_url          TEXT,
  banner_url          TEXT,
  type                TEXT NOT NULL CHECK (type IN ('ward','lga','interest')),
  privacy             TEXT NOT NULL DEFAULT 'open' CHECK (privacy IN ('open','request','invite')),
  state               TEXT,
  lga                 TEXT,
  ward                TEXT,
  ward_id             UUID REFERENCES public.lga_wards(id) ON DELETE SET NULL,
  parent_community_id UUID REFERENCES public.communities(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_official         BOOLEAN NOT NULL DEFAULT false,
  rules               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- post_daily_limit = 0 means no limit (interest groups). ward/lga default = 5.
  post_daily_limit    INT NOT NULL DEFAULT 5,
  member_count        INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communities_location
  ON public.communities(type, state, lga, ward);
CREATE INDEX IF NOT EXISTS idx_communities_parent
  ON public.communities(parent_community_id);
CREATE INDEX IF NOT EXISTS idx_communities_slug
  ON public.communities(slug);

-- =============================================================================
-- 2. COMMUNITY MEMBERSHIPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','banned')),
  is_auto_joined  BOOLEAN NOT NULL DEFAULT false,
  is_muted        BOOLEAN NOT NULL DEFAULT false,
  muted_at        TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_memberships_user
  ON public.community_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_memberships_comm
  ON public.community_memberships(community_id, status, role);

-- =============================================================================
-- 3. COMMUNITY POSTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  author_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_name       TEXT,
  author_image      TEXT,
  content           TEXT NOT NULL,
  image_urls        TEXT[],
  video_urls        TEXT[],
  is_pinned         BOOLEAN NOT NULL DEFAULT false,
  is_edited         BOOLEAN NOT NULL DEFAULT false,
  like_count        INT NOT NULL DEFAULT 0,
  comment_count     INT NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending','approved','rejected','moderation_error')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_posts_feed
  ON public.community_posts(community_id, moderation_status, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_posts_author
  ON public.community_posts(author_id);

-- =============================================================================
-- 4. COMMUNITY POST LIKES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_post_likes (
  post_id    UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

-- =============================================================================
-- 5. COMMUNITY COMMENTS (threaded, 1 level deep on v1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  community_id      UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  author_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_name       TEXT,
  author_image      TEXT,
  parent_comment_id UUID REFERENCES public.community_comments(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  like_count        INT NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending','approved','rejected','moderation_error')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_comments_post
  ON public.community_comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comm_comments_parent
  ON public.community_comments(parent_comment_id);

-- =============================================================================
-- 6. JOIN REQUESTS (for request-to-join communities)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_join_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID REFERENCES public.users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_join_requests
  ON public.community_join_requests(community_id, status);

-- =============================================================================
-- 7. COMMENT LIKES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.community_comment_likes (
  comment_id UUID NOT NULL REFERENCES public.community_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

-- =============================================================================
-- 8. RLS POLICIES
-- =============================================================================
ALTER TABLE public.communities               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comment_likes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_join_requests   ENABLE ROW LEVEL SECURITY;

-- COMMUNITIES —————————————————————————————————————————
-- open + request: visible to all authenticated users
-- invite: only active members can see it
DROP POLICY IF EXISTS "communities_select" ON public.communities;
CREATE POLICY "communities_select" ON public.communities FOR SELECT TO authenticated USING (
  privacy IN ('open','request')
  OR EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = id AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
-- Only admins can create/update communities (interest groups); ward/lga created by seeder
DROP POLICY IF EXISTS "communities_admin_insert" ON public.communities;
CREATE POLICY "communities_admin_insert" ON public.communities FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin = true OR u.role = 'admin'))
);
DROP POLICY IF EXISTS "communities_admin_update" ON public.communities;
CREATE POLICY "communities_admin_update" ON public.communities FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (u.is_admin = true OR u.role = 'admin'))
);

-- COMMUNITY MEMBERSHIPS ————————————————————————————————
CREATE POLICY "memberships_select_own" ON public.community_memberships FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.community_memberships m2
    WHERE m2.community_id = community_id AND m2.user_id = auth.uid()
    AND m2.role IN ('moderator','admin') AND m2.status = 'active'
  )
);
-- Users can join open communities themselves; system trigger handles auto-joins
CREATE POLICY "memberships_insert_open" ON public.community_memberships FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND status = 'active' AND role = 'member' AND
  EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_id AND c.privacy = 'open')
);
CREATE POLICY "memberships_update_own_mute" ON public.community_memberships FOR UPDATE TO authenticated USING (
  user_id = auth.uid()
);
-- Mods/admins can update roles and bans
CREATE POLICY "memberships_mod_update" ON public.community_memberships FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m2
    WHERE m2.community_id = community_id AND m2.user_id = auth.uid()
    AND m2.role IN ('moderator','admin') AND m2.status = 'active'
  )
);
-- Users can leave (delete own membership)
CREATE POLICY "memberships_delete_own" ON public.community_memberships FOR DELETE TO authenticated USING (
  user_id = auth.uid()
);

-- COMMUNITY POSTS ——————————————————————————————————————
CREATE POLICY "comm_posts_select" ON public.community_posts FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_posts.community_id
    AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
CREATE POLICY "comm_posts_insert" ON public.community_posts FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_posts.community_id
    AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
-- Author can update own post
CREATE POLICY "comm_posts_update_author" ON public.community_posts FOR UPDATE TO authenticated USING (
  author_id = auth.uid()
);
-- Mod/admin can update any post (pin, reject)
CREATE POLICY "comm_posts_update_mod" ON public.community_posts FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_posts.community_id AND m.user_id = auth.uid()
    AND m.role IN ('moderator','admin') AND m.status = 'active'
  )
);
CREATE POLICY "comm_posts_delete_author" ON public.community_posts FOR DELETE TO authenticated USING (
  author_id = auth.uid()
);
CREATE POLICY "comm_posts_delete_mod" ON public.community_posts FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_posts.community_id AND m.user_id = auth.uid()
    AND m.role IN ('moderator','admin') AND m.status = 'active'
  )
);

-- COMMUNITY POST LIKES ——————————————————————————————————
CREATE POLICY "comm_post_likes_select" ON public.community_post_likes FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    JOIN public.community_posts p ON p.id = community_post_likes.post_id
    WHERE m.community_id = p.community_id AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
CREATE POLICY "comm_post_likes_insert" ON public.community_post_likes FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY "comm_post_likes_delete" ON public.community_post_likes FOR DELETE TO authenticated USING (
  user_id = auth.uid()
);

-- COMMUNITY COMMENTS ————————————————————————————————————
CREATE POLICY "comm_comments_select" ON public.community_comments FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_comments.community_id
    AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
CREATE POLICY "comm_comments_insert" ON public.community_comments FOR INSERT TO authenticated WITH CHECK (
  author_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_comments.community_id
    AND m.user_id = auth.uid() AND m.status = 'active'
  )
);
CREATE POLICY "comm_comments_update_author" ON public.community_comments FOR UPDATE TO authenticated USING (
  author_id = auth.uid()
);
CREATE POLICY "comm_comments_delete_author" ON public.community_comments FOR DELETE TO authenticated USING (
  author_id = auth.uid()
);
CREATE POLICY "comm_comments_delete_mod" ON public.community_comments FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_comments.community_id AND m.user_id = auth.uid()
    AND m.role IN ('moderator','admin') AND m.status = 'active'
  )
);

-- COMMUNITY COMMENT LIKES ————————————————————————————————
CREATE POLICY "comm_comment_likes_select" ON public.community_comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "comm_comment_likes_insert" ON public.community_comment_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "comm_comment_likes_delete" ON public.community_comment_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

-- COMMUNITY JOIN REQUESTS ——————————————————————————————
CREATE POLICY "join_requests_insert" ON public.community_join_requests FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY "join_requests_select_own" ON public.community_join_requests FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_join_requests.community_id AND m.user_id = auth.uid()
    AND m.role IN ('moderator','admin') AND m.status = 'active'
  )
);
CREATE POLICY "join_requests_update_mod" ON public.community_join_requests FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = community_join_requests.community_id AND m.user_id = auth.uid()
    AND m.role IN ('moderator','admin') AND m.status = 'active'
  )
);

-- =============================================================================
-- 9. TRIGGERS & FUNCTIONS
-- =============================================================================

-- 9a. member_count maintenance (community_memberships INSERT/DELETE)
CREATE OR REPLACE FUNCTION public.fn_community_member_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.communities SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE public.communities SET member_count = GREATEST(0, member_count - 1), updated_at = NOW()
    WHERE id = OLD.community_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'active' AND NEW.status = 'active' THEN
      UPDATE public.communities SET member_count = member_count + 1, updated_at = NOW()
      WHERE id = NEW.community_id;
    ELSIF OLD.status = 'active' AND NEW.status != 'active' THEN
      UPDATE public.communities SET member_count = GREATEST(0, member_count - 1), updated_at = NOW()
      WHERE id = OLD.community_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_community_member_count ON public.community_memberships;
CREATE TRIGGER tr_community_member_count
AFTER INSERT OR UPDATE OR DELETE ON public.community_memberships
FOR EACH ROW EXECUTE FUNCTION public.fn_community_member_count();

-- 9b. comment_count sync on community_posts
CREATE OR REPLACE FUNCTION public.fn_community_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET comment_count = comment_count + 1, updated_at = NOW()
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = NOW()
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_community_comment_count ON public.community_comments;
CREATE TRIGGER tr_community_comment_count
AFTER INSERT OR DELETE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.fn_community_comment_count();

-- 9c. Post rate-limit enforcement
CREATE OR REPLACE FUNCTION public.fn_check_community_post_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_daily_limit INT;
  v_today_count INT;
  v_role        TEXT;
BEGIN
  -- Moderators and admins bypass rate limits
  SELECT role INTO v_role FROM public.community_memberships
  WHERE community_id = NEW.community_id AND user_id = NEW.author_id AND status = 'active';

  IF v_role IN ('moderator','admin') THEN RETURN NEW; END IF;

  SELECT post_daily_limit INTO v_daily_limit FROM public.communities WHERE id = NEW.community_id;
  IF v_daily_limit IS NULL OR v_daily_limit = 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_today_count FROM public.community_posts
  WHERE community_id = NEW.community_id
    AND author_id = NEW.author_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_today_count >= v_daily_limit THEN
    RAISE EXCEPTION 'You have reached the post limit for this community (% posts per 24 h).', v_daily_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_community_post_rate_limit ON public.community_posts;
CREATE TRIGGER tr_community_post_rate_limit
BEFORE INSERT ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.fn_check_community_post_rate_limit();

-- 9d. Auto-join user to ward + parent LGA community on home_ward change
CREATE OR REPLACE FUNCTION public.fn_auto_join_ward_community()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ward_comm_id UUID;
  v_lga_comm_id  UUID;
BEGIN
  -- Only run when home_ward, home_lga, or home_state change
  IF (TG_OP = 'UPDATE') AND
     (NEW.home_ward IS NOT DISTINCT FROM OLD.home_ward) AND
     (NEW.home_lga  IS NOT DISTINCT FROM OLD.home_lga)  AND
     (NEW.home_state IS NOT DISTINCT FROM OLD.home_state) THEN
    RETURN NEW;
  END IF;

  -- Remove old auto-joined ward/lga memberships for this user
  DELETE FROM public.community_memberships
  WHERE user_id = NEW.id AND is_auto_joined = true
    AND community_id IN (
      SELECT id FROM public.communities WHERE type IN ('ward','lga')
    );

  -- Re-join ward community
  IF NEW.home_ward IS NOT NULL AND NEW.home_lga IS NOT NULL AND NEW.home_state IS NOT NULL THEN
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

  -- Re-join LGA community
  IF NEW.home_lga IS NOT NULL AND NEW.home_state IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS tr_auto_join_ward_community ON public.users;
CREATE TRIGGER tr_auto_join_ward_community
AFTER INSERT OR UPDATE OF home_ward, home_lga, home_state ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_join_ward_community();

-- =============================================================================
-- 10. SEED: Create one community per unique (state, lga) and per unique (state, lga, ward)
--     Uses INSERT … ON CONFLICT DO NOTHING so it is idempotent.
-- =============================================================================

-- LGA-level communities (no ward column, parent = NULL)
INSERT INTO public.communities (name, slug, type, privacy, state, lga, ward, is_official, post_daily_limit)
SELECT
  lga || ' Community' AS name,
  lower(regexp_replace(state || '-' || lga, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
  'lga'::text,
  'open'::text,
  state,
  lga,
  NULL,
  true,
  0   -- no top-level post limit for LGA announcement layer
FROM (
  SELECT DISTINCT state, lga FROM public.lga_wards
) lgas
ON CONFLICT (slug) DO NOTHING;

-- Ward-level communities (linked to lga parent)
INSERT INTO public.communities (name, slug, type, privacy, state, lga, ward, ward_id, parent_community_id, is_official, post_daily_limit)
SELECT
  w.ward || ' Ward' AS name,
  lower(regexp_replace(w.state || '-' || w.lga || '-' || w.ward, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
  'ward'::text,
  'open'::text,
  w.state,
  w.lga,
  w.ward,
  w.id AS ward_id,
  c.id AS parent_community_id,
  true,
  5   -- 5 posts per 24 h per user
FROM public.lga_wards w
JOIN public.communities c
  ON c.type = 'lga' AND c.state = w.state AND c.lga = w.lga AND c.ward IS NULL
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 11. BACKFILL: auto-join all existing users with a home_ward set
-- =============================================================================
DO $$
DECLARE
  rec RECORD;
  v_ward_id UUID;
  v_lga_id  UUID;
BEGIN
  FOR rec IN SELECT id, home_state, home_lga, home_ward FROM public.users
             WHERE home_ward IS NOT NULL AND home_lga IS NOT NULL AND home_state IS NOT NULL
  LOOP
    SELECT id INTO v_ward_id FROM public.communities
    WHERE type = 'ward' AND state = rec.home_state AND lga = rec.home_lga AND ward = rec.home_ward LIMIT 1;

    IF v_ward_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_ward_id, rec.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO NOTHING;
    END IF;

    SELECT id INTO v_lga_id FROM public.communities
    WHERE type = 'lga' AND state = rec.home_state AND lga = rec.home_lga AND ward IS NULL LIMIT 1;

    IF v_lga_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_lga_id, rec.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
