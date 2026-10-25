-- Stand-ins for Supabase extensions that the restored functions and triggers call.
-- Applied by scripts/restore-dump.mjs after the dump.

-- pg_net: Supabase sends HTTP straight from SQL (Telegram alerts, push webhooks).
-- Here the request is only queued. The API's worker decides what to send,
-- so a local database never calls production services.
CREATE SCHEMA IF NOT EXISTS net;

CREATE TABLE IF NOT EXISTS net.http_request_queue (
  id bigserial PRIMARY KEY,
  method text NOT NULL,
  url text NOT NULL,
  headers jsonb,
  body jsonb,
  params jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.http_request_queue (method, url, headers, body, params)
  VALUES ('POST', url, headers, body, params)
  RETURNING id;
$$;

CREATE OR REPLACE FUNCTION net.http_get(
  url text,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.http_request_queue (method, url, headers, params)
  VALUES ('GET', url, headers, params)
  RETURNING id;
$$;

-- supabase_vault: functions read secrets from vault.decrypted_secrets.
-- Empty by default, so those functions skip their webhook calls.
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.local_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT name, secret AS decrypted_secret FROM vault.local_secrets;
