CREATE TABLE IF NOT EXISTS crm_users (
 id bigserial PRIMARY KEY,
 username text NOT NULL UNIQUE CHECK (username=lower(username)),
 email text NOT NULL,
 display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','manager','sales','viewer')),
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','disabled')),
 password_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS crm_sessions (
 token_hash text PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES crm_users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_sessions_user_idx ON crm_sessions(user_id);
CREATE TABLE IF NOT EXISTS crm_account_tokens (
 token_hash text PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES crm_users(id),
 purpose text NOT NULL CHECK(purpose IN ('invite','reset')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_account_tokens_user_idx ON crm_account_tokens(user_id);
CREATE TABLE IF NOT EXISTS crm_access_events (
 id bigserial PRIMARY KEY,
 actor_id bigint REFERENCES crm_users(id),
 target_id bigint REFERENCES crm_users(id),
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
