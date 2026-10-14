import crypto from 'node:crypto';
import {z} from 'zod';

const text=(v,n=3000)=>String(v??'').slice(0,n);
const phoneKey=v=>text(v,60).replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
const intakeSchema=z.object({name:z.string().trim().min(1).max(120),phone:z.string().trim().min(7).max(40).refine(v=>phoneKey(v).length>=7),business_name:z.string().max(160).optional(),email:z.preprocess(v=>v===''?undefined:v,z.string().email().optional()),summary:z.string().max(3000).optional(),message:z.string().max(3000).optional(),business_type:z.string().max(120).optional(),current_processor:z.string().max(160).optional(),monthly_processing_volume:z.string().max(120).optional(),call_type:z.enum(['support','sales','general']).default('general'),priority:z.enum(['Low','Medium','High','Urgent']).default('Medium')});

// Only the authenticated provider envelope supplies correlation; the model cannot invent it.
export async function saveVoiceTool(pool,body) {
 const m=body?.message,call=m?.call;
 if(m?.type!=='tool-calls'||call?.assistantId!=='0cf76238-66ec-4f04-a3d6-c06a95b980cd'||call?.type!=='inboundPhoneCall'||!/^[-\w]{6,100}$/.test(call?.id||''))throw Error('Invalid tool envelope');
 const tools=m.toolCallList;
 if(!Array.isArray(tools)||tools.length!==1||tools[0]?.function?.name!=='LogLead'||!/^[-\w]{1,100}$/.test(tools[0]?.id||''))throw Error('Invalid tool envelope');
 const raw=tools[0].function.arguments;
 const lead=intakeSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
 const c=await pool.connect();
 try {
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`call:${call.id}`]);
  const previous=await c.query('SELECT * FROM vapi_call_events WHERE call_id=$1 FOR UPDATE',[call.id]);
  let id=previous.rows[0]?.lead_id;
  if(id){const row=(await c.query('SELECT name,phone FROM lead_submissions WHERE id=$1',[id])).rows[0];if(row&&!row.name.startsWith('Unknown caller')&&phoneKey(row.phone)!==phoneKey(lead.phone))id=null;}
  id=id||await findOrCreateVoiceLead(c,{phone:lead.phone,name:lead.name,summary:lead.summary,callId:call.id});
  await c.query(`UPDATE lead_submissions SET name=$2,phone=$3,business_name=coalesce($4,business_name),email=coalesce($5,email),summary=coalesce($6,summary),message=coalesce($7,message),business_type=coalesce($8,business_type),current_processor=coalesce($9,current_processor),monthly_processing_volume=coalesce($10,monthly_processing_volume),monthly_volume=coalesce($10,monthly_volume),call_type=$11,priority=$12,updated_at=now() WHERE id=$1`,[id,lead.name,lead.phone,lead.business_name,lead.email,lead.summary,lead.message,lead.business_type,lead.current_processor,lead.monthly_processing_volume,lead.call_type,lead.priority]);
  if(previous.rows[0]?.final_received)await c.query(`UPDATE lead_submissions SET call_duration=$2,call_date=$3,transcript=coalesce((SELECT transcript FROM lead_submissions WHERE id=$4),transcript),email_alert_sent=$5 WHERE id=$1`,[id,previous.rows[0].duration,previous.rows[0].started_at?new Date(previous.rows[0].started_at).toISOString():'',previous.rows[0].lead_id,Boolean(previous.rows[0].email_sent_at)]);
  await c.query(`INSERT INTO vapi_call_events(call_id,lead_id,caller_phone) VALUES($1,$2,$3) ON CONFLICT(call_id) DO UPDATE SET lead_id=EXCLUDED.lead_id,updated_at=now()`,[call.id,id,text(call.customer?.number||'Withheld / unavailable',60)]);
  await c.query('COMMIT');return {results:[{toolCallId:tools[0].id,result:JSON.stringify({ok:true,leadId:String(id),message:'Request saved; notification awaits call completion.'})}]};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
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
   started_at=coalesce(vapi_call_events.started_at,EXCLUDED.started_at),
   ended_at=coalesce(EXCLUDED.ended_at,vapi_call_events.ended_at), final_received=vapi_call_events.final_received OR EXCLUDED.final_received,
   summary=CASE WHEN EXCLUDED.final_received THEN EXCLUDED.summary ELSE vapi_call_events.summary END,
   duration=CASE WHEN EXCLUDED.duration<>'' THEN EXCLUDED.duration ELSE vapi_call_events.duration END,
   ended_reason=EXCLUDED.ended_reason,updated_at=now()`,[event.id,leadId,event.phone,event.start,event.end,event.final,event.summary,event.duration,event.reason]);
  if(event.final)await c.query(`UPDATE lead_submissions SET summary=$2,transcript=CASE WHEN $3<>'' THEN $3 ELSE transcript END,call_duration=$4,call_date=$5,call_type=CASE WHEN coalesce(call_type,'')='' THEN 'Inbound call' ELSE call_type END,updated_at=now() WHERE id=$1`,[leadId,event.summary,event.transcript,event.duration,event.start||'']);
  await c.query('COMMIT');return leadId;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function deliverCallAlerts({pool,send,env}) {
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const r=await c.query(`SELECT v.*,l.phone AS callback_phone,l.name AS contact_name,l.priority,l.call_type FROM vapi_call_events v JOIN lead_submissions l ON l.id=v.lead_id WHERE v.email_sent_at IS NULL AND v.attempts<6 AND v.next_attempt_at<=now() AND (v.final_received OR v.ended_at<now()-interval '60 seconds') ORDER BY v.created_at LIMIT 1 FOR UPDATE OF v SKIP LOCKED`);
  const call=r.rows[0];if(!call){await c.query('COMMIT');return false;}
  try {
   const result=await send({from:env.EMAIL_FROM,to:env.EMAIL_TO,messageId:`<processrite-call-${crypto.createHash('sha256').update(call.call_id).digest('hex')}@processrite.com>`,subject:`Process Rite call: ${call.caller_phone}`,
    text:[`Incoming Process Rite call`,`Caller ID: ${call.caller_phone}`,`Callback: ${call.callback_phone}`,`Contact: ${call.contact_name}`,`Request type: ${call.call_type||'Unclassified'}`,`Priority: ${call.priority}`,`Started: ${call.started_at?new Date(call.started_at).toLocaleString('en-US',{timeZone:'America/New_York'}):'Not available'} Eastern Time`,`Duration: ${call.duration||'Not available'}`,`Ended: ${call.ended_reason||'Not available'}`,'',call.summary,'','Call activity is not automatic sales qualification. Review details before follow-up.',`Call ID: ${call.call_id}`,`Open lead in Process Rite CRM: https://portal.processrite.com/`].join('\n')});
   if(!Array.isArray(result?.accepted)||result.accepted.length===0||result.rejected?.length)throw Error('SMTP recipient not accepted');
   await c.query('UPDATE vapi_call_events SET email_sent_at=now(),attempts=attempts+1 WHERE call_id=$1',[call.call_id]);
   await c.query('UPDATE lead_submissions SET email_alert_sent=true WHERE id=$1',[call.lead_id]);
  }catch {
   const delay=Math.min(60,5*2**call.attempts);
   await c.query("UPDATE vapi_call_events SET attempts=attempts+1,next_attempt_at=now()+($2 * interval '1 minute') WHERE call_id=$1",[call.call_id,delay]);
   console.error(call.attempts>=5?'vapi_call_email_failed':'vapi_call_email_retry_scheduled',{callId:call.call_id,attempt:call.attempts+1});
  }
  await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function attachCallStatus(pool,rows) {
 if(!rows.length)return rows;
 const events=(await pool.query('SELECT call_id,lead_id,email_sent_at,attempts,final_received,ended_at FROM vapi_call_events WHERE lead_id=ANY($1::bigint[]) ORDER BY created_at DESC',[rows.map(r=>r.id)])).rows;
 return rows.map(row=>{const call=events.find(c=>String(c.lead_id)===String(row.id));return {...row,voice_notification:call?{call_id:call.call_id,status:call.email_sent_at?'provider_accepted':call.attempts>=6?'failed':call.attempts?'retry_pending':call.final_received||call.ended_at?'queued':'awaiting_completion',attempts:call.attempts,provider_accepted_at:call.email_sent_at}:null};});
}

