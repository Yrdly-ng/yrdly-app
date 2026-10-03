# Phase 0 — Recon & Architecture Plan: Communities (Area-Based Group Spaces)

> [!IMPORTANT]
> **RECON ONLY / DRAFT PLAN**: No migrations or file changes have been executed. This document provides exact codebase findings, proposed database schema SQL, a phased execution plan, and open risks for review and sign-off.

---

## 1. Findings from Recon Tasks

### 1. Current 1:1 Messaging Architecture
- **Tables**: `conversations` (storing `participant_ids` uuid array, `type` e.g. `'friend'`, `'marketplace'`, `'briefcase'`, `'event'`, `'business'`, metadata columns like `item_id`, `business_id`) and `messages` (storing `conversation_id`, `sender_id`, `text`, `media_url`, `media_type`, `created_at`, `is_read`, `deleted_by`).
- **Realtime**: Supabase Realtime listens to `postgres_changes` on `public.conversations` and `public.messages` filtered by `conversation_id` in screens like `yrdly-mobile/src/app/chat/[id].tsx`, `yrdly-mobile/src/app/(tabs)/messages.tsx`, and `yrdly-app/src/components/ConversationScreen.tsx`.
- **Reuse vs. Separate**: 1:1 messaging is tightly coupled to 2-participant private chats (`participant_ids` array, unnest checks for RLS). **Communities MUST stay separate** with dedicated tables (`communities`, `community_memberships`, `community_posts`, `community_comments`) to support feed-style top-level posts, threaded replies, role-based governance, and per-community mute controls without corrupting 1:1 chat queries, triggers, or unread counters.

### 2. Ward & Location Anchoring (`home_ward` / `home_lga` / `lga_wards`)
- **Location Storage**: User location is stored in `public.users` (or `profiles`) as `home_state`, `home_lga`, `home_ward`, `home_lat`, `home_lng`, as well as a JSONB `location` fallback.
- **Reference Table**: `public.lga_wards` (`id`, `state`, `lga`, `ward`, `latitude`, `longitude`) populated via `20260808192200_seed_lga_wards.sql` with unique constraint `(state, lga, ward)`.
- **Auto-Membership Mechanism**:
  - Postgres DB Trigger on `public.users` (`AFTER INSERT OR UPDATE OF home_ward, home_lga, home_state`) to auto-join/transfer users to the ward community matching `(home_state, home_lga, home_ward)` and parent LGA community `(home_state, home_lga)`.
  - When a user changes their `home_ward`, the trigger updates their auto-memberships in `community_memberships` (removes old auto-joined ward membership and adds new ward membership).

### 3. Feed & Posts Structure
- **Current `posts` Table**: Schema includes `id`, `user_id`, `content`, `image_urls`, `video_urls`, `category`, `state`, `lga`, `ward`, `moderation_status`, `is_edited`, `created_at`.
- **Decision on Post Schema**: Community posts need specific community attributes (`community_id`, `is_pinned`, `post_type`, top-level rate limiting, sub-thread replies). Reusing `posts` with nullable `community_id` would complicate existing home feed queries and RLS policies. Therefore, **dedicated `community_posts` and `community_comments` tables** are recommended, following the exact column patterns of `posts` and `comments` for UI component parity.

### 4. ModerationService Integration
- **Locations**:
  - Mobile: `yrdly-mobile/src/lib/moderation-service.ts`
  - Web: `yrdly-app/src/lib/moderation-service.ts`
- **Mechanism**: Both invoke the Supabase Edge Function `moderate-content` via `supabase.functions.invoke('moderate-content', { body: { type: 'text', content } })`.
- **Integration**: `ModerationService.checkText` must be called in mobile and web community post/reply submission flows before DB insertion.

### 5. Notification Pipeline & Community Mute
- **Notification Function**: `create_notification` RPC (defined in `20260908130000_fix_create_notification_security_definer.sql`) creates in-app notification rows.
- **Push Pipeline**: `yrdly-mobile/src/lib/push-notification-service.ts` registers multi-device Expo push tokens (`user_push_tokens` table) and dispatches APNs/FCM pushes.
- **Per-Community Mute**: Add `is_muted` boolean (or `mute_notifications`) column on `community_memberships`. DB triggers or notification handlers MUST check `is_muted = false` for the recipient before triggering push notifications for new community posts or mentions.

