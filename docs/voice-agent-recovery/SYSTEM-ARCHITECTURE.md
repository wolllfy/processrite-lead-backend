Current status, October 14, 2026: approved repairs are deployed. Backend f7f1c7d; portal dcad259; Riley v9; LogLead v5 with a replacement standard Bearer credential. Free computer validation passed; real Vapi voice confirmation remains pending. See [LIVE-VALIDATION.md](LIVE-VALIDATION.md). The baseline observations below are historical and do not describe the current deployment.
# Verified system architecture
Incoming public number 973-314-2419 → Twilio voice route → Vapi Riley v4 → LogLead API Request v2 → Render /api/leads → PostgreSQL lead_submissions → portal.processrite.com.
Separately: authenticated Vapi status/end-of-call events → /api/vapi/events → vapi_call_events → call-alert worker → Nodemailer SMTP → configured owner recipient.

Current assistant: 0cf76238-66ec-4f04-a3d6-c06a95b980cd. Tool: 50c2ef42-8308-469a-bbb8-ab3e1d94df3e. Tool requires name and phone. Its authorization panel says No authentication. Static source fields exist, but no call ID. API URL verified in visible tool form.

Live model configuration verified in dashboard: Deepgram Nova 3 English; OpenAI GPT-4o Mini Cluster; MiniMax Cheerful sophie agent / Speech 02 Turbo. Riley identifies itself as an AI receptionist and distinguishes processing enquiries from existing-account support. Do not upgrade the model during recovery.

Render service processrite-lead-backend, branch recovery/staging-first; deployed commit matches local baseline and public health response (app/database ok). SMTP and Vapi-secret environment keys present. No credentials were written to these reports.

Twilio texts are separate: signed inbound/status webhooks → processrite_sms_messages → lead thread. Voice recovery must preserve these routes and authentication middleware ordering.
