create table if not exists lead_submissions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  business_name text,
  phone text not null,
  email text not null,
  business_type text not null,
  monthly_processing_volume text not null,
  monthly_volume text default '',
  average_ticket text default '',
  current_processor text,
  interested_products text default '',
  pain_points text default '',
  call_type text default '',
  lead_source text default '',
  source_url text default '',
  message text,
  status text default 'New',
  priority text default 'Medium',
  summary text default '',
  notes text default '',
  ai_summary text default '',
  ai_score text default '',
  transcript text default '',
  recording_url text default '',
  call_duration text default '',
  call_date text default '',
  sms_consent boolean not null default false,
  sms_consent_method text default '',
  sms_consent_timestamp text default '',
  assigned_to text default '',
  follow_up_date text default '',
  last_contacted_at text default '',
  lead_score text default '',
  archived boolean not null default false,
  page_source text,
  user_agent text,
  ip_hash text,
  email_alert_sent boolean not null default false
);

create index if not exists lead_submissions_created_at_idx on lead_submissions (created_at desc);
create index if not exists lead_submissions_email_idx on lead_submissions (lower(email));
create index if not exists lead_submissions_status_idx on lead_submissions (status);
create index if not exists lead_submissions_priority_idx on lead_submissions (priority);
create index if not exists lead_submissions_lead_source_idx on lead_submissions (lead_source);
create index if not exists lead_submissions_archived_idx on lead_submissions (archived);
