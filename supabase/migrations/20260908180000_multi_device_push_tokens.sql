-- Migration: Multi-Device Push Tokens Table
-- Created: 2026-09-08
-- Description: Replaces single push_token column on users table with a dedicated
-- user_push_tokens table supporting multiple registered devices per user.
--
-- IMPORTANT DEPLOYMENT WARNING:
-- Do NOT apply this migration to production until the application code updates
-- (in yrdly-mobile and yrdly-app send-push-notification edge function) are ready
-- to deploy simultaneously. Dropping users.push_token will immediately break
-- push notification queries in the live code if deployed prematurely.
--
-- ARCHITECTURAL DECISIONS & ACCEPTED LIMITATIONS:
-- 1. Device Identification:
--    device_id is a client-generated UUID persisted in AsyncStorage / secure storage
--    per app installation, rather than relying solely on hardware vendor IDs (e.g.
--    iOS identifierForVendor or Android ID) which can be null, restricted, or reset
--    across app reinstalls.
-- 2. Multi-Account / Single Device Behavior:
--    If two distinct user accounts are logged into on the same physical device without
--    performing a formal sign-out between sessions, both user accounts may retain
--    a push token associated with that device installation. This is mitigated by
--    explicit token deletion on sign-out, which is the accepted industry design pattern.

-- Step 1: Create user_push_tokens table
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  push_token text NOT NULL,
  device_name text,
  os_name text,
  os_version text,
  app_version text,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_device_unique UNIQUE (user_id, device_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON public.user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_token ON public.user_push_tokens(push_token);

-- Step 2: Enable Row Level Security (RLS) & Define User Access Policies
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

-- Note on Service Role:
-- The send-push-notification edge function uses SUPABASE_SERVICE_ROLE_KEY which
-- automatically bypasses RLS. Therefore, no explicit service_role policy is needed.

CREATE POLICY "Users can view their own push tokens"
  ON public.user_push_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own push tokens"
  ON public.user_push_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own push tokens"
  ON public.user_push_tokens FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own push tokens"
  ON public.user_push_tokens FOR DELETE
  USING (user_id = auth.uid());

-- Step 3: Backfill legacy push tokens from users table
INSERT INTO public.user_push_tokens (user_id, device_id, push_token)
SELECT id, 'legacy-migrated-device', push_token
FROM public.users
WHERE push_token IS NOT NULL
ON CONFLICT (user_id, device_id) DO NOTHING;

-- Step 4: Drop legacy single-token column from users table
ALTER TABLE public.users DROP COLUMN IF EXISTS push_token;
