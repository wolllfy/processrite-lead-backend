Current status, October 14, 2026: backend c307ace, portal dcad259, Riley v9 and LogLead v5. Real voice save succeeded; callback digits were verified and corrected, and the correction alert was provider-accepted. All 55 backend tests pass. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md). Baseline observations below are historical.
# Controlled live validation
Before production changes: approve backend and LogLead configuration proposal, preserve exported previous tool config privately, confirm rollback commit, select internal recipient info@processrite.com and obtain authorization for the test call and backend email. No credential rotation or migration.

- [ ] All local checks pass on final patch.
- [ ] Backend deploy health app/database ok and reviewed commit reported.
- [ ] Tool static call ID, caller ID, assistant ID and call type resolve from Vapi; secret credential authenticates the new route.
- [ ] Caller places one test inbound call to973-314-2419, uses Synthetic Recovery Test, a callback different from caller ID, no actual merchant details.
- [ ] Riley asks relevant questions, confirms callback, does not guess a product, and LogLead receives201 with one lead ID.
- [ ] End report and tool record share one call ID and lead ID; transcript/date/duration present, callback preserved and support urgency retained.
- [ ] CRM displays the request once; existing contact records remain.
- [ ] One alert job reaches provider_accepted; no duplicate send from a duplicate event.
- [ ] Internal mailbox receives the backend subject Process Rite call; compare call ID and callback. Vapi's own email is a separate signal.
- [ ] Failure/retry path remains saved and clearly labelled. Staging only: simulate SMTP failure and concurrent retries.
- [ ] Early hangup saved as unqualified activity without invented identity or consent.
- [ ] Website form and signed SMS intake still function; do not send promotional messages.

Twilio follow-up checked October14: console shows campaign CMfdaf166f4ff37d6d26c6cd3c272d3ca8 Approved, created/updated March26; same messaging service MG5dd3dcebe7f4594390ee54748392087a used in yesterday's configuration. Public number973-314-2419 currently REGISTERED in Assigned phone numbers. Yesterday's saved registration object QE2c6890da8086d771620e9b13fadeba0b was IN_PROGRESS with no external campaign ID, and outbound test failed30034. These different registration representations were not reconciled through today's API. Do not claim a new approval date or assume the console row proves a delivered SMS. Next authorized support-text test must confirm delivered status and CRM history.
