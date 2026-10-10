ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS submission_fingerprint text;
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS lead_idempotency_key_idx ON lead_submissions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_fingerprint_created_idx ON lead_submissions(submission_fingerprint,created_at DESC);
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS next_action text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS follow_up_at timestamptz;
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS first_contacted_at timestamptz;
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS score_value integer NOT NULL DEFAULT 0;
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS score_version text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS score_reason text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS landing_page text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS utm_source text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS utm_medium text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS utm_campaign text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS utm_content text NOT NULL DEFAULT '';
ALTER TABLE lead_submissions ADD COLUMN IF NOT EXISTS utm_term text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS lead_due_idx ON lead_submissions(follow_up_at) WHERE archived=false;
CREATE TABLE IF NOT EXISTS lead_notifications (
  id bigserial PRIMARY KEY, lead_id bigint NOT NULL UNIQUE REFERENCES lead_submissions(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz, claim_token text, last_error text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_due_idx ON lead_notifications(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS lead_appointments (
  id bigserial PRIMARY KEY, lead_id bigint NOT NULL REFERENCES lead_submissions(id),
  starts_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Scheduled','Completed','Cancelled','No Show')),
  notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lead_stage_events (
  id bigserial PRIMARY KEY, lead_id bigint NOT NULL REFERENCES lead_submissions(id),
  from_stage text, to_stage text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
-- Existing dates are intentionally not blindly cast; an explicit local review script handles them.
