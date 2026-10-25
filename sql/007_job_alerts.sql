-- Job alerts (user approved 2026-10-25). Not on the web app.
-- When an admin approves a job (listings.status pending → active), every worker whose skills
-- (user_categories) match one of the job's skills (listing_categories) and who picked the job's
-- province gets a "new_listing" alert (+ push via push_on_new_notification).
-- User choices: alerts are on by default, but only reach the provinces the worker picked
-- (no row / empty provinces = no alerts).
CREATE TABLE IF NOT EXISTS public.job_alert_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  provinces text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_alert_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own job alerts" ON public.job_alert_settings;
CREATE POLICY "users manage own job alerts" ON public.job_alert_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_alert_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_job_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _poster text;
BEGIN
  -- Only the first approval. A reopened (closed → active) job doesn't alert again.
  IF NEW.status <> 'active' OR OLD.status <> 'pending' THEN RETURN NEW; END IF;
  BEGIN
    SELECT full_name INTO _poster FROM public.profiles WHERE id = NEW.user_id;
    INSERT INTO public.notifications (user_id, kind, title, body, related_user_id, related_listing_id)
    SELECT m.user_id, 'new_listing',
           CASE WHEN p.language = 'en'
                THEN COALESCE(_poster, 'Someone') || ' posted a new listing'
                ELSE COALESCE(_poster, 'Someone') || ' បានបង្ហោះការផ្សាយថ្មី' END,
           NEW.title || COALESCE(' · ' || NULLIF(NEW.location, ''), ''),
           NEW.user_id, NEW.id
    FROM (
      SELECT DISTINCT uc.user_id
      FROM public.listing_categories lc
      JOIN public.user_categories uc ON uc.category_id = lc.category_id
      WHERE lc.listing_id = NEW.id
    ) m
    JOIN public.job_alert_settings s ON s.user_id = m.user_id
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id <> NEW.user_id
      AND s.enabled
      AND NEW.location = ANY (s.provinces)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = m.user_id AND n.kind = 'new_listing' AND n.related_listing_id = NEW.id
      );
  EXCEPTION WHEN OTHERS THEN
    -- Never block the approval because of alerts.
    RAISE WARNING 'tg_job_alerts failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_job_alerts ON public.listings;
CREATE TRIGGER trg_job_alerts
  AFTER UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_alerts();

-- Push data now carries the job id, so tapping a job alert on the phone opens the job itself.
CREATE OR REPLACE FUNCTION public.push_on_new_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.kind = 'message' THEN RETURN NEW; END IF;

    INSERT INTO public.push_notification_queue (device_token, platform, title, body, data, status)
    SELECT token, platform, COALESCE(NEW.title, 'BuildHub'), COALESCE(NEW.body, ''),
           jsonb_strip_nulls(jsonb_build_object('kind', COALESCE(NEW.kind, ''), 'notification_id', NEW.id::text,
                                                'listing_id', NEW.related_listing_id::text)),
           'pending'
    FROM public.device_tokens
    WHERE user_id = NEW.user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_new_notification failed: %', SQLERRM;
  END;
  RETURN NEW;
END; $function$;
