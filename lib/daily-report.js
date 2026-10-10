import nodemailer from "nodemailer";
export const reportRecipient = "muheisenone@outlook.com";
export function easternReportDay(now = new Date()) {
 const p=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const get=k=>p.find(v=>v.type===k).value;
 return {date:`${get("year")}-${get("month")}-${get("day")}`,due:Number(get("hour"))>=21};
}
const clean=value=>String(value||"Not provided").replace(/[\r\n\t]/g," ").slice(0,160);
export async function processRiteReport(pool,now=new Date()) {
 const since=new Date(now.getTime()-86400000);
 const [totals,stages,sources,recent,followups]=await Promise.all([
  pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE created_at >= $1)::int recent,count(*) FILTER(WHERE coalesce(email_alert_sent,false)=false)::int email_alerts_unconfirmed,count(*) FILTER(WHERE coalesce(status,'New')='New')::int awaiting_first_contact FROM lead_submissions WHERE coalesce(archived,false)=false",[since]),
  pool.query("SELECT coalesce(nullif(status,''),'New') stage,count(*)::int count FROM lead_submissions WHERE coalesce(archived,false)=false GROUP BY 1 ORDER BY 1"),
  pool.query("SELECT coalesce(nullif(lead_source,''),nullif(page_source,''),'Unknown') source,coalesce(page_source,'') page_label,coalesce(nullif(source_url,''),page_source,'') page,count(*)::int count FROM lead_submissions WHERE created_at >= $1 AND coalesce(archived,false)=false GROUP BY 1,2,3 ORDER BY count DESC LIMIT 30",[since]),
  pool.query("SELECT business_name,status,monthly_processing_volume,lead_source,page_source,source_url,assigned_to,follow_up_date FROM lead_submissions WHERE created_at >= $1 AND coalesce(archived,false)=false ORDER BY created_at DESC LIMIT 25",[since]),
  pool.query("SELECT business_name,assigned_to,follow_up_date FROM lead_submissions WHERE coalesce(archived,false)=false AND coalesce(status,'') NOT IN ('Won','Lost') AND coalesce(follow_up_date,'')<>'' ORDER BY follow_up_date LIMIT 25"),
 ]);
 const stats=totals.rows[0];
 return [
  `Process Rite daily report — ${easternReportDay(now).date}`,
  `Generated: ${now.toLocaleString("en-US",{timeZone:"America/New_York"})} Eastern Time`,
  "Process Rite CRM only. Recent activity covers the last 24 hours. Muheisen Portal data is not queried.","",
  `Active leads: ${stats.total}`,`New submissions in last 24 hours: ${stats.recent}`,`Awaiting first contact: ${stats.awaiting_first_contact}`,`Lead email alerts not marked sent: ${stats.email_alerts_unconfirmed}`,
  "","PIPELINE",...stages.rows.map(r=>`${clean(r.stage)}: ${r.count}`),
  "","LEAD SOURCES AND PAGES — LAST 24 HOURS (up to 30)",...sources.rows.map(r=>`- ${clean(r.source)} | ${clean(r.page_label)} | ${clean(r.page)}: ${r.count}`),...(sources.rows.length?[]:["No new submissions recorded"]),
  "","RECENT LEADS (up to 25)",...recent.rows.map(r=>`- ${clean(r.business_name)} | ${clean(r.status||"New")} | volume ${clean(r.monthly_processing_volume)} | owner ${clean(r.assigned_to)} | source ${clean(r.lead_source||r.page_source)} | page label ${clean(r.page_source)} | page ${clean(r.source_url||r.page_source)}`),
  "","FOLLOW-UP DATES TO REVIEW (up to 25)",...followups.rows.map(r=>`- ${clean(r.business_name)} | owner ${clean(r.assigned_to)} | follow-up ${clean(r.follow_up_date)}`),...(followups.rows.length?[]:["No follow-up dates recorded"]),
  "","Follow-up dates are displayed as recorded; legacy dates are not silently converted. Email-alert flags do not prove inbox delivery. Pipeline totals are current stages, not historical conversion rates. This report does not monitor commissions, residuals, backups or website uptime.",
  "Passwords, contact phone/email details, transcripts and payment-card data are excluded.","","Open CRM: https://portal.processrite.com/",
 ].join("\n");
}
export async function deliverProcessRiteReport({pool,env,now=new Date(),test=false,actorId=null,send}) {
 const day=easternReportDay(now).date;
 const key=test?`processrite_report:test:${Math.floor(now.getTime()/60000)}`:`processrite_report:daily:${day}`;
 const client=await pool.connect();
 try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(21903651)");
  const existing=await client.query("SELECT id FROM crm_access_events WHERE action=$1 LIMIT 1",[`${key}:claimed`]);
  if(existing.rows.length){await client.query("ROLLBACK");return {skipped:true};}
  await client.query("INSERT INTO crm_access_events(actor_id,action) VALUES($1,$2)",[actorId,`${key}:claimed`]);
  await client.query("COMMIT");
 } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
 try {
  const text=await processRiteReport(pool,now);
  const subject=`${test?"TEST — ":""}Process Rite daily report — ${day}`;
  if(send)await send({subject,text});
  else {
   const mailer=nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT),secure:Number(env.SMTP_PORT)===465,requireTLS:Number(env.SMTP_PORT)!==465,family:4,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},tls:{rejectUnauthorized:true,minVersion:"TLSv1.2"},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,logger:false,debug:false});
   try {const result=await mailer.sendMail({from:env.EMAIL_FROM,to:reportRecipient,subject,text,disableFileAccess:true,disableUrlAccess:true});if(!result.accepted?.includes(reportRecipient))throw Error("Not accepted");}finally{mailer.close();}
  }
  await pool.query("INSERT INTO crm_access_events(actor_id,action) VALUES($1,$2)",[actorId,`${key}:accepted`]);
  return {accepted:true};
 }catch{
  await pool.query("INSERT INTO crm_access_events(actor_id,action) VALUES($1,$2)",[actorId,`${key}:failed_or_unconfirmed`]);
  console.error("processrite_daily_report_failed_or_unconfirmed");
  throw Object.assign(Error("Report delivery failed or is unconfirmed. Review Outlook before retrying."),{status:502});
 }
}
export function mountProcessRiteReports(app,{pool,env,limiter}) {
 const enabled=()=>env.PROCESSRITE_DAILY_REPORT_ENABLED!=="false";
 app.get("/api/reports/daily",async(req,res)=>{
  if(req.user?.role!=="admin")return res.status(403).json({ok:false,message:"Administrator access required."});
  try {const history=await pool.query("SELECT action,created_at FROM crm_access_events WHERE action LIKE 'processrite_report:%' ORDER BY id DESC LIMIT 15");res.json({ok:true,enabled:enabled(),time:"9 PM America/New_York",recipient:reportRecipient,sender:env.EMAIL_FROM,history:history.rows});}
  catch{res.status(500).json({ok:false,message:"Could not load report status."});}
 });
 app.post("/api/reports/daily/test",limiter,async(req,res)=>{
  if(req.user?.role!=="admin")return res.status(403).json({ok:false,message:"Administrator access required."});
  try{res.json({ok:true,...await deliverProcessRiteReport({pool,env,test:true,actorId:req.user.id})});}catch(error){res.status(error.status||500).json({ok:false,message:"Report delivery failed or is unconfirmed. Review Outlook before retrying."});}
 });
 let running=false;
 const tick=async()=>{if(running||!enabled()||!easternReportDay().due)return;running=true;try{await deliverProcessRiteReport({pool,env});}catch{console.error("processrite_daily_report_worker_failed");}finally{running=false;}};
 const timer=setInterval(()=>{void tick();},60000);timer.unref();
 const startup=setTimeout(()=>{void tick();},15000);startup.unref();
 return ()=>{clearInterval(timer);clearTimeout(startup);};
}

