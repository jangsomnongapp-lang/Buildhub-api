-- "Delete chat" from the app's inbox (swipe left, user approved 2026-10-18). Not on the web app.
-- Messages are write-once (messages_immutable) and belong to both people, so nothing is deleted:
-- the chat is hidden for this user only, until a newer message arrives (like WhatsApp's "Delete chat").
CREATE TABLE IF NOT EXISTS public.message_thread_hides (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

ALTER TABLE public.message_thread_hides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own hidden chats" ON public.message_thread_hides;
CREATE POLICY "users manage own hidden chats" ON public.message_thread_hides
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = thread_id AND auth.uid() IN (t.participant_a, t.participant_b)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_thread_hides TO authenticated;
