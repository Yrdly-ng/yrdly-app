-- =============================================================================
-- Group Chats Feature — Migration 20261003020000
-- Extends conversations table for user-created Group Chats
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_ids TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_invite_link_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_type_check 
  CHECK (type = ANY (ARRAY['friend'::text, 'marketplace'::text, 'business'::text, 'briefcase'::text, 'event'::text, 'group'::text]));

CREATE INDEX IF NOT EXISTS idx_conversations_type ON public.conversations(type);
CREATE INDEX IF NOT EXISTS idx_conversations_invite_code ON public.conversations(invite_code) WHERE invite_code IS NOT NULL;

-- Helper RPC: Create Group Conversation
CREATE OR REPLACE FUNCTION public.create_group_conversation(
  p_title           TEXT,
  p_avatar_url      TEXT DEFAULT NULL,
  p_participant_ids UUID[] DEFAULT '{}'::uuid[]
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conv_id UUID;
  v_code    TEXT;
  v_all_pts UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to create a group chat.';
  END IF;

  v_all_pts := ARRAY(SELECT DISTINCT unnest(array_append(p_participant_ids, v_user_id)));
  v_code    := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.conversations (
    type,
    title,
    avatar_url,
    created_by,
    admin_ids,
    participant_ids,
    invite_code,
    created_at,
    updated_at
  ) VALUES (
    'group',
    p_title,
    p_avatar_url,
    v_user_id,
    ARRAY[v_user_id],
    v_all_pts,
    v_code,
    NOW(),
    NOW()
  ) RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- Helper RPC: Join Group Via Invite Code
CREATE OR REPLACE FUNCTION public.join_group_via_invite_code(
  p_invite_code TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conv    RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to join a group chat.';
  END IF;

  SELECT * INTO v_conv FROM public.conversations
  WHERE invite_code = lower(p_invite_code) AND is_invite_link_active = true AND type = 'group';

  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired group invite link.';
  END IF;

  IF NOT (v_user_id = ANY(v_conv.participant_ids)) THEN
    UPDATE public.conversations
    SET participant_ids = array_append(participant_ids, v_user_id),
        updated_at = NOW()
    WHERE id = v_conv.id;
  END IF;

  RETURN v_conv.id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_group_conversation(TEXT, TEXT, TEXT[]);
GRANT EXECUTE ON FUNCTION public.create_group_conversation(TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_via_invite_code(TEXT) TO authenticated;