### 6. Admin Tooling & Roles
- **Role Model**: `users.is_admin = true` or `users.role = 'admin'` (or JWT `app_metadata.role = 'admin'`).
- **Web Admin Panel**: Located at `yrdly-app/src/app/(app)/admin/` guarded by `admin-guard.ts` and `layout.tsx`.
- **Management**: Admin creation and management of interest/activity communities will plug into new sub-routes in `yrdly-app/src/app/(app)/admin/communities/`.

### 7. RLS Policy Patterns
- **Current Patterns**: RLS policies enforce `auth.uid() = user_id` for writes, and checking membership or participation (`EXISTS (SELECT 1 FROM ... WHERE user_id = auth.uid())`) for reads.
- **Community Policies**:
  - `communities`: Public read for `privacy = 'open'`; member-only read for `privacy IN ('request', 'invite')` (or visible metadata for directory, depending on open risk decisions).
  - `community_memberships`: Selectable by self or community admins/mods.
  - `community_posts` & `community_comments`: SELECT, INSERT, UPDATE, DELETE restricted strictly to active members (`EXISTS (SELECT 1 FROM community_memberships WHERE community_id = ... AND user_id = auth.uid() AND status = 'active')`).

### 8. Navigation & Tab Placement
- **Mobile (`yrdly-mobile`)**:
  - Tab Bar Layout: `yrdly-mobile/src/app/(tabs)/_layout.tsx` contains 5 items: Home, Explore (`catalog.tsx`), Create (+), Messages, Profile.
  - Explore Tab (`catalog.tsx`): Multi-section super-tab (`Discover`, `Marketplace`, `Events`, `Businesses`). Communities can be added as a top-level tab or featured section in `catalog.tsx`, plus a direct route `/communities` or `/communities/[id]`.
- **Web (`yrdly-app`)**:
  - Navigation Layout: `MainLayout.tsx` and `Sidebar.tsx` contain main links (`Home`, `Explore`, `Map`, `Messages`, `Profile`). Communities will be added under `Explore` or as a top-level sidebar item `/communities`.

---

## 2. Proposed Schema (SQL for Review — NOT APPLIED)

```sql
-- =============================================================================
-- COMMUNITIES FEATURE SCHEMA (PROPOSED DRAFT)
-- =============================================================================

-- 1. Communities Table
CREATE TABLE IF NOT EXISTS public.communities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    avatar_url TEXT,
    banner_url TEXT,
    type TEXT NOT NULL CHECK (type IN ('ward', 'lga', 'interest')),
    privacy TEXT NOT NULL DEFAULT 'open' CHECK (privacy IN ('open', 'request', 'invite')),
    state TEXT,
    lga TEXT,
    ward TEXT,
    ward_id UUID REFERENCES public.lga_wards(id) ON DELETE SET NULL,
    parent_community_id UUID REFERENCES public.communities(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    is_official BOOLEAN DEFAULT false,
    rules JSONB DEFAULT '[]'::jsonb,
    post_rate_limit_per_hour INT DEFAULT 5, -- Anti-noise top-level post limit per user
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for location lookup & type filtering
CREATE INDEX IF NOT EXISTS idx_communities_type_location ON public.communities(type, state, lga, ward);
CREATE INDEX IF NOT EXISTS idx_communities_parent ON public.communities(parent_community_id);

-- 2. Community Memberships Table
CREATE TABLE IF NOT EXISTS public.community_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'banned')),
    is_auto_joined BOOLEAN DEFAULT false, -- True for ward auto-memberships
    is_muted BOOLEAN DEFAULT false, -- Per-community notification mute
    muted_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_memberships_user ON public.community_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_memberships_comm ON public.community_memberships(community_id, status);

-- 3. Community Posts Table
CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    author_name TEXT,
    author_image TEXT,
    content TEXT NOT NULL,
    image_urls TEXT[],
    video_urls TEXT[],
    is_pinned BOOLEAN DEFAULT false,
    is_edited BOOLEAN DEFAULT false,
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    moderation_status TEXT DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_posts_feed ON public.community_posts(community_id, moderation_status, created_at DESC);

-- 4. Community Post Likes Table
CREATE TABLE IF NOT EXISTS public.community_post_likes (
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

-- 5. Community Comments (Threaded Replies) Table
CREATE TABLE IF NOT EXISTS public.community_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    author_name TEXT,
    author_image TEXT,
    parent_comment_id UUID REFERENCES public.community_comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    like_count INT DEFAULT 0,
    moderation_status TEXT DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_comments_post ON public.community_comments(post_id, created_at ASC);

-- 6. Row Level Security Policies (Draft)
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

-- Read Communities Policy
CREATE POLICY "Read open or joined communities" ON public.communities
FOR SELECT USING (
    privacy = 'open' OR
    EXISTS (
        SELECT 1 FROM public.community_memberships m
        WHERE m.community_id = id AND m.user_id = auth.uid() AND m.status = 'active'
    )
);

-- Read Posts Policy
CREATE POLICY "Read posts in joined communities" ON public.community_posts
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.community_memberships m
        WHERE m.community_id = community_posts.community_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
);

-- Insert Posts Policy
CREATE POLICY "Insert posts in joined communities" ON public.community_posts
FOR INSERT WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM public.community_memberships m
        WHERE m.community_id = community_posts.community_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
);
```

