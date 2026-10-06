-- Retire user-created group chats without deleting their conversation history.

DROP FUNCTION IF EXISTS public.create_group_conversation(text, text, uuid[]);
DROP FUNCTION IF EXISTS public.join_group_via_invite_code(text);

-- Replace every write policy so permissive legacy policies cannot continue
-- allowing group writes through PostgreSQL's OR-combined policies.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('conversations', 'messages')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;

CREATE POLICY "Users can create non-group conversations"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND type IS DISTINCT FROM 'group'
  );

CREATE POLICY "Participants can update non-group conversations"
  ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = ANY (participant_ids)
    AND type IS DISTINCT FROM 'group'
  )
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND type IS DISTINCT FROM 'group'
  );

CREATE POLICY "Participants can delete non-group conversations"
  ON public.conversations
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = ANY (participant_ids)
    AND type IS DISTINCT FROM 'group'
  );

CREATE POLICY "Participants can send direct messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_messages_participant(conversation_id)
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.type IS DISTINCT FROM 'group'
    )
  );

CREATE POLICY "Participants can update direct messages"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (
    public.is_messages_participant(conversation_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.type IS DISTINCT FROM 'group'
    )
  )
  WITH CHECK (
    public.is_messages_participant(conversation_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.type IS DISTINCT FROM 'group'
    )
  );

CREATE POLICY "Users can delete their own direct messages"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.type IS DISTINCT FROM 'group'
    )
  );
