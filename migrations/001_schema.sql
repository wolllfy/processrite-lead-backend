
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

    alter table lead_submissions add column if not exists status text default 'New';
    alter table lead_submissions add column if not exists updated_at timestamptz not null default now();
    alter table lead_submissions add column if not exists monthly_volume text default '';
    alter table lead_submissions add column if not exists average_ticket text default '';
    alter table lead_submissions add column if not exists interested_products text default '';
    alter table lead_submissions add column if not exists pain_points text default '';
    alter table lead_submissions add column if not exists call_type text default '';
    alter table lead_submissions add column if not exists lead_source text default '';
    alter table lead_submissions add column if not exists source_url text default '';
    alter table lead_submissions add column if not exists priority text default 'Medium';
    alter table lead_submissions add column if not exists summary text default '';
    alter table lead_submissions add column if not exists notes text default '';
    alter table lead_submissions add column if not exists ai_summary text default '';
    alter table lead_submissions add column if not exists ai_score text default '';
    alter table lead_submissions add column if not exists transcript text default '';
    alter table lead_submissions add column if not exists recording_url text default '';
    alter table lead_submissions add column if not exists call_duration text default '';
    alter table lead_submissions add column if not exists call_date text default '';
    alter table lead_submissions add column if not exists sms_consent boolean not null default false;
    alter table lead_submissions add column if not exists sms_consent_method text default '';
    alter table lead_submissions add column if not exists sms_consent_timestamp text default '';
    alter table lead_submissions add column if not exists assigned_to text default '';
    alter table lead_submissions add column if not exists follow_up_date text default '';
    alter table lead_submissions add column if not exists last_contacted_at text default '';
    alter table lead_submissions add column if not exists lead_score text default '';
    alter table lead_submissions add column if not exists archived boolean not null default false;

    create index if not exists lead_submissions_created_at_idx on lead_submissions (created_at desc);
    create index if not exists lead_submissions_email_idx on lead_submissions (lower(email));
    create index if not exists lead_submissions_status_idx on lead_submissions (status);
    create index if not exists lead_submissions_priority_idx on lead_submissions (priority);
    create index if not exists lead_submissions_lead_source_idx on lead_submissions (lead_source);
    create index if not exists lead_submissions_archived_idx on lead_submissions (archived);
  