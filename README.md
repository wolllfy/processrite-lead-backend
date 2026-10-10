# Process Rite Render Lead Backend

This is a Render-ready lead endpoint for ProcessRite.com.

## Render environment variables

- `DATABASE_URL`: Render Postgres internal connection string.
- `EMAIL_FROM`: verified sender, for example `Process Rite <leads@processrite.com>`.
- `EMAIL_TO`: `wolllfyx@gmail.com`.
- `SMTP_HOST`: SMTP server hostname.
- `SMTP_PORT`: `587` or `465`.
- `SMTP_USER`: SMTP username.
- `SMTP_PASS`: SMTP password.
- `ALLOWED_ORIGINS`: `https://processrite.com,https://www.processrite.com`.
- `IP_HASH_SECRET`: long random string used to hash IPs before storage.
- `PORTAL_USERNAME`: CRM login username.
- `PORTAL_PASSWORD`: CRM login password.
- `AUTH_SECRET`: long random string used to sign CRM session tokens.
- `AUTH_SESSION_TTL_SECONDS`: optional CRM session duration, default `28800`.
- `CRM_API_KEY`: optional service key. If set, the portal may also send `x-crm-api-key`.

All authentication, hashing, SMTP, and database credentials must be supplied through
the deployment environment. The application has no credential fallbacks. Copy
`.env.example` only for local setup and never commit a populated `.env` file.

## Deploy steps

1. Create a Render Web Service from this folder.
2. Create a dedicated Render Postgres database named `processrite-leads-db` in the same region as the web service.
3. Set the web service's `DATABASE_URL` to that database's **Internal Database URL**. Do not use another product's database.
4. Add the remaining environment variables above. The application initializes and safely upgrades its schema at startup using only `IF NOT EXISTS` operations; `schema.sql` is retained as a reference and is not required for normal deploys.
5. Set Render's health-check path to `/health`, then confirm it returns `{"ok":true,"database":"connected"}`.
6. Update WordPress forms to post to `https://YOUR-RENDER-SERVICE.onrender.com/api/leads`.
7. Confirm the CRM can sign in through `POST /api/auth/login` and then read leads with the returned bearer token.

## WordPress form fields

Every lead form should submit:

- `name`
- `business_name`
- `phone`
- `email`
- `business_type`
- `monthly_processing_volume`
- `current_processor`
- `message`
- `page_source`
- `timestamp`
- `company` as a hidden honeypot field that should stay empty.

The endpoint stores the lead in Postgres and then emails `EMAIL_TO`. A mail failure is logged and leaves `email_alert_sent=false`, but does not tell the visitor that their safely stored lead failed. Logs redact database URLs and password-style fields.

Daily Process Rite report
Runs at 9 PM America/New_York on the existing backend (one-minute checks). Recipient is muheisenone@outlook.com; sender and SMTP credentials come from the existing Process Rite EMAIL_FROM/SMTP_* configuration. Muheisen email credentials are never used.
Enabled by default for this approved rollout. Set PROCESSRITE_DAILY_REPORT_ENABLED=false to stop scheduled reports. GET /api/reports/daily shows status/history; POST /api/reports/daily/test sends a fixed-recipient test. Both require an active administrator session.
No schema migration: claims and delivery outcomes use crm_access_events. PostgreSQL transaction advisory lock serializes claims across instances. After a claim, failures or uncertain acceptance are not automatically resent. Check Outlook and delivery history before manual testing again.
Coverage: lead totals, last-24-hour submissions, current pipeline counts, source/page label/URL attribution, up to 25 recent leads, up to 25 recorded follow-up dates, unsent lead-alert flags. Excludes raw contact details, transcripts, recordings and payment-card data. Does not measure commissions/residuals, live website uptime, backup health or historical pipeline conversion.
Reliability: catches up during the same evening after a restart; a full outage from 9 PM through midnight can miss a report. Runs only while the existing backend is running. No new hosting subscription.
Rollback: set PROCESSRITE_DAILY_REPORT_ENABLED=false, then revert the report commit if needed. Do not delete report claim events while scheduling is enabled. Public lead intake is unchanged.
