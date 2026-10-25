-- Fixes the user approved on 2026-10-14 (questions 0a–0d in CLAUDE.md). All were broken on the live site too.
-- 0e (admin weekly/monthly draws) was a screen bug, fixed in buildhub-app/src/app/(app)/admin/draws.tsx.

-- 0a: job owners can reopen a closed job. guard_listing_fields only let owners move a job to finished/closed,
-- so the Reopen button (profile → My jobs) silently did nothing. Now closed → active is allowed too.
-- Finished jobs stay finished (they belong to a completed project).
CREATE OR REPLACE FUNCTION public.guard_listing_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_admin(auth.uid()) then return new; end if;
  new.user_id := old.user_id;
  -- owners may move status forward to finished/closed, or reopen a closed job; everything else reverts
  if new.status is distinct from old.status then
    if not (auth.uid() = old.user_id and (new.status in ('finished','closed') or (old.status = 'closed' and new.status = 'active'))) then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$function$;

-- 0b: several daily photo times on a project. The form sends them comma-joined ("morning,endofday"), but the
-- check only allowed one value, so picking two failed. Now any comma list of the three times is allowed.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_photo_frequency_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_photo_frequency_check
  CHECK (photo_frequency ~ '^(morning|midday|endofday)(,(morning|midday|endofday)){0,2}$');

-- 0c: everyone can read people's specialties (they are shown on profiles and used by Find worker's filter).
-- Writing stays own-rows-only ("users manage own categories").
DROP POLICY IF EXISTS "anyone reads specialties" ON public.user_categories;
CREATE POLICY "anyone reads specialties" ON public.user_categories
  FOR SELECT TO anon, authenticated USING (true);

-- 0d: start_material_chat failed with 'column reference "thread_id" is ambiguous' (a variable had the same
-- name as the messages column), so "chat with supplier" on My searches and "I have it — contact" on Online
-- orders errored. Same function with the variable renamed.
CREATE OR REPLACE FUNCTION public.start_material_chat(_request_id uuid, _supplier_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  req record;
  a uuid;
  b uuid;
  _thread_id uuid;
  context_text text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO req FROM public.material_requests WHERE id = _request_id;
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;

  -- Caller must be either the request owner or the named supplier
  IF caller <> req.user_id AND caller <> _supplier_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  -- And the supplier must have actually responded available
  IF NOT EXISTS (
    SELECT 1 FROM public.material_request_responses
    WHERE request_id = _request_id AND supplier_id = _supplier_id AND response = 'available'
  ) THEN
    RAISE EXCEPTION 'Supplier has not confirmed availability';
  END IF;

  IF req.user_id < _supplier_id THEN
    a := req.user_id; b := _supplier_id;
  ELSE
    a := _supplier_id; b := req.user_id;
  END IF;

  SELECT id INTO _thread_id FROM public.message_threads
  WHERE participant_a = a AND participant_b = b LIMIT 1;

  IF _thread_id IS NULL THEN
    INSERT INTO public.message_threads (participant_a, participant_b)
    VALUES (a, b) RETURNING id INTO _thread_id;
  END IF;

  context_text := '[material_request] ' || req.category || ' · ' || req.quantity || ' units'
                  || COALESCE(' · ' || req.note, '');

  -- Only insert context once per thread+request
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.thread_id = _thread_id
      AND m.content = context_text
  ) THEN
    INSERT INTO public.messages (thread_id, sender_id, content)
    VALUES (_thread_id, caller, context_text);
  END IF;

  RETURN _thread_id;
END; $function$;
