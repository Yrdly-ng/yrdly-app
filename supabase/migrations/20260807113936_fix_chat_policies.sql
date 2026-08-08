-- Drop the overly restrictive UPDATE policy
DROP POLICY IF EXISTS "Users can update their own messages within 15 minutes" ON messages;

-- Create a permissive UPDATE policy for participants
CREATE POLICY "Participants can update messages"
ON messages
FOR UPDATE
USING (
  auth.uid() IN (SELECT unnest(participant_ids) FROM conversations WHERE id = messages.conversation_id)
)
WITH CHECK (
  auth.uid() IN (SELECT unnest(participant_ids) FROM conversations WHERE id = messages.conversation_id)
);

-- Use a trigger to enforce the 15-minute rule for text/media edits
CREATE OR REPLACE FUNCTION check_message_update_rules()
RETURNS trigger AS $$
BEGIN
  -- Check if text or media content is being modified
  IF NEW.text IS DISTINCT FROM OLD.text OR 
     NEW.content IS DISTINCT FROM OLD.content OR
     NEW.media_url IS DISTINCT FROM OLD.media_url OR
     NEW.image_url IS DISTINCT FROM OLD.image_url OR
     NEW.video_url IS DISTINCT FROM OLD.video_url THEN
     
    -- Only the sender can modify the content
    IF auth.uid() != OLD.sender_id THEN
      RAISE EXCEPTION 'Only the sender can edit or delete this message.';
    END IF;
    
    -- Must be within 15 minutes
    IF (now() - OLD.created_at) > interval '15 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within 15 minutes of sending.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_message_update_rules ON messages;
CREATE TRIGGER tr_check_message_update_rules
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION check_message_update_rules();
