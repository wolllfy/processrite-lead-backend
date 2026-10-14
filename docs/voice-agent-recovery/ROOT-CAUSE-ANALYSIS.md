Current status, October 14, 2026: approved repairs are deployed. Backend 1b6cdc430225d0e5cf4282fff2eea50bac1d8f3e; portal dcad259; Riley v8; LogLead v4. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md) for current evidence and remaining live-call verification. The baseline observations below are historical and do not describe the current deployment.
# Root cause and confidence
Confirmed: LogLead matches the caller-confirmed callback number. The completion webhook matches caller ID. The tool has no trusted call ID to connect them. The /api/leads Vapi branch suppresses immediate email whenever VAPI_WEBHOOK_SECRET is configured, because the completion worker owns notification delivery. With different numbers, the request record is excluded from that job and stays Not sent, while another record holds the transcript and Sent flag.

This explains the split records and missing request-level alert. It does NOT establish that SMTP inbox delivery failed: live code marks Sent when sendMail resolves and does not validate its accepted/rejected recipient lists. The user subsequently reported receiving a Vapi email; that message has not been identified as the backend alert.

Additional gaps: legacy Vapi intake lacks tool authentication; no bounded retries; generic Sent label conflates acceptance with delivery; urgency was not persisted as Urgent; the model inferred Clover from unclear speech. Call-completion capture otherwise works and must be retained.

No production records were merged, deleted or edited during this audit. Historical Tony records need a separate narrow reconciliation after approval; do not automatically merge contacts solely by name or last digits.
