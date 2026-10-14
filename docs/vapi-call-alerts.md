# Automatic inbound call capture

Riley's authenticated server events POST to `/api/vapi/events` with `x-vapi-secret` matching the Render `VAPI_WEBHOOK_SECRET` environment variable. Only Riley inbound-phone-call events are accepted. Enable `status-update` and `end-of-call-report` server messages. Existing LogLead URL remains unchanged.

Calls create/update a Vapi contact in Process Rite Leads even without a spoken name. Withheld numbers are labelled unavailable rather than invented. Repeat callers update the same active Vapi contact, while `vapi_call_events` retains one activity record per call ID. Website enquiries are not merged into voice contacts. Existing qualification/status is preserved.

After the final report, the worker sends one email per call to the existing EMAIL_TO recipient. An ended-status event can trigger a fallback alert after 60 seconds if the final report has not arrived. Failed SMTP attempts retry after five minutes. Database row locks prevent concurrent workers sending the same alert; an SMTP acceptance followed by a process/database crash can still cause a retry, so delivery is at least once rather than a guarantee of exactly once. `email_alert_sent` records provider acceptance, not inbox delivery.

With the webhook enabled, LogLead updates known details without sending a separate per-field email. Call completion owns email delivery. Unknown-name calls remain New and unqualified. The assistant's confirmed callback number can differ from caller ID; matching uses the caller-ID phone unless a lead already uses that number.

The Vapi event pipeline cannot observe calls that never reach Vapi (for example a telephony routing outage). Twilio remains the independent source for those call logs. No model, voice, phone routing, A2P registration, billing, or transfer destination changes are made here.

Validation: npm test (21 tests), npm run lint, npm run check. Live validation must include a short hang-up call, a complete intake call, matching portal entries, email acceptance, and duplicate webhook delivery.

Rollback: remove the Vapi assistant server URL/header and VAPI_WEBHOOK_SECRET. The normal LogLead email path resumes. Existing call history and leads are retained.