---

## 3. Phased Implementation Plan

### Phase 1: Database Schema & RLS Setup
- **Tasks**: Create migration file for `communities`, `community_memberships`, `community_posts`, `community_comments`, `community_post_likes`, indexes, and RLS policies. Seed LGA and Ward community entries.
- **Files in Scope**: `yrdly-app/supabase/migrations/20261005000000_create_communities_schema.sql`, `yrdly-mobile/supabase/migrations/20261005000000_create_communities_schema.sql`.
- **Files NOT to Touch**: 1:1 chat tables (`conversations`, `messages`), core `posts` table.

### Phase 2: Backend Triggers, Auto-Join & Services
- **Tasks**: DB triggers for `users` home_ward auto-membership sync, rate-limiting post check RPCs, community fetch service logic.
- **Files in Scope**: `yrdly-mobile/src/lib/community-service.ts`, `yrdly-app/src/lib/community-service.ts`, new migration for triggers.
- **Files NOT to Touch**: `auth-service.ts`, payment webhook handlers.

### Phase 3: Mobile UI (`yrdly-mobile`)
- **Tasks**: Community list screen, Ward Community feed screen, Community Post Detail + Threaded Comments, Create Community Post modal, Community Settings (Mute toggle, Member list).
- **Files in Scope**: `yrdly-mobile/src/app/communities/[id].tsx`, `yrdly-mobile/src/app/communities/index.tsx`, `yrdly-mobile/src/app/(tabs)/catalog.tsx` (adding Communities entry tab).
- **Files NOT to Touch**: `yrdly-mobile/src/app/chat/[id].tsx`, `yrdly-mobile/src/app/(tabs)/messages.tsx`.

### Phase 4: Web Parity (`yrdly-app`)
- **Tasks**: Responsive Web Community layout, Community feed page, Threaded reply view, Mute & member management dialogs.
- **Files in Scope**: `yrdly-app/src/app/(app)/communities/page.tsx`, `yrdly-app/src/app/(app)/communities/[id]/page.tsx`, `yrdly-app/src/components/layout/Sidebar.tsx` (add Communities nav item).
- **Files NOT to Touch**: `yrdly-app/src/components/ConversationScreen.tsx`, `yrdly-app/src/components/MessagesScreen.tsx`.

### Phase 5: Moderation & Notifications
- **Tasks**: Integrate `ModerationService.checkText` into community post/reply submission flows, support per-community mute filtering in push notifications, report community content.
- **Files in Scope**: `yrdly-mobile/src/lib/notification-service.ts`, `yrdly-app/src/lib/notification-service.ts`, `yrdly-mobile/src/lib/moderation-service.ts`.
- **Files NOT to Touch**: `20260908130000_fix_create_notification_security_definer.sql` (core RPC unchanged, wrap check in application logic or trigger).

