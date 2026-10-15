export const inboxSchema=`
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false;
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS handled_at timestamptz;
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS handled_by text;
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS alert_accepted_at timestamptz;
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS alert_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE processrite_sms_messages ADD COLUMN IF NOT EXISTS alert_next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS processrite_sms_attention_idx ON processrite_sms_messages(created_at) WHERE needs_attention=true AND handled_at IS NULL;`;

export function needsReply(body,optOutType){
 const keyword=String(optOutType||body||'').trim().toUpperCase();
 return !['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','START','UNSTOP','YES','HELP','INFO'].includes(keyword);
}

export function mountSmsInbox(app,{pool,limiter}){
 app.post('/api/leads/:id/sms/handled',limiter,async(req,res)=>{
  if(!req.user)return res.status(401).json({ok:false});
  if(!['admin','manager'].includes(req.user.role))return res.status(403).json({ok:false,message:'Administrator or manager access is required.'});
  const ids=req.body?.message_sids;
  if(!/^\d+$/.test(req.params.id)||!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(s=>!/^SM[a-f0-9]{32}$/i.test(s)))return res.status(400).json({ok:false,message:'Choose the received messages to mark handled.'});
  try{
   // Exact message IDs prevent a newer arrival being cleared by a stale screen.
   const result=await pool.query(`UPDATE processrite_sms_messages m SET handled_at=now(),handled_by=$3 FROM lead_submissions target,lead_submissions owner WHERE target.id=$1 AND owner.id=m.lead_id AND regexp_replace(regexp_replace(target.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','')=regexp_replace(regexp_replace(owner.phone,'[^0-9]','','g'),'^1(?=[0-9]{10}$)','') AND m.message_sid=ANY($2::text[]) AND m.direction='inbound' AND m.needs_attention=true AND m.handled_at IS NULL RETURNING m.message_sid`,[req.params.id,ids,String(req.user.id)]);
   return res.json({ok:true,handled:result.rows.length});
  }catch{console.error('sms_handle_failed');return res.status(500).json({ok:false,message:'Unable to mark replies handled.'});}
 });
}

export async function deliverSmsAlert({pool,env,send}){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const m=(await c.query(`SELECT m.*,l.name,l.business_name FROM processrite_sms_messages m JOIN lead_submissions l ON l.id=m.lead_id WHERE m.needs_attention=true AND m.alert_accepted_at IS NULL AND m.alert_attempts<6 AND m.alert_next_attempt_at<=now() ORDER BY m.created_at LIMIT 1 FOR UPDATE OF m SKIP LOCKED`)).rows[0];
  if(!m){await c.query('COMMIT');return false;}
  try{
   const result=await send({from:env.EMAIL_FROM,to:env.EMAIL_TO,messageId:`<processrite-sms-${m.message_sid}@processrite.com>`,subject:`Process Rite text reply: ${m.sender}`,text:[`New Process Rite text reply`,`From: ${m.sender}`,`Contact: ${m.name||'Not provided'}`,`Business: ${m.business_name||'Not provided'}`,`Received: ${new Date(m.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern Time`,'',m.body,'','Open Process Rite Leads to respond: https://portal.processrite.com/',`Message ID: ${m.message_sid}`].join('\n')});
   if(!result?.accepted?.length||result.rejected?.length)throw Error('Recipient not accepted');
   await c.query('UPDATE processrite_sms_messages SET alert_accepted_at=now(),alert_attempts=alert_attempts+1 WHERE message_sid=$1',[m.message_sid]);
  }catch{
   await c.query("UPDATE processrite_sms_messages SET alert_attempts=alert_attempts+1,alert_next_attempt_at=now()+($2 * interval '1 minute') WHERE message_sid=$1",[m.message_sid,Math.min(60,2**m.alert_attempts)]);
   console.error('sms_reply_alert_retry',{attempt:m.alert_attempts+1});
  }
  await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
