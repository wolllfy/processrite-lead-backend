create table if not exists lead_submissions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  business_name text,
  phone text not null,
  email text not null,
  business_type text not null,
  monthly_processing_volume text not null,
  current_processor text,
  message text,
  page_source text,
  user_agent text,
  ip_hash text,
  email_alert_sent boolean not null default false
);

create index if not exists lead_submissions_created_at_idx on lead_submissions (created_at desc);
create index if not exists lead_submissions_email_idx on lead_submissions (lower(email));