export function mountVapiCalls(app,{pool,env,send}) {
 const authenticated=req=>{const expected=env.VAPI_WEBHOOK_SECRET,provided=req.get('x-vapi-secret')||req.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]||'';return Boolean(expected&&Buffer.byteLength(provided)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected)));};
 // Preserve the existing API Request tool; static fields are resolved by Vapi, outside the LLM schema.
 app.post('/api/vapi/lead',async(req,res)=>{
  if(!authenticated(req)){const supplied=req.get('x-vapi-secret')||'';console.error('vapi_lead_auth_rejected',{secretHeaderPresent:Boolean(supplied),authorizationPresent:Boolean(req.get('authorization')),secretLength:supplied.length,expectedLength:(env.VAPI_WEBHOOK_SECRET||'').length,bearerPrefix:/^Bearer /i.test(supplied),maskedValue:/^[*•]+$/.test(supplied)});return res.status(401).json({ok:false,code:'authentication_failed'});}
  try {
   const body=req.body||{};
   const args={...body,monthly_processing_volume:body.monthly_processing_volume||body.monthly_volume};
   const saved=await saveVoiceTool(pool,{message:{type:'tool-calls',call:{id:body.call_id,assistantId:body.assistant_id,type:body.call_type_provider,customer:{number:body.caller_number}},toolCallList:[{id:'LogLead',function:{name:'LogLead',arguments:args}}]}});
   return res.status(201).json(JSON.parse(saved.results[0].result));
  }catch(e){const invalid=e instanceof z.ZodError||e instanceof SyntaxError||e.message==='Invalid tool envelope';const code=invalid?'invalid_payload':'storage_failure';console.error('vapi_lead_failed',{code,fields:e instanceof z.ZodError?e.issues.map(i=>i.path.join('.')):undefined});return res.status(invalid?400:500).json({ok:false,code});}
 });
 app.post('/api/vapi/events',async(req,res)=>{
  if(!authenticated(req))return res.status(401).json({ok:false});
  try{if(req.body?.message?.type==='tool-calls')return res.status(200).json(await saveVoiceTool(pool,req.body));const event=parseCallEvent(req.body);if(event)await storeCallEvent(pool,event);res.status(200).json({ok:true});}
  catch(e){const invalid=e instanceof z.ZodError||e instanceof SyntaxError||['Invalid call ID','Unexpected assistant','Invalid tool envelope'].includes(e.message);console.error('vapi_event_failed',{code:invalid?'invalid_payload':'storage_failure'});res.status(invalid?400:500).json({ok:false});}
 });
 const timer=setInterval(()=>deliverCallAlerts({pool,env,send}).catch(()=>console.error('vapi_call_alert_worker_failed')),10000);timer.unref();
 return ()=>clearInterval(timer);
}
