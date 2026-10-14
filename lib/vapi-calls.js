import crypto from 'node:crypto';

const text=(v,n=3000)=>String(v??'').slice(0,n);
const phoneKey=v=>text(v,60).replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
export const callSchema=`CREATE TABLE IF NOT EXISTS vapi_call_events (
 call_id text PRIMARY KEY, lead_id bigint REFERENCES lead_submissions(id), caller_phone text NOT NULL,
 started_at timestamptz, ended_at timestamptz, final_received boolean NOT NULL DEFAULT false,
 summary text NOT NULL DEFAULT '', duration text NOT NULL DEFAULT '', ended_reason text NOT NULL DEFAULT '',
 email_sent_at timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;

export function parseCallEvent(body) {
 const m=body?.message,call=m?.call;
 if(!m||!['status-update','end-of-call-report'].includes(m.type))return null;
 if(!call?.id||!/^[-\w]{6,100}$/.test(call.id))throw Error('Invalid call ID');
 if(call.type&&call.type!=='inboundPhoneCall')return null;
 if(call.assistantId!=='0cf76238-66ec-4f04-a3d6-c06a95b980cd')throw Error('Unexpected assistant');
 const date=v=>{const d=new Date(v);return v&&Number.isFinite(+d)?d.toISOString():null;};
 const start=date(m.startedAt||call.startedAt||call.createdAt),end=date(m.endedAt||call.endedAt);
 const final=m.type==='end-of-call-report';
 const transcript=text(m.artifact?.transcript||m.transcript,12000);
 const spoken=(m.artifact?.messages||m.messages||[]).filter(x=>x.role==='user').map(x=>text(x.message||x.content,1000)).join(' | ');
 const summary=text(m.analysis?.summary||m.summary||(spoken?`Caller said: ${spoken}`:'Incomplete call — callback needed. No caller details collected.'));
 const duration=Number.isFinite(Number(m.durationSeconds))?`${Math.max(0,Number(m.durationSeconds))} seconds`:start&&end?`${Math.max(0,Math.round((+new Date(end)-+new Date(start))/1000))} seconds`:'';
 return {id:call.id,phone:text(call.customer?.number||m.customer?.number||'Withheld / unavailable',60),start,end:final||m.status==='ended'?end||new Date().toISOString():null,final,summary,transcript,duration,reason:text(m.endedReason||call.endedReason||m.status,160)};
}

export async function findOrCreateVoiceLead(client,{phone,name='',summary='',callId=''}) {
 const key=phoneKey(phone)||callId;
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`voice:${key}`]);
 const found=phoneKey(phone)?await client.query(`SELECT id FROM lead_submissions WHERE regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','')=$1 AND lower(lead_source) LIKE '%vapi%' AND coalesce(archived,false)=false ORDER BY id DESC LIMIT 1`,[phoneKey(phone)]):{rows:[]};
 if(found.rows[0])return found.rows[0].id;
 const r=await client.query(`INSERT INTO lead_submissions(name,business_name,phone,email,business_type,monthly_processing_volume,monthly_volume,lead_source,page_source,source_url,status,priority,summary,sms_consent)
 VALUES($1,'',$2,'no-email@processrite.local','Not provided','Not provided','Not provided','Vapi','vapi-phone-call','vapi-phone-call','New','Medium',$3,false) RETURNING id`,[name||'Unknown caller — callback needed',phone,summary]);
 return r.rows[0].id;
}

export async function storeCallEvent(pool,event) {
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`call:${event.id}`]);
  const old=await c.query('SELECT * FROM vapi_call_events WHERE call_id=$1 FOR UPDATE',[event.id]);
  const leadId=old.rows[0]?.lead_id||await findOrCreateVoiceLead(c,{phone:event.phone,summary:event.summary,callId:event.id});
  if(old.rows[0]?.final_received&&!event.final){await c.query('COMMIT');return leadId;}
  await c.query(`INSERT INTO vapi_call_events(call_id,lead_id,caller_phone,started_at,ended_at,final_received,summary,duration,ended_reason)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(call_id) DO UPDATE SET
   ended_at=coalesce(EXCLUDED.ended_at,vapi_call_events.ended_at), final_received=vapi_call_events.final_received OR EXCLUDED.final_received,
   summary=CASE WHEN EXCLUDED.final_received THEN EXCLUDED.summary ELSE vapi_call_events.summary END,
   duration=CASE WHEN EXCLUDED.duration<>'' THEN EXCLUDED.duration ELSE vapi_call_events.duration END,
   ended_reason=EXCLUDED.ended_reason,updated_at=now()`,[event.id,leadId,event.phone,event.start,event.end,event.final,event.summary,event.duration,event.reason]);
  if(event.final)await c.query(`UPDATE lead_submissions SET summary=$2,transcript=CASE WHEN $3<>'' THEN $3 ELSE transcript END,call_duration=$4,call_date=$5,call_type='Inbound call',updated_at=now() WHERE id=$1`,[leadId,event.summary,event.transcript,event.duration,event.start||'']);
  await c.query('COMMIT');return leadId;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function deliverCallAlerts({pool,send,env}) {
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const r=await c.query(`SELECT * FROM vapi_call_events WHERE email_sent_at IS NULL AND next_attempt_at<=now() AND (final_received OR ended_at<now()-interval '60 seconds') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
  const call=r.rows[0];if(!call){await c.query('COMMIT');return false;}
  try {
   await send({from:env.EMAIL_FROM,to:env.EMAIL_TO,subject:`Process Rite call: ${call.caller_phone}`,
    text:[`Incoming Process Rite call`,`Caller: ${call.caller_phone}`,`Started: ${call.started_at?new Date(call.started_at).toLocaleString('en-US',{timeZone:'America/New_York'}):'Not available'} Eastern Time`,`Duration: ${call.duration||'Not available'}`,`Ended: ${call.ended_reason||'Not available'}`,'',call.summary,'','Unqualified call activity. Review details before sales follow-up.',`Call ID: ${call.call_id}`,`Open lead in Process Rite CRM: https://portal.processrite.com/`].join('\n')});
   await c.query('UPDATE vapi_call_events SET email_sent_at=now(),attempts=attempts+1 WHERE call_id=$1',[call.call_id]);
   await c.query('UPDATE lead_submissions SET email_alert_sent=true WHERE id=$1',[call.lead_id]);
  }catch {
   await c.query("UPDATE vapi_call_events SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE call_id=$1",[call.call_id]);
   console.error('vapi_call_email_retry_scheduled',{callId:call.call_id});
  }
  await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export function mountVapiCalls(app,{pool,env,send}) {
 app.post('/api/vapi/events',async(req,res)=>{
  const expected=env.VAPI_WEBHOOK_SECRET,provided=req.get('x-vapi-secret')||'';
  if(!expected||Buffer.byteLength(provided)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return res.status(401).json({ok:false});
  try{const event=parseCallEvent(req.body);if(event)await storeCallEvent(pool,event);res.status(200).json({ok:true});}
  catch(e){console.error('vapi_event_failed',{message:e.message});res.status(e.message==='Invalid call ID'||e.message==='Unexpected assistant'?400:500).json({ok:false});}
 });
 const timer=setInterval(()=>deliverCallAlerts({pool,env,send}).catch(()=>console.error('vapi_call_alert_worker_failed')),10000);timer.unref();
 return ()=>clearInterval(timer);
}
