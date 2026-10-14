Current status, October 14, 2026: backend c307ace, portal dcad259, Riley v9 and LogLead v5. Real voice save succeeded; callback digits were verified and corrected, and the correction alert was provider-accepted. All 55 backend tests pass. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md). Baseline observations below are historical.
# Tony test-call trace
Call ID: 01a13a9a-090d-7000-906d-7d2e84d14864.
Start: October 14 at 09:28:55 Eastern. Duration: 137.216 seconds. End: customer ended call, approximately 09:31.

| Stage | Evidence | Result |
|---|---|---|
| Twilio / Vapi | Incoming call displayed for ProcessRite main line, Riley v4 | Connected |
| Conversation | Existing-account support, urgent callback | Not a qualified sales enquiry |
| LogLead | 09:30:35 Completed successfully; response ok true, leadId 27 | Saved |
| Render | 09:30:35 lead_request_received; hasEmail false | Request received |
| CRM request | Tony, callback ending 1543, source Vapi, created 09:30, support summary | Visible; Email Alert Not sent |
| CRM call activity | Caller ending 6067; existing Unknown caller record; latest transcript, 09:28 call date and duration | Visible; Email Alert Sent |
| Inbox | User reports receiving Vapi email at configured owner mailbox | Vapi message receipt reported; backend-specific alert not identified |

The confirmed callback and caller ID differ. This is legitimate and must not be treated as an invalid phone number. The two records are evidence of uncorrelated paths, not a lost database insert.

The exact call-completion HTTP status was not independently read from Vapi webhook logs; CRM transcript/date/duration prove its effects persisted. Raw transcripts and private phone numbers are intentionally omitted. Email-provider delivery logs and inbox headers were not available.
