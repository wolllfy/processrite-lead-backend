import twilio from 'twilio';
const clean=(x,n=4000)=>String(x??'').slice(0,n);
const digits=x=>clean(x,60).replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
export const smsSchema=`CREATE TABLE IF NOT EXISTS processrite_sms_messages (
 message_sid text PRIMARY KEY,lead_id bigint NOT NULL REFERENCES lead_submissions(id),direction text NOT NULL,
 sender text NOT NULL,recipient text NOT NULL,body text NOT NULL DEFAULT '',delivery_status text NOT NULL,
 error_code text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
); CREATE INDEX IF NOT EXISTS processrite_sms_lead_idx ON processrite_sms_messages(lead_id,created_at);
CREATE TABLE IF NOT EXISTS processrite_sms_optouts(phone text PRIMARY KEY,opted_out boolean NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());`;

export function validTwilioRequest(req,env){
 if(!env.TWILIO_AUTH_TOKEN||!env.TWILIO_ACCOUNT_SID||req.body?.AccountSid!==env.TWILIO_ACCOUNT_SID)return false;
 return twilio.validateRequest(env.TWILIO_AUTH_TOKEN,req.get('x-twilio-signature')||'',`https://processrite-lead-backend.onrender.com${req.originalUrl}`,req.body);
}
export async function saveSms(pool,message){
 if(!/^(SM|MM)[a-f0-9]{32}$/i.test(message.sid)||!['inbound','outbound'].includes(message.direction))throw Error('Invalid message');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sms:${message.sid}`]);
  const existing=(await c.query('SELECT * FROM processrite_sms_messages WHERE message_sid=$1 FOR UPDATE',[message.sid])).rows[0];
  if(existing){
   const ranks={accepted:0,queued:1,sending:2,sent:3,delivered:4,undelivered:4,failed:4,received:4};
   if((ranks[message.status]??0)>=(ranks[existing.delivery_status]??0))await c.query('UPDATE processrite_sms_messages SET delivery_status=$2,error_code=$3,updated_at=now() WHERE message_sid=$1',[message.sid,message.status,message.error||'']);
   await c.query('COMMIT');return existing.lead_id;
  }
  const phone=message.direction==='inbound'?message.from:message.to,key=digits(phone);
  if(key.length<7)throw Error('Invalid caller number');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`voice:${key}`]);
  let lead=(await c.query(`SELECT id,lead_source FROM lead_submissions WHERE regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','')=$1 AND coalesce(archived,false)=false ORDER BY id DESC LIMIT 1`,[key])).rows[0];
  if(!lead)lead=(await c.query(`INSERT INTO lead_submissions(name,phone,email,business_type,monthly_processing_volume,monthly_volume,lead_source,page_source,source_url,status,priority,summary,sms_consent) VALUES('Text enquiry',$1,'no-email@processrite.local','Not provided','Not provided','Not provided','Twilio SMS','sms-message','sms-message','New','Medium','Customer text message — review and respond.',false) RETURNING id,lead_source`,[phone])).rows[0];
  await c.query('INSERT INTO processrite_sms_messages(message_sid,lead_id,direction,sender,recipient,body,delivery_status,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[message.sid,lead.id,message.direction,message.from,message.to,message.body,message.status,message.error||'']);
  if(message.direction==='inbound'){
   const command=clean(message.optOutType||message.body,30).trim().toUpperCase();
   if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','START','UNSTOP'].includes(command)){
    const optedOut=!['START','UNSTOP'].includes(command);
    await c.query('INSERT INTO processrite_sms_optouts(phone,opted_out) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET opted_out=EXCLUDED.opted_out,updated_at=now()',[key,optedOut]);
    await c.query("UPDATE lead_submissions SET sms_consent=$2,sms_consent_method='inbound_sms_keyword',sms_consent_timestamp=$3 WHERE id=$1",[lead.id,!optedOut,new Date().toISOString()]);
   }
  }
  await c.query("UPDATE lead_submissions SET lead_source=CASE WHEN lead_source LIKE '%SMS%' THEN lead_source ELSE coalesce(nullif(lead_source,''),'Twilio') || ' + SMS' END,updated_at=now() WHERE id=$1",[lead.id]);
  await c.query('COMMIT');return lead.id;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function attachSms(pool,rows){
 if(!rows.length)return rows;
 const messages=await pool.query('SELECT lead_id,direction,body,delivery_status,error_code,created_at FROM processrite_sms_messages WHERE lead_id=ANY($1::bigint[]) ORDER BY created_at',[rows.map(x=>x.id)]);
 return rows.map(row=>{const thread=messages.rows.filter(m=>String(m.lead_id)===String(row.id));return {...row,message:[row.message,thread.length?'SMS conversation (Eastern Time):\n'+thread.map(m=>`${new Date(m.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} | ${m.direction} | ${m.delivery_status}${m.error_code?' (error '+m.error_code+')':''}\n${m.body}`).join('\n\n'):''].filter(Boolean).join('\n\n')};});
}
export function mountTwilioSms(app,{pool,env,lookupMessage}){
 const verify=(req,res,next)=>validTwilioRequest(req,env)?next():res.status(403).send('Forbidden');
 app.post('/api/twilio/sms',verify,async(req,res)=>{
  try{
   if(req.body.To!=='+19733142419')return res.status(400).send('Unexpected number');
   await saveSms(pool,{sid:req.body.MessageSid,direction:'inbound',from:req.body.From,to:req.body.To,body:clean(req.body.Body),status:'received',optOutType:req.body.OptOutType});
   res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }catch{console.error('twilio_sms_ingest_failed');res.status(500).send('Unable to save message');}
 });
 app.post('/api/twilio/sms/status',verify,async(req,res)=>{
  try{
   const sid=req.body.MessageSid;if(!/^(SM|MM)[a-f0-9]{32}$/i.test(sid||''))return res.status(400).send('Invalid message');
   const m=await lookupMessage(sid);
   if(m.from!=='+19733142419')return res.status(400).send('Unexpected sender');
   await saveSms(pool,{sid,direction:'outbound',from:m.from,to:m.to,body:clean(m.body),status:clean(req.body.MessageStatus||m.status,30),error:clean(req.body.ErrorCode,40)});
   res.status(200).send('OK');
  }catch{console.error('twilio_sms_status_failed');res.status(500).send('Unable to save message status');}
 });
}
