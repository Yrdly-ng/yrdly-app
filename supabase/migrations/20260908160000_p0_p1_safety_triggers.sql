-- Migration: Fix Marketplace Purchase Atomicity, Comment Count Atomicity, and Blocked User Messaging Safeguards

-- 1. Create partial unique index on escrow_transactions to prevent concurrent duplicate pending/paid purchases for single post items
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_transactions_single_active_post
ON public.escrow_transactions (item_id)
WHERE item_type = 'post' AND status IN ('pending', 'paid', 'funds_held', 'disputed');

-- 2. Trigger to automatically and atomically maintain comment_count on posts
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.posts
    SET comment_count = COALESCE(comment_count, 0) + 1,
        updated_at = NOW()
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.posts
    SET comment_count = GREATEST(COALESCE(comment_count, 1) - 1, 0),
        updated_at = NOW()
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_update_post_comment_count ON public.comments;
CREATE TRIGGER tr_update_post_comment_count
AFTER INSERT OR DELETE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION update_post_comment_count();

-- 3. Trigger to prevent blocked users from inserting messages into conversations
CREATE OR REPLACE FUNCTION check_message_blocked_user()
RETURNS trigger AS $$
DECLARE
  v_recipient_id UUID;
  v_blocked UUID[];
BEGIN
  SELECT pid INTO v_recipient_id
  FROM conversations, unnest(participant_ids) AS pid
  WHERE id = NEW.conversation_id AND pid != NEW.sender_id
  LIMIT 1;

  IF v_recipient_id IS NOT NULL THEN
    SELECT blocked_users INTO v_blocked
    FROM public.users
    WHERE id = v_recipient_id;

    IF v_blocked IS NOT NULL AND NEW.sender_id = ANY(v_blocked) THEN
      RAISE EXCEPTION 'You cannot send messages to a user who has blocked you.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_message_blocked_user ON public.messages;
CREATE TRIGGER tr_check_message_blocked_user
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION check_message_blocked_user();
