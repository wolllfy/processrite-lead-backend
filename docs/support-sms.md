# Process Rite support SMS

Website: Optional, unchecked support-only SMS consent. A submitted phone number or phone call alone does not opt a customer in. The existing Leads consent, method, and timestamp fields store the checkbox result. Matching SMS privacy/terms are published on the existing policy URLs.

Backend: `POST /api/twilio/sms` records inbound messages, and `/api/twilio/sms/status` records outbound delivery changes. Both use the official Twilio SDK to verify the signature against the fixed public backend URL and `TWILIO_AUTH_TOKEN`, and require `TWILIO_ACCOUNT_SID`. Configure the existing Messaging Service's inbound webhook and delivery-status callback. Only traffic involving +19733142419 is accepted. Credentials belong in Render environment variables, never source control.

Messages are retained by MessageSid, attached to the matching active lead by phone, and shown in the existing Message detail in Process Rite Leads after Refresh. A separate SMS history table prevents later voice-call transcript updates from losing texts. Duplicate incoming callbacks do not create duplicate messages. Delayed delivery callbacks do not regress a delivered status. STOP/START update the recorded support-text preference; Twilio's Advanced Opt-Out must remain enabled for carrier-level suppression and keyword responses. Inbound enquiries do not automatically grant marketing consent.

This release does not automate outbound messaging or add promotional campaigns. Carrier approval and real send/receive testing are required before claiming texting works. Existing voice call capture is preserved.

Validation: 27 tests across four suites, lint, syntax checks. Website submissions passed both unchecked and explicitly checked; checked consent reached Leads with method website_optional_support_checkbox_v1 and a timestamp. Live signed webhook tests and handset tests remain part of deployment verification.
