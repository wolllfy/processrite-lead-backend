Current status, October 14, 2026: backend c307ace, portal dcad259, Riley v9 and LogLead v5. Real voice save succeeded; callback digits were verified and corrected, and the correction alert was provider-accepted. All 55 backend tests pass. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md). Baseline observations below are historical.
# Email audit
Mechanism: Nodemailer SMTP, configured through EMAIL_FROM, EMAIL_TO, SMTP_HOST/PORT/USER/PASS. EMAIL_TO is info@processrite.com (verified in Render form). Credentials were not exposed. Worker runs every10 seconds and waits for a final report or an ended event older than60 seconds.

Current behavior: SMTP Promise resolution sets vapi_call_events.email_sent_at and the linked lead's email_alert_sent. It does not inspect rejected recipients or prove inbox delivery. The caller-number CRM record shows Sent, but this is historical provider-acceptance metadata.

Local repair validates a nonempty accepted list and no rejected recipients, keeps the record on failure, retries at5/10/20/40/60 minutes up to six attempts, and logs a persistent-failure event without contact details. Stable message IDs reduce retry duplication risk. Email includes callback, caller ID, contact name, support/sales classification and priority. API reports provider_accepted, never delivered.

Residual limitation: SMTP acceptance followed by a database failure can cause a duplicate retry. Stable Message-ID does not guarantee exactly-once delivery. Partial acceptance of a multi-recipient configuration can also duplicate the accepted recipient on retry; current intended configuration is one internal mailbox. Persistent failures are logged and exposed in API but need the pending portal alert display or an independent monitoring channel.

User reports a Vapi email arrived at info@processrite.com. Backend-specific email delivery, spam filtering, SPF/DKIM/DMARC, bounce/suppression and actual inbox receipt are not independently verified. No test email or SMTP verification request was sent in this recovery turn.

Reference: [Nodemailer SMTP response semantics](https://nodemailer.com/extras/smtp-connection), [message IDs](https://nodemailer.com/message).