### Phase 6: Admin Tooling
- **Tasks**: Admin UI for creating/editing interest groups, assigning moderators, reviewing flagged community content.
- **Files in Scope**: `yrdly-app/src/app/(app)/admin/communities/page.tsx`, `yrdly-app/src/app/(app)/admin/communities/create/page.tsx`.
- **Files NOT to Touch**: Non-admin routes.

---

## 4. Product Decisions (Resolved)

| # | Question | Decision |
|---|----------|----------|
| 1 | **Cold Start / Empty Ward Communities** | Show a styled "Be the first to post here" welcome card in the feed when `community_posts.count = 0`. No LGA aggregation on first render — keeps ward identity clean and avoids noise from unrelated LGA posts. |
| 2 | **Sparse Wards** | No automatic cross-posting to LGA. Instead: a "More from [LGA]" section appears at the bottom of a ward feed when the ward has fewer than 5 posts in the last 7 days. LGA posts are shown read-only in this section; replies/likes target the original LGA community post. |
| 3 | **Rumor & Safety / Misinformation Risk** | All community top-level posts from non-verified users (phone_verified = false) go to moderation queue (`moderation_status = 'pending'`) and are hidden until approved. Phone-verified users get direct post (`approved`). Moderators always bypass. Posts containing safety-adjacent keywords (enforced in `moderate-content` Edge Function) trigger an auto-queue regardless of verification. |
| 4 | **Rate Limiting** | Ward and LGA communities: **5 top-level posts per user per 24 hours** (enforced via `post_rate_limit_per_hour = 0` sentinel + separate `community_post_daily_limit = 5` column, checked by a Postgres function before INSERT). Replies are unlimited. Interest/activity groups: no hard limit, moderation queue throttles quality. |
| 5 | **Private Group Directory Visibility** | `request`-to-join groups: visible in search with name, description, member count, and a "Request to Join" button. Members/posts are hidden. `invite`-only groups: **completely invisible** in all search and directory queries for non-members. RLS enforces this at the DB layer. |

### Schema Amendments from Decisions

```sql
-- (applied to the Phase 1 migration, not yet executed)

-- Replace post_rate_limit_per_hour with a per-day limit column
ALTER TABLE public.communities
  DROP COLUMN IF EXISTS post_rate_limit_per_hour,
  ADD COLUMN IF NOT EXISTS post_daily_limit INT DEFAULT 5;

-- Rate limit enforcement function (called before INSERT on community_posts)
CREATE OR REPLACE FUNCTION public.check_community_post_rate_limit(
  p_community_id UUID,
  p_author_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_daily_limit INT;
  v_today_count INT;
BEGIN
  SELECT post_daily_limit INTO v_daily_limit
  FROM public.communities WHERE id = p_community_id;

  IF v_daily_limit IS NULL OR v_daily_limit = 0 THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_today_count
  FROM public.community_posts
  WHERE community_id = p_community_id
    AND author_id = p_author_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_today_count >= v_daily_limit THEN
    RAISE EXCEPTION 'Post limit reached for this community (% per 24h).', v_daily_limit;
  END IF;
END;
$$;

-- RLS: invite-only communities completely invisible to non-members
-- (replaces the generic read policy in the original schema block)
DROP POLICY IF EXISTS "Read open or joined communities" ON public.communities;
CREATE POLICY "Read communities" ON public.communities
FOR SELECT USING (
  -- open: always visible
  privacy = 'open'
  OR
  -- request: name/description visible but posts hidden via community_posts RLS
  privacy = 'request'
  OR
  -- invite: only members can see anything
  (privacy = 'invite' AND EXISTS (
    SELECT 1 FROM public.community_memberships m
    WHERE m.community_id = id AND m.user_id = auth.uid() AND m.status = 'active'
  ))
);

-- community_posts hidden for request communities to non-members (already covered by existing posts RLS)
```
