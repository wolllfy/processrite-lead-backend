import {phoneKey,smsPreferences} from './sms-consent.js';
export {smsSendSchema} from './sms-consent.js';
import {saveSms} from './twilio-sms.js';

export const supportService='MG5dd3dcebe7f4594390ee54748392087a';
export function sendPolicy(env){return {promotions_enabled:env.PROCESSRITE_PROMO_APPROVED==='true'&&/^MG[a-f0-9]{32}$/i.test(env.TWILIO_PROMO_SERVICE_SID||'')};}
export function smsBody(body){const text=String(body||'').trim();if(!text||text.length>900)throw Object.assign(Error('Enter a message of 1–900 characters.'),{status:400});return `Process Rite: ${text}\nReply STOP to opt out or HELP for help.`;}

export async function sendLeadSms(pool,env,createMessage,{leadId,purpose,body,requestId,actorId}) {
 if(!['support','promotions'].includes(purpose)||!/^\d+$/.test(String(leadId))||!/^[a-f0-9-]{36}$/i.test(requestId||''))throw Object.assign(Error('Invalid text request.'),{status:400});
 const rendered=smsBody(body),client=await pool.connect();
 let intent;
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sms-send:${requestId}`]);
  const previous=(await client.query('SELECT * FROM processrite_sms_sends WHERE request_id=$1',[requestId])).rows[0];
  if(previous){
   if(String(previous.lead_id)!==String(leadId)||previous.purpose!==purpose||previous.body!==rendered)throw Object.assign(Error('This request ID already belongs to a different message.'),{status:409});
   await client.query('COMMIT');return {ok:!!previous.message_sid,status:previous.status,message_sid:previous.message_sid||null,replayed:true};
  }
  const lead=(await client.query('SELECT * FROM lead_submissions WHERE id=$1 AND coalesce(archived,false)=false',[leadId])).rows[0];
  if(!lead)throw Object.assign(Error('Lead not found.'),{status:404});
  const phone=phoneKey(lead.phone);if(!/^\d{10}$/.test(phone))throw Object.assign(Error('A valid US mobile number is required.'),{status:400});
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sms-preference:${phone}`]);
  const [consent]=await smsPreferences(client,[lead]);
  if(consent.sms_preferences.opted_out)throw Object.assign(Error('This number opted out. No message was sent.'),{status:409});
  if(!consent.sms_preferences[purpose].granted)throw Object.assign(Error(`No ${purpose==='promotions'?'promotional':'support'} text consent is recorded. No message was sent.`),{status:409});
  if(purpose==='promotions'&&!sendPolicy(env).promotions_enabled)throw Object.assign(Error('Promotional sends are waiting for carrier-approved registration. No message was sent.'),{status:409});
  if(purpose==='promotions') {
   const sent=(await client.query("SELECT count(*)::int n FROM processrite_sms_sends WHERE recipient=$1 AND purpose='promotions' AND status<>'failed' AND created_at>=date_trunc('month',now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'",['+1'+phone])).rows[0].n;
   if(sent>=4)throw Object.assign(Error('This number has reached its four-promotional-text monthly limit.'),{status:409});
  }
  intent=(await client.query('INSERT INTO processrite_sms_sends(request_id,lead_id,actor_id,purpose,recipient,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[requestId,leadId,String(actorId),purpose,'+1'+phone,rendered])).rows[0];
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 // Persist intent before contacting Twilio. Ambiguous failures are not automatically retried.
 try {
  const result=await createMessage({to:intent.recipient,messagingServiceSid:purpose==='promotions'?env.TWILIO_PROMO_SERVICE_SID:supportService,body:intent.body,statusCallback:'https://processrite-lead-backend.onrender.com/api/twilio/sms/status'});
  await pool.query('UPDATE processrite_sms_sends SET message_sid=$2,status=$3,updated_at=now() WHERE request_id=$1',[requestId,result.sid,result.status]);
  await saveSms(pool,{sid:result.sid,direction:'outbound',from:'+19733142419',to:intent.recipient,body:intent.body,status:result.status});
  return {ok:true,message_sid:result.sid,status:result.status,replayed:false};
 }catch(error){
  const definite=Number.isInteger(error.status)&&error.status>=400&&error.status<500;
  const status=definite?'failed':'needs_review';
  await pool.query('UPDATE processrite_sms_sends SET status=$2,error_code=$3,updated_at=now() WHERE request_id=$1',[requestId,status,String(error.code||'unknown').slice(0,40)]).catch(()=>{});
  throw Object.assign(Error(definite?'Twilio rejected this message. Check its delivery history.':'Send result needs review. Do not resend until the Twilio log is checked.'),{status:502});
 }
}

export function mountSmsSend(app,{pool,env,createMessage,limiter}) {
 app.get('/api/sms/config',(req,res)=>req.user?res.json({ok:true,...sendPolicy(env)}):res.status(401).json({ok:false}));
 app.post('/api/leads/:id/sms',limiter,async(req,res)=>{
  if(!req.user)return res.status(401).json({ok:false,message:'Sign in first.'});
  if(!['admin','manager'].includes(req.user.role))return res.status(403).json({ok:false,message:'Administrator or manager access is required to send texts.'});
  try{res.json(await sendLeadSms(pool,env,createMessage,{leadId:req.params.id,purpose:req.body?.purpose,body:req.body?.body,requestId:req.body?.request_id,actorId:req.user.id}));}
  catch(e){res.status(e.status||500).json({ok:false,message:e.status?e.message:'Unable to send this message.'});}
 });
}
