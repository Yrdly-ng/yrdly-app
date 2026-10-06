-- =============================================================================
-- Fix: Messages RLS + Conversation Deduplication
-- Ensures recipients can read messages and prevents duplicate friend conversations
-- =============================================================================

-- ── 1. Fix messages table RLS ──────────────────────────────────────────────
-- Drop all existing SELECT policies on messages to start clean
DROP POLICY IF EXISTS "Users can read their own messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
DROP POLICY IF EXISTS "sender can read messages" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;

-- Helper function: check if current user is a participant of the conversation
CREATE OR REPLACE FUNCTION public.is_messages_participant(conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = conv_id
      AND auth.uid() = ANY(participant_ids)
  );
$$;

-- Allow any participant in the conversation to SELECT messages
CREATE POLICY "Participants can read messages"
ON public.messages
FOR SELECT
TO authenticated
USING (
  public.is_messages_participant(conversation_id)
);

-- Allow any participant in the conversation to INSERT messages
DROP POLICY IF EXISTS "Users can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can insert messages" ON public.messages;
CREATE POLICY "Participants can insert messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_messages_participant(conversation_id)
);

-- ── 2. Fix conversations SELECT policy ────────────────────────────────────
-- Ensure the logged-in user can always see conversations they are part of
DROP POLICY IF EXISTS "Users can read their conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can read conversations" ON public.conversations;
CREATE POLICY "Participants can read conversations"
ON public.conversations
FOR SELECT
TO authenticated
USING (
  auth.uid() = ANY(participant_ids)
);

-- ── 3. Deduplicate friend conversations ───────────────────────────────────
-- Merge duplicate friend conversations: keep the oldest one per unique user pair
-- and reassign messages from duplicates to the canonical row.
DO $$
DECLARE
  dup RECORD;
  canonical_id uuid;
  dup_ids uuid[];
BEGIN
  FOR dup IN
    SELECT
      LEAST(participant_ids[1], participant_ids[2]) AS uid_a,
      GREATEST(participant_ids[1], participant_ids[2]) AS uid_b,
      array_agg(id ORDER BY created_at ASC) AS conv_ids
    FROM public.conversations
    WHERE type = 'friend'
      AND array_length(participant_ids, 1) = 2
    GROUP BY uid_a, uid_b
    HAVING COUNT(*) > 1
  LOOP
    canonical_id := dup.conv_ids[1];
    dup_ids      := dup.conv_ids[2:];

    -- Reassign messages from duplicates to the canonical conversation
    UPDATE public.messages
       SET conversation_id = canonical_id
     WHERE conversation_id = ANY(dup_ids);

    -- Delete duplicate conversation rows
    DELETE FROM public.conversations WHERE id = ANY(dup_ids);
  END LOOP;
END;
$$;
