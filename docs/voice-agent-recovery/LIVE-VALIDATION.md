# Production validation — October 14, 2026

## Latest computer-only validation, 6:38 PM Eastern

After call `01a13c87-6cfe-7ffb-b281-9c748e90d0c5` still returned `authentication_failed`, the owner requested computer testing to avoid further credit use. No additional phone or AI chat was initiated. Vapi's free tool-test panel does not populate the stored credential in its displayed request; its AI chat panel requires a payment method, so neither is claimed as runtime authentication proof.

Render's saved secret and running environment were compared privately by fingerprint and matched, both 64 characters. A fresh Vapi credential `77f91f28-fce7-47ce-bc17-33cd7679eeee` uses standard Authorization/Bearer defaults, without request encryption. The token input was compared privately with the running environment before creation and matched exactly. No token or fingerprint appears in these reports. LogLead v5 now references this credential. Backend `f7f1c7d` validates the same shared secret from a strictly formatted Bearer header or the existing webhook header, with constant-time comparison. Wrong, malformed and unrelated authorization schemes are rejected. Riley v9 uses the latest tool and explicitly requires Process Rite spelling in written summaries. The complete prompt was pasted and compared with its source ignoring editor whitespace before publishing.

Free production computer test `computer-callback-check-20261014` returned: wrong secret rejected 401; initial authenticated save 201/ok; repeat save same lead 28; completion and duplicate completion both 200; support type and Urgent priority preserved; different caller and callback retained; transcript/date/duration present. The existing synthetic test contact was reused. One alert attempt was provider-accepted, with no forced duplicate send. This exercised the backend directly using synthetic data and the server environment credential. It did not execute the new Vapi credential through a real voice call.

Latest local suite: 44 tests in four files passed using `npx vitest run --pool=threads --maxWorkers=1 --no-file-parallelism --isolate=false`; lint passed. An earlier attempt with isolated fork workers hit local native memory exhaustion before execution; do not label that attempt a passing run. The prior portal suite had 16 passing tests. Fresh live voice confirmation and backend email inbox receipt remain pending. The owner added credit; balance 25.06 was verified before the latest failed call. No credit purchase was performed by the agent.

## Deployment and authorization

The owner approved the proposed recovery deployment, reuse of the existing Vapi secret, internal call/email checks, and support SMS testing. No new paid plan, database migration, deleted contact, or credential rotation was performed.

Backend: `267a48e` correlated voice intake and reliable alert handling; `48ffd32` SMS status ordering; `1b6cdc4` safe intake failure categories. Public health confirmed app/database ready. Portal `dcad259` displays actual alert states and call identifiers. Riley v8 uses a callback-first flow, 60-second silence timeout and a 15-second idle prompt. LogLead v4 uses `/api/vapi/lead`, a saved custom credential, provider call ID/type/caller number and Riley's configured identifier. Earlier credential edits had not persisted because the Token input was empty; the current edit saved successfully and was reopened to verify the serialization settings. The former `{{ assistant.id }}` field was replaced with the configured identifier because it is absent from the documented default-variable list.

## Confirmed results

- Synthetic production intake `recovery-validation-20261014`: unauthenticated rejection 401; authenticated 201; duplicate intake returns the same lead 28; completion and duplicate completion 200. One correlated CRM record has support type, urgent priority, callback, transcript, date and duration. One SMTP alert was accepted by the provider.
- Live early-ended calls were captured as activity with caller ID and completion details. Do not confuse this fallback capture with a successfully confirmed callback request.
- Portal live browser verification shows the new notification states. `provider_accepted` means SMTP accepted the alert, not that an inbox receipt is proven.
- Local backend suite: 43 tests in four files. Portal suite previously passed 16 tests in five files. Backend checks and portal build/lint passed during the deployment; the later diagnostics patch passed focused voice tests.

## Actual voice test failures and correction status

| Call | Observation |
| --- | --- |
| `01a13ae6-5c70-7000-94a3-68e8f35473f6` | Caller ended before tool execution; fallback activity and alert accepted. |
| `01a13aed-92dd-7000-859d-83cc6e16a613` | Old ten-second silence timeout ended the call; changed to sixty seconds. |
| `01a13af0-c081-755c-8e03-7379ea89dd6f` | Assistant continued issue qualification after callback correction; replaced prompt with coherent early-save flow. |
| `01a13af8-2aee-7ee0-a2a9-dea2aa3cb904` | LogLead executed but returned `{"ok":false}`. Model arguments contained name, valid-length phone, summary, general type and Medium priority. Saved credential/configuration corrections followed. Actual HTTP rejection category was not exposed by that earlier response. |

