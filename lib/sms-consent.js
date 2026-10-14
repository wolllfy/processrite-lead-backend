export const phoneKey = value => String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
export const smsSendSchema=`CREATE TABLE IF NOT EXISTS processrite_sms_sends (
 request_id uuid PRIMARY KEY,lead_id bigint NOT NULL REFERENCES lead_submissions(id),
 actor_id text NOT NULL,purpose text NOT NULL,recipient text NOT NULL,body text NOT NULL,
 message_sid text,status text NOT NULL DEFAULT 'pending',error_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO processrite_sms_preferences(phone,purpose,granted,method,source_url,disclosure_version,updated_at)
 SELECT DISTINCT ON (regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)',''))
 regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)',''),'support',true,
 coalesce(nullif(l.sms_consent_method,''),'legacy_support_record'),coalesce(l.source_url,l.page_source,''),'legacy_support',
 l.created_at
 FROM lead_submissions l WHERE l.sms_consent=true AND regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','') ~ '^[0-9]{10}$'
 AND NOT EXISTS(SELECT 1 FROM processrite_sms_optouts o WHERE o.phone=regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','') AND o.opted_out=true)
 ORDER BY regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)',''),l.created_at DESC
 ON CONFLICT(phone,purpose) DO NOTHING;`;
export const consentSchema = `
CREATE TABLE IF NOT EXISTS processrite_sms_preferences (
 phone text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('support','promotions')),
 granted boolean NOT NULL, method text NOT NULL, source_url text NOT NULL DEFAULT '',
 disclosure_version text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(phone,purpose)
);
CREATE TABLE IF NOT EXISTS processrite_sms_consent_events (
 event_key text PRIMARY KEY, lead_id bigint NOT NULL REFERENCES lead_submissions(id),
 phone text NOT NULL, purpose text NOT NULL, granted boolean NOT NULL, method text NOT NULL,
 source_url text NOT NULL DEFAULT '', disclosure_version text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);`;

// An unchecked enquiry checkbox records a non-enrolment, not a revocation of earlier consent.
// STOP is the explicit global revocation. START restores support only, never marketing.
export async function recordWebsiteConsent(client, leadId, input) {
 const phone=phoneKey(input.phone);
 if(!/^\d{10}$/.test(phone)) {
  if(input.sms_marketing_consent) throw Error('Promotional texts require a US mobile number');
  return;
 }
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sms-preference:${phone}`]);
 for(const purpose of ['support','promotions']) {
  const granted=purpose==='support'?Boolean(input.sms_consent):Boolean(input.sms_marketing_consent);
  const method=purpose==='support'?'website_optional_support_checkbox_v1':'website_optional_promotions_checkbox_v1';
  const version=purpose==='support'?'support_v1':'promotions_v1';
  const event=await client.query(`INSERT INTO processrite_sms_consent_events(event_key,lead_id,phone,purpose,granted,method,source_url,disclosure_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,[`website:${leadId}:${purpose}`,leadId,phone,purpose,granted,method,input.source_url||input.page_source||'',version]);
  if(granted&&event.rows.length) await client.query(`INSERT INTO processrite_sms_preferences(phone,purpose,granted,method,source_url,disclosure_version) VALUES($1,$2,true,$3,$4,$5) ON CONFLICT(phone,purpose) DO UPDATE SET granted=true,method=EXCLUDED.method,source_url=EXCLUDED.source_url,disclosure_version=EXCLUDED.disclosure_version,updated_at=now()`,[phone,purpose,method,input.source_url||input.page_source||'',version]);
 }
}

export async function keywordPreferences(client,phone,leadId,sid,optedOut) {
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sms-preference:${phone}`]);
 for(const purpose of optedOut?['support','promotions']:['support']) {
  await client.query(`INSERT INTO processrite_sms_preferences(phone,purpose,granted,method) VALUES($1,$2,$3,'inbound_sms_keyword') ON CONFLICT(phone,purpose) DO UPDATE SET granted=EXCLUDED.granted,method=EXCLUDED.method,updated_at=now()`,[phone,purpose,!optedOut]);
  await client.query(`INSERT INTO processrite_sms_consent_events(event_key,lead_id,phone,purpose,granted,method) VALUES($1,$2,$3,$4,$5,'inbound_sms_keyword') ON CONFLICT(event_key) DO NOTHING`,[`keyword:${sid}:${purpose}`,leadId,phone,purpose,!optedOut]);
 }
}

export async function smsPreferences(pool,rows) {
 if(!rows.length)return rows;
 const phones=[...new Set(rows.map(x=>phoneKey(x.phone)))];
 const preferences=(await pool.query('SELECT * FROM processrite_sms_preferences WHERE phone=ANY($1::text[])',[phones])).rows;
 const optouts=(await pool.query('SELECT * FROM processrite_sms_optouts WHERE phone=ANY($1::text[])',[phones])).rows;
 return rows.map(row=>{
  const key=phoneKey(row.phone),mine=preferences.filter(x=>x.phone===key),support=mine.find(x=>x.purpose==='support'),promo=mine.find(x=>x.purpose==='promotions');
  const stopped=Boolean(optouts.find(x=>x.phone===key)?.opted_out);
  return {...row,sms_preferences:{opted_out:stopped,support:{granted:!stopped&&(support? support.granted:Boolean(row.sms_consent)),method:support?.method||row.sms_consent_method||'',timestamp:support?.updated_at||row.sms_consent_timestamp||''},promotions:{granted:!stopped&&Boolean(promo?.granted),method:promo?.method||'',timestamp:promo?.updated_at||'',source_url:promo?.source_url||'',disclosure_version:promo?.disclosure_version||''}}};
 });
}
