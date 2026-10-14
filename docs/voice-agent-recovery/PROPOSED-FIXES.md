Audit date: October 14, 2026 (America/New_York). Local repairs only; production remains at b0cd61826555e7a09b7e653fc6b3ccda4ce2f07b.

# Reviewable deployment proposal
## Prepared locally
- lib/vapi-calls.js: authenticated POST /api/vapi/lead for existing API Request tool; shared-secret authentication; validated provider/static metadata; call ID transaction locking; correlation; support classification and priority preservation.
- server.js: add precise voice notification state to CRM responses, retaining old fields.
- Call alert worker: SMTP rejection detection, bounded backoff, final failure log, deterministic Message-ID, callback-aware message.
- Synthetic automated tests; no production database changes or new tables.

## Production changes requiring approval
1. Deploy reviewed backend patch after local checks pass. Existing website, phone number and SMS endpoints remain unchanged.
2. Publish LogLead API Request version with URL https://processrite-lead-backend.onrender.com/api/vapi/lead. Add trusted Static Body Fields call_id={{ call.id }}, caller_number={{ customer.number }}, assistant_id={{ assistant.id }}, call_type_provider={{ call.type }}. These must NOT be LLM-facing request-schema properties.
3. Authenticate that request through a Vapi credential using the existing shared secret/header x-vapi-secret. No secret rotation. This enables the same authorized backend access; credential entry must follow browser confirmation requirements.
4. Add optional business_name and priority fields to the tool; keep name/phone required. Priority enum Low/Medium/High/Urgent, call_type support/sales/general. Preserve monthly_volume alias, optional blank email. Explicitly instruct Riley to repeat uncertain product/system names rather than guessing Clover; urgent support must save Urgent, and Riley must not promise immediate human response.
5. After frontend source is recovered, display backend notification states and failure count. Do not mark provider_accepted as Delivered. This frontend patch is not yet prepared.

Impact: one correlated request/call for new calls; separate confirmed callback; accurate alert state and bounded retries. Existing legacy records are retained. The old public /api/leads voice branch remains for rollback compatibility and should be retired after new tool validation; it is not an authenticated Vapi route. Plan a separate controlled retirement to avoid silently breaking old clients.

Rollout: backend first, health check; then tool update while saved Riley retains current assistant version; then one authorized synthetic inbound call and internal email. Verify tool static fields resolve, auth succeeds and no second request record appears when numbers differ. No migration needed. Take a routine database backup before any historical reconciliation.

Rollback: restore tool v2 first (old /api/leads endpoint and fields), then redeploy baseline b0cd61826555e7a09b7e653fc6b3ccda4ce2f07b. New event rows use the existing schema and survive rollback. No deletes. Old UI ignores added API fields.

Approval does not authorize a database migration, contact deletion, outbound campaign, purchase of credits or promotional text. A live test must have a separately agreed caller and internal recipient.

References: [Vapi static parameters](https://docs.vapi.ai/tools/static-variables-and-aliases/static-parameters), [variable bag](https://docs.vapi.ai/tools/static-variables-and-aliases/how-variables-work), [server authentication](https://docs.vapi.ai/server-url/server-authentication).
