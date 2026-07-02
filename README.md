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

## Deploy steps

1. Create a Render Web Service from this folder.
2. Create a Render Postgres database.
3. Run `schema.sql` against the database.
4. Add the environment variables above.
5. Confirm `https://YOUR-RENDER-SERVICE.onrender.com/health` returns `{"ok":true}`.
6. Update WordPress forms to post to `https://YOUR-RENDER-SERVICE.onrender.com/api/leads`.

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

The endpoint stores the lead in Postgres and emails `EMAIL_TO`. Logs include only submission id, source URL, and error category, not full customer details.
