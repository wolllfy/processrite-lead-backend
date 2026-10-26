import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';

export const intakeSchema=z.object({
 event_id:z.string().regex(/^[a-f0-9]{64}$/), record_id:z.number().int().positive(),
 kind:z.enum(['seller','contact']), source:z.literal('https://residualmarket.com'),
 consent:z.object({granted:z.literal(true),at:z.string().datetime({offset:true}),version:z.string().min(1).max(80)}).strict(),
 contact:z.object({name:z.string().trim().min(2).max(120),company:z.string().trim().max(160),email:z.string().trim().email().max(160).transform(x=>x.toLowerCase()),phone:z.string().trim().min(7).max(40)}).strict(),
 message:z.string().trim().max(1600)
}).strict();
export function authorized(provided,key){
 if(typeof key!=='string'||key.length<32||typeof provided!=='string'||provided.length>512)return false;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(provided).digest(),crypto.createHash('sha256').update(key).digest());
}
export function portalLead(input){
 const p=intakeSchema.parse(input);
 return {name:p.contact.name,business_name:p.contact.company,phone:p.contact.phone,email:p.contact.email,
 business_type:p.kind==='seller'?'Residual portfolio acquisition':'Residual Market inquiry',
 monthly_processing_volume:'Not applicable - portfolio inquiry',current_processor:'',
 message:[`Residual Market reference RM-${p.record_id}`,`Explicit Process Rite sharing consent: ${p.consent.at} (${p.consent.version})`,p.message,'Financial portfolio details were not transmitted. Review only through the authorized Residual Market workflow.'].join('\n'),
 page_source:`https://residualmarket.com/${p.kind==='seller'?'sell':'contact'}/`};
}
export async function ensureResidualSchema(pool){
 if(!pool)throw Error('database_unavailable');
 await pool.query(`create table if not exists residual_market_ingest_events (
 event_id varchar(64) primary key,payload_hash varchar(64) not null,
 lead_id bigint references lead_submissions(id) on delete set null,
 consent_at timestamptz not null,consent_version varchar(80) not null,
 created_at timestamptz not null default now());`);
}
export function createResidualRouter({pool,getKey,isReady,notify=async()=>false,logger=console}){
 const router=express.Router();
 router.use(rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false}));
 router.use((req,res,next)=>{
  const key=getKey();if(!key||key.length<32)return res.status(503).json({ok:false,code:'integration_disabled'});
  if(!authorized(req.get('x-residual-market-key')||'',key))return res.status(401).json({ok:false,code:'unauthorized'});
  if(!pool||!isReady())return res.status(503).json({ok:false,code:'integration_not_ready'});next();
 });
 router.get('/status',async(_req,res)=>{try{await pool.query('select 1');res.json({ok:true,integration:'residual-market',scope:'lead-ingest-only'});}catch{res.status(503).json({ok:false,code:'database_unavailable'});}});
 router.post('/leads',async(req,res)=>{
  const parsed=intakeSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({ok:false,code:'invalid_payload'});
  const p=parsed.data;const hash=crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex');let client;
  try{
   client=await pool.connect();await client.query('begin');
   const claim=await client.query('insert into residual_market_ingest_events(event_id,payload_hash,consent_at,consent_version) values($1,$2,$3,$4) on conflict(event_id) do nothing returning event_id',[p.event_id,hash,p.consent.at,p.consent.version]);
   if(!claim.rowCount){const prior=await client.query('select lead_id,payload_hash from residual_market_ingest_events where event_id=$1',[p.event_id]);await client.query('rollback');
    const old=prior.rows[0];if(!old)return res.status(503).json({ok:false,code:'retry_later'});
    if(old.payload_hash!==hash)return res.status(409).json({ok:false,code:'idempotency_conflict'});
    if(!old.lead_id)return res.status(410).json({ok:false,code:'previously_processed_unavailable'});
    return res.status(200).json({ok:true,id:old.lead_id,duplicate:true});
   }
   const lead=portalLead(p);
   const stored=await client.query(`insert into lead_submissions(name,business_name,phone,email,business_type,monthly_processing_volume,current_processor,message,page_source,user_agent,ip_hash,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,[lead.name,lead.business_name,lead.phone,lead.email,lead.business_type,lead.monthly_processing_volume,lead.current_processor,lead.message,lead.page_source,'ResidualMarket server adapter','integration:residual-market','New']);
   const id=stored.rows[0].id;await client.query('update residual_market_ingest_events set lead_id=$1 where event_id=$2',[id,p.event_id]);await client.query('commit');
   let alert=false;try{alert=Boolean(await notify(lead,id));if(alert)await pool.query('update lead_submissions set email_alert_sent=true where id=$1',[id]);}catch{logger.warn('residual_market_alert_failed',{id});}
   logger.info('residual_market_lead_stored',{id});return res.status(201).json({ok:true,id,duplicate:false,email_alert_sent:alert});
  }catch(error){if(client){try{await client.query('rollback');}catch{}}logger.error('residual_market_ingest_failed',{code:error.code||'database_error'});return res.status(503).json({ok:false,code:'temporary_failure'});
  }finally{client?.release();}
 });return router;
}
