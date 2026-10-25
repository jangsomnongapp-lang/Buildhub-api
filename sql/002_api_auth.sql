-- Private schema for our own API (not visible to anon/authenticated).
CREATE SCHEMA IF NOT EXISTS api;
REVOKE ALL ON SCHEMA api FROM PUBLIC;

-- Refresh tokens issued by our API (replaces Supabase's auth.refresh_tokens).
-- Only the SHA-256 hash is stored; the token itself is never saved.
CREATE TABLE IF NOT EXISTS api.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON api.refresh_tokens (user_id);
