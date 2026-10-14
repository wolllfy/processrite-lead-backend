# Process Rite promotional SMS rollout

Website consent and Leads tracking are deployed. Promotional sending remains blocked until a campaign covering marketing is approved and its Messaging Service is configured.

## Consent and sending

The contact form has independent, unchecked support and promotion checkboxes. Both are optional. Shared disclosures specify support frequency varies, promotions at most four per month, rates, STOP/HELP, no purchase condition, privacy and separate terms. Version 2 consent stores source URL, purpose, method, disclosure version and server timestamp. A phone call or an unchecked form submission does not enroll a number in promotions. Unchecked submissions do not revoke earlier consent.

STOP revokes support and promotions for the canonical phone number. START restores support only. Twilio Advanced Opt-Out remains required for carrier suppression and keyword responses.

Admin/manager single-recipient sending uses POST /api/leads/:id/sms. Send intents and UUID idempotency keys are persisted before contacting Twilio. Ambiguous results require review rather than an automatic retry. Promotions require affirmative promotion consent, no opt-out, configured approved service and a maximum of four sends per Eastern calendar month. No bulk campaign runs automatically.

## Verification on October 14, 2026

Backend: 68 tests in six files; portal: 19 tests in six files; lint/build passed. Tests cover separate choices, opt-out gating, campaign approval gating, duplicate requests, delayed delivery, ambiguous send results and role restrictions.

Live owner test SM3dd97001f828a17deca9d63d695b0ff0 is Delivered in Leads. TESTREPLY, HELP, STOP and START are visible in its phone conversation. Latest STOP occurred at 7:33:29 PM Eastern and START at 7:33:58 PM. Current support preference is opted in and promotions are not opted in. A prior live send during STOP failed with provider error 21610. No promotional message has been sent.

The fictional TEST SMS Compact Consent website submission records support_v2 and promotions_v2, separate permissions and source /contact/. No SMS was sent to fictional test numbers. Mobile form controls were verified at widths 320, 360, 390 and 430; desktop header fills its card. These checks do not represent physical testing on every phone/browser.

## Carrier registration

Existing campaign CMfdaf166f4ff37d6d26c6cd3c272d3ca8 explicitly excludes promotional marketing. Keep its service MG5dd3dcebe7f4594390ee54748392087a operational while the replacement campaign is reviewed.

The owner approved a new Low Volume Mixed registration on October 14: at most $15 review and $1.50/month plus existing usage charges. Stop if eligibility or costs exceed that authorization. Do not buy a new phone number or delete the existing registration. After approval, configure authenticated incoming-message and delivery-status callbacks, Advanced Opt-Out, controlled sender migration and the approved service environment variable before enabling promotional sending. A real consented promotional handset test is still required after approval.

Registration content: Process Rite requested support/follow-ups and separately opted-in payment-processing, POS and Countervia offers. No purchased lists, cold texts or guaranteed savings. Public opt-in proof: https://processrite.com/contact/. Privacy: https://processrite.com/privacy-policy/#sms-privacy. Terms: https://processrite.com/terms-and-conditions/#sms-promotions.

Sample promotion: Process Rite: Looking for a clearer payment setup? Reply REVIEW to request a payment-processing review. Up to 4 promotional texts/month. Reply STOP to opt out or HELP for help.

Sample product message: Process Rite: Explore Countervia software for your business at https://countervia.com/. Reply with your business type for product information. Reply STOP to opt out or HELP for help.

Sample support: Process Rite: Following up on the payment review you requested. Reply with a convenient callback time. Reply STOP to opt out or HELP for help.
