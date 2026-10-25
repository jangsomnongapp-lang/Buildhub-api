-- More realtime events (see 003_realtime.sql and src/realtime.ts), matching the web's other Supabase channels:
-- - project page (web: projects.$projectId.tsx + ChatProjectPanel): projects changes, new project_messages /
--   project_logs → {type:"project", project_id} to the project's owner and worker.
-- - Home feed (web: home.tsx) and Find work (web: listings.index.tsx) refetched on any change to their public
--   tables → {type:"feed"|"stories"|"listings"} to every connected user. These carry no ids or content at all,
--   only "something changed", so nothing private can leak (the web's channels sent whole rows, filtered by RLS).

CREATE OR REPLACE FUNCTION api.notify_project_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid;
  p record;
BEGIN
  -- Separate branches: NEW.project_id doesn't exist on a projects row.
  IF TG_TABLE_NAME = 'projects' THEN
    pid := NEW.id;
  ELSE
    pid := NEW.project_id;
  END IF;
  SELECT owner_id, worker_id INTO p FROM public.projects WHERE id = pid;
  IF p IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_notify('bh_events', json_build_object(
    'type', 'project',
    'project_id', pid,
    'users', json_build_array(p.owner_id, p.worker_id)
  )::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bh_realtime_projects ON public.projects;
CREATE TRIGGER bh_realtime_projects
  AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION api.notify_project_event();

DROP TRIGGER IF EXISTS bh_realtime_project_messages ON public.project_messages;
CREATE TRIGGER bh_realtime_project_messages
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION api.notify_project_event();

DROP TRIGGER IF EXISTS bh_realtime_project_logs ON public.project_logs;
CREATE TRIGGER bh_realtime_project_logs
  AFTER INSERT ON public.project_logs
  FOR EACH ROW EXECUTE FUNCTION api.notify_project_event();

DROP TRIGGER IF EXISTS bh_realtime_project_ratings ON public.project_ratings;
CREATE TRIGGER bh_realtime_project_ratings
  AFTER INSERT ON public.project_ratings
  FOR EACH ROW EXECUTE FUNCTION api.notify_project_event();

-- Statement-level: one event per statement, whatever the number of rows. TG_ARGV[0] is the event type.
CREATE OR REPLACE FUNCTION api.notify_public_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('bh_events', json_build_object('type', TG_ARGV[0], 'all', true)::text);
  RETURN NULL;
END $$;

DO $$
DECLARE
  t text[];
BEGIN
  FOREACH t SLICE 1 IN ARRAY ARRAY[
    ['posts', 'feed'], ['rental_listings', 'feed'], ['post_likes', 'feed'], ['post_comments', 'feed'],
    ['rental_likes', 'feed'], ['rental_comments', 'feed'], ['stories', 'stories'],
    ['listings', 'listings'], ['applications', 'listings']
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bh_realtime_%1$s ON public.%1$I', t[1]);
    EXECUTE format(
      'CREATE TRIGGER bh_realtime_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH STATEMENT EXECUTE FUNCTION api.notify_public_change(%2$L)',
      t[1], t[2]);
  END LOOP;
END $$;
