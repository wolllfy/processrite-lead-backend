import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {smsSchema,saveSms,attachSms} from '../lib/twilio-sms.js';
import {recordWebsiteConsent,smsPreferences} from '../lib/sms-consent.js';
import {smsSendSchema,sendLeadSms,mountSmsSend} from '../lib/sms-send.js';
let db,pool,id;
const phone='9735550194',env={PROCESSRITE_PROMO_APPROVED:'true',TWILIO_PROMO_SERVICE_SID:'MG'+'c'.repeat(32)};
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec(smsSchema+smsSendSchema);const query=(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(s,a);pool={query,connect:async()=>({query,release(){}})};},20000);
afterAll(()=>db.close());
beforeEach(async()=>{await db.exec('TRUNCATE processrite_sms_messages,processrite_sms_optouts,processrite_sms_preferences,processrite_sms_consent_events,processrite_sms_sends,lead_submissions RESTART IDENTITY CASCADE');id=(await pool.query("INSERT INTO lead_submissions(name,phone,email,business_type,monthly_processing_volume,lead_source,status,sms_consent) VALUES('Promo test',$1,'test@example.test','Shop','10000','Website Form','Qualified',false) RETURNING id",[phone])).rows[0].id;});
const grant=async(support,promo)=>{const eventLead=(await pool.query("INSERT INTO lead_submissions(name,phone,email,business_type,monthly_processing_volume,lead_source,status,sms_consent) VALUES('Website consent',$1,'test@example.test','Shop','10000','Website Form','New',false) RETURNING id",[phone])).rows[0].id;return recordWebsiteConsent(pool,eventLead,{phone,sms_consent:support,sms_marketing_consent:promo,source_url:'https://processrite.com/contact/'});};
const send=(provider,extra={})=>sendLeadSms(pool,env,provider,{leadId:id,purpose:'promotions',body:'Review your payment setup with our team.',requestId:randomUUID(),actorId:1,...extra});
it('separates all four checkbox choices and preserves exact disclosure evidence',async()=>{
 await grant(true,false);let [lead]=await smsPreferences(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_preferences.support.granted).toBe(true);expect(lead.sms_preferences.promotions.granted).toBe(false);
 await grant(false,true);[lead]=await smsPreferences(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_preferences.support.granted).toBe(true);expect(lead.sms_preferences.promotions.granted).toBe(true);expect(lead.sms_preferences.promotions.disclosure_version).toBe('promotions_v1');expect(lead.sms_preferences.promotions.source_url).toBe('https://processrite.com/contact/');
 await db.exec('DELETE FROM processrite_sms_preferences');await grant(false,false);[lead]=await smsPreferences(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_preferences.promotions.granted).toBe(false);expect(lead.sms_preferences.support.granted).toBe(false);
});
it('STOP revokes both and START does not restore marketing; ordinary replies never grant it',async()=>{
 await grant(true,true);const sms={direction:'inbound',from:'+1'+phone,to:'+19733142419',status:'received'};
 await saveSms(pool,{...sms,sid:'SM'+'a'.repeat(32),body:'STOP',optOutType:'STOP'});
 let [lead]=await attachSms(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_preferences.opted_out).toBe(true);expect(lead.sms_preferences.promotions.granted).toBe(false);expect(lead.sms_messages[0].body).toBe('STOP');
 await saveSms(pool,{...sms,sid:'SM'+'b'.repeat(32),body:'START',optOutType:'START'});await saveSms(pool,{...sms,sid:'SM'+'d'.repeat(32),body:'Tell me about products'});
 [lead]=await smsPreferences(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_preferences.support.granted).toBe(true);expect(lead.sms_preferences.promotions.granted).toBe(false);expect(lead.status).toBe('Qualified');
});
it('blocks missing promotional consent and unapproved registration before calling provider',async()=>{
 const provider=vi.fn();await grant(true,false);await expect(send(provider)).rejects.toThrow('No promotional');expect(provider).not.toHaveBeenCalled();
 await grant(false,true);await expect(sendLeadSms(pool,{},provider,{leadId:id,purpose:'promotions',body:'Offer',requestId:randomUUID(),actorId:1})).rejects.toThrow('carrier-approved');expect(provider).not.toHaveBeenCalled();
});
it('adds branded opt-out instructions, records delivery and deduplicates send retries',async()=>{
 await grant(false,true);const provider=vi.fn(async()=>({sid:'SM'+'e'.repeat(32),status:'queued'})),requestId=randomUUID();
 const first=await send(provider,{requestId}),second=await send(provider,{requestId});expect(first.ok).toBe(true);expect(second.replayed).toBe(true);expect(provider).toHaveBeenCalledTimes(1);expect(provider.mock.calls[0][0].body).toContain('Reply STOP');expect(provider.mock.calls[0][0].statusCallback).toContain('/sms/status');
 await saveSms(pool,{sid:first.message_sid,direction:'outbound',from:'+19733142419',to:'+1'+phone,body:'Offer',status:'delivered'});const [lead]=await attachSms(pool,(await pool.query('SELECT * FROM lead_submissions')).rows);expect(lead.sms_messages[0].delivery_status).toBe('delivered');
});
it('enforces the disclosed monthly cap and records ambiguous sends without automatic retry',async()=>{
 await grant(false,true);const provider=vi.fn(async()=>{throw Error('Network timeout');}),requestId=randomUUID();await expect(send(provider,{requestId})).rejects.toThrow('needs review');const retry=await send(provider,{requestId});expect(retry.status).toBe('needs_review');expect(provider).toHaveBeenCalledTimes(1);
 for(let n=0;n<3;n++)await pool.query("INSERT INTO processrite_sms_sends(request_id,lead_id,actor_id,purpose,recipient,body,status) VALUES($1,$2,'1','promotions',$3,'prior','sent')",[randomUUID(),id,'+1'+phone]);await expect(send(provider)).rejects.toThrow('monthly limit');
});
it('rejects unsigned users and sales-only accounts for outbound messages',async()=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('test-role'))req.user={id:1,role:req.get('test-role')};next();});const provider=vi.fn();mountSmsSend(app,{pool,env,createMessage:provider,limiter:(req,res,next)=>next()});
 const path=`/api/leads/${id}/sms`,body={purpose:'support',body:'test',request_id:randomUUID()};expect((await request(app).post(path).send(body)).status).toBe(401);expect((await request(app).post(path).set('test-role','sales').send(body)).status).toBe(403);expect(provider).not.toHaveBeenCalled();
});
