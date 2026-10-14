Current status, October 14, 2026: approved repairs are deployed. Backend f7f1c7d; portal dcad259; Riley v9; LogLead v5 with a replacement standard Bearer credential. Free computer validation passed; real Vapi voice confirmation remains pending. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md). The baseline observations below are historical and do not describe the current deployment.
# CRM and database audit
Primary tables: lead_submissions; vapi_call_events with call_id primary key, lead_id foreign key, caller phone, completion state, attempts, next attempt and SMTP-acceptance timestamp; processrite_sms_messages keyed by MessageSid.

Verified current CRM: Tony request ID27 exists, support source Vapi, status New, priority Medium, no SMS consent. Caller-number activity exists with transcript and date/duration, source Vapi + SMS. No automatic Qualified status was assigned. All calls remain visible, including hangups, as previously requested; a record is activity, not sales qualification.

Existing country-code normalization strips punctuation and a leading US1. Repeat Vapi calls may reuse a matching active contact; call events remain distinct and retry-safe through call_id. Historical contacts must be preserved.

Local repair uses a trusted static call ID and authenticated endpoint, preserves callback separately from caller ID, persists business details and explicit support/priority fields, and retains support classification when completion arrives. Late tool delivery can attach existing completed call details. Monthly-volume ranges remain display strings; unknown volume is not invented or scored.

Local API list/detail/update responses now include voice_notification with call_id, attempts, provider_accepted_at and status: awaiting_completion, queued, retry_pending, failed, provider_accepted. Legacy email_alert_sent stays for compatibility.

Remaining frontend work: replace generic Sent/Not sent with the new status and show a persistent failed-alert count. This backend change alone does not alter the live portal UI. The actual deployed frontend source was not identified in this recovery checkout. Do not claim that UI patch is deployed or locally verified.