The most recent corrected configuration still needs a real successful tool execution. Do not label the voice recovery complete until Vapi returns `ok:true`, the correlated lead is visible, and Riley acknowledges the save. Only 0.17 Vapi credits remained before the final requested check; no credits were purchased. Backend-specific inbox receipt remains unconfirmed.

## Support SMS production evidence

| Check | Provider/CRM result |
| --- | --- |
| Console owner test `SM9a401372350102252487f71c770e1107` | Delivered. Console omitted normal service/status callback; imported this identified test into lead 24 explicitly. |
| Normal service reply `SM3e1fd22543e4c13a9492f797da226ceb` | Delivered; CRM status recorded. |
| Inbound support `SMdcfc83b4c25f8a8425e35339b2da9d90` | Received and saved to CRM. |
| HELP `SMe61fb6db81c6a57c3987319d65dcc1c9` | Incoming keyword saved; Twilio manages its automatic reply. |
| STOP `SM78fe20d003926461d460b8c673ef14ac` | CRM opt-out true and consent false. |
| Send after STOP `SMfdf579adb5857bbbf07dbc63e48f100d` | Failed with 21610; blocking and status callback verified. |
| START | Incoming event cleared opt-out; verified in database. |
| Unicode/multipart `SM2827e547f83801356af48ba987c72fda` | Delivered, three segments; accented text preserved in CRM. |

Automated tests additionally cover invalid signatures, duplicate/reordered events, wrong destination, delivery failure, database outage and preservation of an existing lead's stage. The listed campaign `CMfdaf166f4ff37d6d26c6cd3c272d3ca8` is Approved, dated March 26, and the public line is registered under its messaging service. This is not evidence of a new approval yesterday.

Twilio automatic HELP/STOP/START responses are not exposed as ordinary Messaging Logs/status callbacks. Keyword capture and opt-out enforcement are verified; device receipt of each automated response is a separate user check. MMS, promotional campaigns, bulk traffic and every carrier were not tested.

## Remaining boundaries

### Evening follow-up, 6:15 PM Eastern

Call `01a13c7c-58fd-7ffb-b203-206d7b2bda65` confirmed the remaining error precisely: both LogLead attempts returned `authentication_failed`. Render recorded `secretHeaderPresent:true`, `authorizationPresent:false`, proving a present but mismatched token rather than a storage failure. The earlier credential correction had used the assistant's displayed header value; this was not a verified source of the live server secret. The credential was corrected using the revealed existing `VAPI_WEBHOOK_SECRET` directly from Render, re-hidden immediately, and saved in Vapi without printing or persisting its value in this report.

The failed call's actual model arguments were replayed once through the authenticated backend, with call context taken from its existing database event. Response 201, `ok:true`, lead 24. Verification confirmed name/callback, completion, transcript, date and duration together on that original call record. The existing email was provider-accepted; no duplicate alert was forced. This was explicit recovery of a failed request, not proof of a new successful Vapi tool execution.

Vapi balance was 0.06 credits after this call. The owner was asked to top up manually or leave final live confirmation pending. No credit purchase was made. CRM browser authentication expired when refreshing; database verification was used for the recovered fields, and no fresh browser screenshot of the recovered lead is claimed.

Original split Tony records 24/27 were preserved; no historical merge was approved or performed. The legacy public `/api/leads` Vapi branch remains for rollback and should be retired after authenticated LogLead is proven. Real PostgreSQL concurrent-worker and SMTP outage injection are still staging-only checks. These limitations must remain visible rather than treating mock tests as end-to-end proof.

References: [Vapi API Request configuration](https://docs.vapi.ai/tools/api-request/configuration), [default variables](https://docs.vapi.ai/assistants/dynamic-variables), [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), [Twilio automatic-response tracking](https://help.twilio.com/articles/31560110671259-How-to-Track-Opt-Out-Opt-In-and-Help-Messages-Using-the-OptOutType-Parameter).
