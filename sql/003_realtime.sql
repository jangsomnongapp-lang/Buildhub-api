-- Realtime events for the API's WebSocket (replaces Supabase realtime's postgres_changes).
-- Triggers send a small JSON payload on the `bh_events` channel; the API (src/realtime.ts) LISTENs and
-- forwards each event only to the users named in it. Payloads carry ids only, never message content
-- (attachments can be large data: URLs and pg_notify payloads are limited to 8000 bytes).

CREATE OR REPLACE FUNCTION api.notify_message_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record;
BEGIN
  SELECT participant_a, participant_b INTO t FROM public.message_threads WHERE id = NEW.thread_id;
  IF t IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_notify('bh_events', json_build_object(
    'type', CASE WHEN TG_OP = 'INSERT' THEN 'message' ELSE 'message_update' END,
    'thread_id', NEW.thread_id,
    'message_id', NEW.id,
    'sender_id', NEW.sender_id,
    'users', json_build_array(t.participant_a, t.participant_b)
  )::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bh_realtime_messages ON public.messages;
CREATE TRIGGER bh_realtime_messages
  AFTER INSERT OR UPDATE OF read_at, content ON public.messages
  FOR EACH ROW EXECUTE FUNCTION api.notify_message_event();

CREATE OR REPLACE FUNCTION api.notify_notification_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('bh_events', json_build_object(
    'type', 'notification',
    'users', json_build_array(NEW.user_id)
  )::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bh_realtime_notifications ON public.notifications;
CREATE TRIGGER bh_realtime_notifications
  AFTER INSERT OR UPDATE OF read_at ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION api.notify_notification_event();
