import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import {callSchema,parseCallEvent,storeCallEvent,deliverCallAlerts,mountVapiCalls} from '../lib/vapi-calls.js';
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
 const send=vi.fn().mockResolvedValue({});const ctx={pool,send,env:{EMAIL_TO:'owner@example.test',EMAIL_FROM:'calls@example.test'}};
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
