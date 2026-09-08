-- Migration: Non-Financial Hardening - Messaging Conversation Restoration & Historical Comment Count Sync

-- 1. Trigger to automatically sync conversation metadata and un-hide (restore) conversation on new message insertion
CREATE OR REPLACE FUNCTION tr_on_message_inserted()
RETURNS trigger AS $$
BEGIN
  -- Automatically update conversations last_message metadata and CLEAR deleted_by array
  UPDATE public.conversations
  SET 
    last_message_text = COALESCE(NEW.text, CASE WHEN NEW.media_type = 'video' THEN '🎬 Video' WHEN NEW.media_type = 'image' THEN '📷 Photo' ELSE '' END),
    last_message_timestamp = NEW.created_at,
    last_message_sender_id = NEW.sender_id,
    deleted_by = ARRAY[]::UUID[],
    updated_at = NOW()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_on_message_inserted ON public.messages;
CREATE TRIGGER tr_on_message_inserted
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION tr_on_message_inserted();

-- 2. One-time historical data synchronization for post comment counts
UPDATE public.posts p
SET comment_count = (
  SELECT COUNT(*)
  FROM public.comments c
  WHERE c.post_id = p.id
);

-- 3. Cleanup orphaned notifications referencing deleted posts or events
DELETE FROM public.notifications
WHERE type IN ('post_like', 'post_comment', 'post_share')
  AND (related_id IS NOT NULL AND related_id NOT IN (SELECT id FROM public.posts));

DELETE FROM public.notifications
WHERE type IN ('event_invite', 'event_reminder', 'event_cancelled', 'event_updated')
  AND (related_id IS NOT NULL AND related_id NOT IN (SELECT id FROM public.events) AND related_id NOT IN (SELECT id FROM public.posts WHERE category = 'Event'));
