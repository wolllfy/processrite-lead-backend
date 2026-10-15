import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';
import {deliverSmsAlert,mountSmsInbox} from '../lib/sms-inbox.js';
import {smsSchema,saveSms,attachSms,mountTwilioSms} from '../lib/twilio-sms.js';
let db,pool;
const sid='SM'+'a'.repeat(32),env={TWILIO_AUTH_TOKEN:'test-token-only',TWILIO_ACCOUNT_SID:'AC'+'b'.repeat(32)};
const message={sid,direction:'inbound',from:'+19735550194',to:'+19733142419',body:'Please call about my support enquiry.',status:'received'};
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec(smsSchema);const query=(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(s,a);pool={query,connect:async()=>({query,release(){}})};},20000);
afterAll(()=>db.close());beforeEach(()=>db.exec('TRUNCATE processrite_sms_messages,processrite_sms_optouts,processrite_sms_preferences,processrite_sms_consent_events,lead_submissions RESTART IDENTITY CASCADE'));
it('deduplicates incoming texts and shows them in existing Leads message detail',async()=>{
 await saveSms(pool,message);await saveSms(pool,message);const rows=(await pool.query('SELECT * FROM lead_submissions')).rows;expect(rows).toHaveLength(1);expect(rows[0].sms_consent).toBe(false);const visible=await attachSms(pool,rows);expect(visible[0].message).toContain('SMS conversation');expect(visible[0].message).toContain(message.body);expect((await pool.query('SELECT * FROM processrite_sms_messages')).rows).toHaveLength(1);
});
it('uses an existing opted-in website lead without duplicating or changing its stage',async()=>{
 await pool.query("INSERT INTO lead_submissions(name,phone,email,business_type,monthly_processing_volume,lead_source,status,sms_consent) VALUES('Customer','9735550194','owner@example.test','Bagel shop','10000','Website Form','Qualified',true)");await saveSms(pool,message);const lead=(await pool.query('SELECT * FROM lead_submissions')).rows[0];expect(lead.status).toBe('Qualified');expect(lead.sms_consent).toBe(true);expect(lead.lead_source).toBe('Website Form + SMS');expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
it('records STOP and explicit resubscription keywords',async()=>{
 await saveSms(pool,{...message,body:'STOP',optOutType:'STOP'});expect((await pool.query('SELECT * FROM processrite_sms_optouts')).rows[0].opted_out).toBe(true);expect((await pool.query('SELECT sms_consent FROM lead_submissions')).rows[0].sms_consent).toBe(false);
 await saveSms(pool,{...message,sid:'SM'+'c'.repeat(32),body:'START',optOutType:'START'});expect((await pool.query('SELECT * FROM processrite_sms_optouts')).rows[0].opted_out).toBe(false);
});
it('does not regress delivered status when a delayed sent callback arrives',async()=>{
 await saveSms(pool,{...message,direction:'outbound',from:message.to,to:message.from,status:'delivered'});await saveSms(pool,{...message,direction:'outbound',from:message.to,to:message.from,status:'sent'});expect((await pool.query('SELECT * FROM processrite_sms_messages')).rows[0].delivery_status).toBe('delivered');
});
it('verifies Twilio signatures and rejects unauthenticated or wrong-line messages',async()=>{
 const app=express();app.use(express.urlencoded({extended:false}));mountTwilioSms(app,{pool,env,lookupMessage:async()=>({})});
 const path='/api/twilio/sms',body={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,From:message.from,To:message.to,Body:message.body};
 const sign=b=>twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,'https://processrite-lead-backend.onrender.com'+path,b);
 expect((await request(app).post(path).type('form').send(body)).status).toBe(403);expect((await request(app).post(path).set('x-twilio-signature',sign(body)).type('form').send(body)).status).toBe(200);
 const wrong={...body,To:'+19735550199'};expect((await request(app).post(path).set('x-twilio-signature',sign(wrong)).type('form').send(wrong)).status).toBe(400);
});
it('HELP and ordinary enquiries do not grant text marketing consent; Unicode survives',async()=>{
 await saveSms(pool,{...message,body:'HELP'});await saveSms(pool,{...message,sid:'SM'+'d'.repeat(32),body:'Support — café equipment ☕'});
 const rows=(await pool.query('SELECT * FROM lead_submissions')).rows;expect(rows[0].sms_consent).toBe(false);expect((await attachSms(pool,rows))[0].message).toContain('café equipment ☕');expect((await pool.query('SELECT * FROM processrite_sms_optouts')).rows).toHaveLength(0);
});
it('retains carrier failure code and a delivered message cannot regress to a failed callback',async()=>{
 const outbound={...message,direction:'outbound',from:message.to,to:message.from};await saveSms(pool,{...outbound,status:'undelivered',error:'30034'});let rows=(await pool.query('SELECT * FROM lead_submissions')).rows;expect((await attachSms(pool,rows))[0].message).toContain('error 30034');
 await saveSms(pool,{...outbound,status:'delivered'});await saveSms(pool,{...outbound,status:'failed',error:'21610'});expect((await pool.query('SELECT * FROM processrite_sms_messages')).rows[0].delivery_status).toBe('delivered');
});
it('authenticates delivery callbacks and shows delivered outbound texts in the same CRM thread',async()=>{
 await saveSms(pool,message);const app=express();app.use(express.urlencoded({extended:false}));mountTwilioSms(app,{pool,env,lookupMessage:async()=>({from:message.to,to:message.from,body:'Synthetic support reply',status:'delivered'})});
 const path='/api/twilio/sms/status',body={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:'SM'+'e'.repeat(32),MessageStatus:'delivered'};const sign=twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,'https://processrite-lead-backend.onrender.com'+path,body);
 expect((await request(app).post(path).type('form').send(body)).status).toBe(403);expect((await request(app).post(path).set('x-twilio-signature',sign).type('form').send(body)).status).toBe(200);
 const rows=(await pool.query('SELECT * FROM lead_submissions')).rows;expect(rows).toHaveLength(1);expect((await attachSms(pool,rows))[0].message).toContain('outbound | delivered');
});
it('rejects tampered text bodies and returns retryable errors for database outages',async()=>{
 const app=express();app.use(express.urlencoded({extended:false}));mountTwilioSms(app,{pool:{connect:async()=>{throw Error('Synthetic outage');}},env,lookupMessage:async()=>({})});
 const path='/api/twilio/sms',body={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,From:message.from,To:message.to,Body:message.body};const sign=twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,'https://processrite-lead-backend.onrender.com'+path,body);
 expect((await request(app).post(path).set('x-twilio-signature',sign).type('form').send({...body,Body:'Tampered'})).status).toBe(403);expect((await request(app).post(path).set('x-twilio-signature',sign).type('form').send(body)).status).toBe(500);
});
it('records sender-selection failures only for a known outbound message and matching recipient',async()=>{
 const outbound={...message,direction:'outbound',from:message.to,to:message.from,status:'accepted'};
 await saveSms(pool,outbound);
 let provider={from:null,to:message.from,status:'failed',errorCode:21703};
 const app=express();app.use(express.urlencoded({extended:false}));mountTwilioSms(app,{pool,env,lookupMessage:async()=>provider});
 const path='/api/twilio/sms/status';
 const post=async(id)=>{const body={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:id,MessageStatus:'failed',ErrorCode:'21703'};return request(app).post(path).set('x-twilio-signature',twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,'https://processrite-lead-backend.onrender.com'+path,body)).type('form').send(body);};
 expect((await post(sid)).status).toBe(200);
 expect((await pool.query('SELECT delivery_status,error_code FROM processrite_sms_messages WHERE message_sid=$1',[sid])).rows[0]).toEqual({delivery_status:'failed',error_code:'21703'});
 expect((await post('SM'+'f'.repeat(32))).status).toBe(400);
 provider={...provider,to:'+19735550199'};expect((await post(sid)).status).toBe(400);
 provider={...provider,to:message.from,status:'delivered'};expect((await post(sid)).status).toBe(400);
});
it('queues ordinary replies once and excludes automatic consent and help keywords',async()=>{
 await saveSms(pool,message);await saveSms(pool,message);
 const sent=[];const send=async mail=>{sent.push(mail);return {accepted:['alerts@example.test'],rejected:[]};};
 const alertEnv={EMAIL_FROM:'noreply@example.test',EMAIL_TO:'alerts@example.test'};
 expect(await deliverSmsAlert({pool,env:alertEnv,send})).toBe(true);expect(await deliverSmsAlert({pool,env:alertEnv,send})).toBe(false);
 expect(sent).toHaveLength(1);expect(sent[0].text).toContain(message.body);expect(sent[0].to).toBe(alertEnv.EMAIL_TO);
 for(const [index,body] of ['STOP','START','HELP'].entries())await saveSms(pool,{...message,sid:'SM'+String(index).repeat(32),body});
 expect((await pool.query('SELECT * FROM processrite_sms_messages WHERE needs_attention=true')).rows).toHaveLength(1);
});
it('retains replies and schedules retry when the email provider rejects the alert',async()=>{
 await saveSms(pool,message);await deliverSmsAlert({pool,env:{},send:async()=>({accepted:[],rejected:['test']})});
 const row=(await pool.query('SELECT * FROM processrite_sms_messages WHERE message_sid=$1',[sid])).rows[0];
 expect(row.alert_attempts).toBe(1);expect(row.alert_accepted_at).toBeNull();expect(row.needs_attention).toBe(true);expect(row.handled_at).toBeNull();
});
it('requires staff write access and handles only selected messages, preserving a newer arrival',async()=>{
 await saveSms(pool,message);const lead=(await pool.query('SELECT * FROM lead_submissions')).rows[0];
 const newer='SM'+'8'.repeat(32);await saveSms(pool,{...message,sid:newer,body:'Newer question'});
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('test-role'))req.user={id:7,role:req.get('test-role')};next();});mountSmsInbox(app,{pool,limiter:(req,res,next)=>next()});
 const path=`/api/leads/${lead.id}/sms/handled`,body={message_sids:[sid]};
 expect((await request(app).post(path).send(body)).status).toBe(401);
 expect((await request(app).post(path).set('test-role','viewer').send(body)).status).toBe(403);
 expect((await request(app).post(path).set('test-role','manager').send({message_sids:['invalid']})).status).toBe(400);
 expect((await request(app).post(path).set('test-role','manager').send(body)).body.handled).toBe(1);
 expect((await pool.query('SELECT * FROM processrite_sms_messages WHERE message_sid=$1',[newer])).rows[0].handled_at).toBeNull();
 expect((await request(app).post(path).set('test-role','admin').send(body)).body.handled).toBe(0);
});
