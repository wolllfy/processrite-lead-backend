import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import {mountManagedAccounts} from '../lib/account-adapter.js';
import {callSchema,parseCallEvent,storeCallEvent,deliverCallAlerts,mountVapiCalls,saveVoiceTool,attachCallStatus} from '../lib/vapi-calls.js';
let db,pool;
const assistantId='0cf76238-66ec-4f04-a3d6-c06a95b980cd';
const payload=(id='test-call-001',number='+19735550123')=>({message:{type:'end-of-call-report',call:{id,assistantId,type:'inboundPhoneCall',customer:{number},startedAt:'2026-10-14T03:00:00Z',endedAt:'2026-10-14T03:00:05Z'},endedReason:'customer-ended-call',artifact:{transcript:''}}});
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec(callSchema);const query=(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(s,a);pool={query,connect:async()=>({query,release(){}})};},20000);
afterAll(()=>db.close());
beforeEach(()=>db.exec('TRUNCATE vapi_call_events,lead_submissions RESTART IDENTITY CASCADE'));
it('captures an early hangup without invented identity or consent',async()=>{
 const event=parseCallEvent(payload());await storeCallEvent(pool,event);
 const lead=(await pool.query('SELECT * FROM lead_submissions')).rows[0];
 expect(lead.phone).toBe('+19735550123');expect(lead.name).toContain('Unknown caller');expect(lead.summary).toContain('Incomplete call');expect(lead.sms_consent).toBe(false);expect(lead.status).toBe('New');expect(lead.call_duration).toBe('5 seconds');
});
it('deduplicates event retries and sends one alert per call',async()=>{
 const e=parseCallEvent(payload());await storeCallEvent(pool,e);await storeCallEvent(pool,e);
 const send=vi.fn().mockResolvedValue({accepted:['owner@example.test'],rejected:[]});const ctx={pool,send,env:{EMAIL_TO:'owner@example.test',EMAIL_FROM:'calls@example.test'}};
 await deliverCallAlerts(ctx);await deliverCallAlerts(ctx);
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].text).toContain('+19735550123');expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
it('updates a known Vapi lead without replacing qualification or name',async()=>{
 await pool.query("INSERT INTO lead_submissions(name,phone,email,business_type,monthly_processing_volume,lead_source,status) VALUES('Merchant','9735550123','merchant@example.test','Bagel shop','10000','Vapi','Qualified')");
 const p=payload();p.message.artifact.transcript='User: I need a processing review';p.message.artifact.messages=[{role:'user',message:'I need a processing review'}];
 await storeCallEvent(pool,parseCallEvent(p));await storeCallEvent(pool,parseCallEvent(payload('test-call-002')));
 const leads=(await pool.query('SELECT * FROM lead_submissions')).rows;expect(leads).toHaveLength(1);expect(leads[0].name).toBe('Merchant');expect(leads[0].status).toBe('Qualified');expect((await pool.query('SELECT * FROM vapi_call_events')).rows).toHaveLength(2);
});
it('handles withheld caller IDs idempotently',async()=>{
 const p=payload();delete p.message.call.customer.number;const e=parseCallEvent(p);await storeCallEvent(pool,e);await storeCallEvent(pool,e);expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
it('retries failed email without losing the lead',async()=>{
 await storeCallEvent(pool,parseCallEvent(payload()));await deliverCallAlerts({pool,send:vi.fn().mockRejectedValue(Error('SMTP unavailable')),env:{}});
 const call=(await pool.query('SELECT * FROM vapi_call_events')).rows[0];expect(call.attempts).toBe(1);expect(call.email_sent_at).toBeNull();expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
it('rejects unauthenticated and wrong-assistant webhooks',async()=>{
 const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool,env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 try{expect((await request(app).post('/api/vapi/events').send(payload())).status).toBe(401);const p=payload();p.message.call.assistantId='other';expect((await request(app).post('/api/vapi/events').set('x-vapi-secret','test-secret').send(p)).status).toBe(400);expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(0);expect((await request(app).post('/api/vapi/events').set('x-vapi-secret','test-secret').send(payload())).status).toBe(200);}finally{stop();}
});
it('late status events do not overwrite the completed report',async()=>{
 const p=payload();p.message.analysis={summary:'Clifton bagel shop requested review.'};await storeCallEvent(pool,parseCallEvent(p));p.message.type='status-update';p.message.status='ended';delete p.message.analysis;await storeCallEvent(pool,parseCallEvent(p));expect((await pool.query('SELECT summary FROM lead_submissions')).rows[0].summary).toBe('Clifton bagel shop requested review.');
});
it('accepts the authenticated webhook while portal management still requires sign-in',async()=>{
 const app=express();app.use(express.json());const env={VAPI_WEBHOOK_SECRET:'test-secret',USER_AUTH_ENABLED:'true',AUTH_SECRET:'a'.repeat(40)};
 const stopCalls=mountVapiCalls(app,{pool,env,send:vi.fn()});const stopAccounts=mountManagedAccounts(app,{pool,env,authLimiter:(_q,_s,n)=>n()});app.get('/api/leads',(_q,s)=>s.json({leads:[]}));
 try{expect((await request(app).post('/api/vapi/events').set('x-vapi-secret','test-secret').send(payload())).status).toBe(200);expect((await request(app).get('/api/leads')).status).toBe(401);}finally{stopCalls();stopAccounts();}
});

const toolPayload=(args={name:'Synthetic Support',phone:'9735550999',summary:'Synthetic urgent support request',call_type:'support',priority:'Urgent'})=>({message:{type:'tool-calls',call:payload().message.call,toolCallList:[{id:'tool-test-01',function:{name:'LogLead',arguments:args}}]}});
it('links different callback and caller ID using trusted call ID, preserves support urgency and CRM fields',async()=>{
 const initial=payload();initial.message.type='status-update';initial.message.status='in-progress';delete initial.message.call.endedAt;
 await storeCallEvent(pool,parseCallEvent(initial));
 const saved=await saveVoiceTool(pool,toolPayload());await saveVoiceTool(pool,toolPayload());await storeCallEvent(pool,parseCallEvent(payload()));
 const rows=(await pool.query('SELECT * FROM lead_submissions')).rows;
 expect(rows).toHaveLength(1);expect(rows[0].phone).toBe('9735550999');expect(rows[0].call_type).toBe('support');expect(rows[0].priority).toBe('Urgent');expect(rows[0].status).toBe('New');expect(rows[0].call_duration).toBe('5 seconds');expect(JSON.parse(saved.results[0].result).leadId).toBe(String(rows[0].id));
 const event=(await pool.query('SELECT * FROM vapi_call_events')).rows[0];expect(event.caller_phone).toBe('+19735550123');expect(event.lead_id).toBe(rows[0].id);
});
it('handles tool before webhook and optional fields missing',async()=>{
 await saveVoiceTool(pool,toolPayload({name:'Synthetic Merchant',phone:'9735550999',email:''}));await storeCallEvent(pool,parseCallEvent(payload()));
 expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
 expect((await pool.query('SELECT started_at FROM vapi_call_events')).rows[0].started_at).not.toBeNull();
});
it('rejects missing required tool data without writing records',async()=>{
 await expect(saveVoiceTool(pool,toolPayload({name:'Synthetic Merchant'}))).rejects.toThrow();expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(0);
});
it('requires authentication for the new correlated tool path',async()=>{
 const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool,env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 try{expect((await request(app).post('/api/vapi/events').send(toolPayload())).status).toBe(401);expect((await request(app).post('/api/vapi/events').set('x-vapi-secret','test-secret').send(toolPayload())).body.results).toHaveLength(1);}finally{stop();}
});
it('reports database failure as retryable 500 without exposing details',async()=>{
 const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool:{connect:async()=>{throw Error('private database details');}},env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 try{const r=await request(app).post('/api/vapi/events').set('x-vapi-secret','test-secret').send(toolPayload());expect(r.status).toBe(500);expect(r.body).toEqual({ok:false});}finally{stop();}
});
it('keeps rejected email pending and succeeds on retry with stable message ID',async()=>{
 await storeCallEvent(pool,parseCallEvent(payload()));const send=vi.fn().mockResolvedValueOnce({accepted:[],rejected:['owner@example.test']}).mockResolvedValue({accepted:['owner@example.test'],rejected:[]});const ctx={pool,send,env:{EMAIL_TO:'owner@example.test',EMAIL_FROM:'calls@example.test'}};
 await deliverCallAlerts(ctx);let call=(await pool.query('SELECT * FROM vapi_call_events')).rows[0];expect(call.email_sent_at).toBeNull();expect(call.attempts).toBe(1);
 await pool.query('UPDATE vapi_call_events SET next_attempt_at=now()');await deliverCallAlerts(ctx);call=(await pool.query('SELECT * FROM vapi_call_events')).rows[0];expect(call.email_sent_at).not.toBeNull();expect(send.mock.calls[0][0].messageId).toBe(send.mock.calls[1][0].messageId);
});
it('bounds SMTP timeout retries and preserves the saved lead',async()=>{
 await storeCallEvent(pool,parseCallEvent(payload()));const send=vi.fn().mockRejectedValue(Object.assign(Error('Synthetic timeout'),{code:'ETIMEDOUT'}));
 for(let i=0;i<7;i++){await pool.query('UPDATE vapi_call_events SET next_attempt_at=now()');await deliverCallAlerts({pool,send,env:{}});}
 expect(send).toHaveBeenCalledTimes(6);expect((await pool.query('SELECT attempts FROM vapi_call_events')).rows[0].attempts).toBe(6);expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
it('accepts the existing API Request format only with trusted static fields and secret',async()=>{
 const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool,env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 const body={name:'Synthetic Merchant',phone:'9735550999',call_id:'test-call-001',assistant_id:assistantId,call_type_provider:'inboundPhoneCall',caller_number:'+19735550123',monthly_volume:'$10,000 - $25,000'};
 try{expect((await request(app).post('/api/vapi/lead').send(body)).status).toBe(401);const r=await request(app).post('/api/vapi/lead').set('x-vapi-secret','test-secret').send(body);expect(r.status).toBe(201);expect(r.body.ok).toBe(true);expect((await pool.query('SELECT monthly_volume FROM lead_submissions')).rows[0].monthly_volume).toBe('$10,000 - $25,000');delete body.call_id;expect((await request(app).post('/api/vapi/lead').set('x-vapi-secret','test-secret').send(body)).status).toBe(400);}finally{stop();}
});
it('exposes precise CRM notification states without claiming inbox delivery',async()=>{
 await storeCallEvent(pool,parseCallEvent(payload()));let rows=(await pool.query('SELECT * FROM lead_submissions')).rows;
 expect((await attachCallStatus(pool,rows))[0].voice_notification.status).toBe('queued');
 await pool.query('UPDATE vapi_call_events SET attempts=1');expect((await attachCallStatus(pool,rows))[0].voice_notification.status).toBe('retry_pending');
 await pool.query('UPDATE vapi_call_events SET attempts=6');expect((await attachCallStatus(pool,rows))[0].voice_notification.status).toBe('failed');
 await pool.query('UPDATE vapi_call_events SET email_sent_at=now()');expect((await attachCallStatus(pool,rows))[0].voice_notification.status).toBe('provider_accepted');
});
it('returns a safe retryable response when backend connection times out',async()=>{
 const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool:{connect:async()=>{throw Object.assign(Error('Synthetic database timeout'),{code:'ETIMEDOUT'});}},env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 try{const body={name:'Synthetic Timeout',phone:'9735550999',call_id:'test-call-001',assistant_id:assistantId,call_type_provider:'inboundPhoneCall'};const r=await request(app).post('/api/vapi/lead').set('x-vapi-secret','test-secret').send(body);expect(r.status).toBe(500);expect(r.body).toEqual({ok:false,code:'storage_failure'});}finally{stop();}
});
it('diagnoses credential rejection without exposing headers or customer data',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});const app=express();app.use(express.json());const stop=mountVapiCalls(app,{pool,env:{VAPI_WEBHOOK_SECRET:'test-secret'},send:vi.fn()});
 try{const r=await request(app).post('/api/vapi/lead').set('x-vapi-secret','private-wrong-token').send({phone:'private-customer-phone'});expect(r.status).toBe(401);expect(r.body.code).toBe('authentication_failed');expect(log).toHaveBeenCalledWith('vapi_lead_auth_rejected',{secretHeaderPresent:true,authorizationPresent:false});expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-wrong-token|private-customer-phone/);}finally{stop();log.mockRestore();}
});
it('rolls back lead changes on storage failure, allowing a clean retry',async()=>{
 const failed={connect:async()=>{const c=await pool.connect();return {...c,query:(sql,args)=>sql.startsWith('INSERT INTO vapi_call_events')?Promise.reject(Error('Synthetic write failure')):c.query(sql,args)};}};
 await expect(saveVoiceTool(failed,toolPayload())).rejects.toThrow('Synthetic write failure');expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(0);
 await saveVoiceTool(pool,toolPayload());expect((await pool.query('SELECT * FROM lead_submissions')).rows).toHaveLength(1);
});
