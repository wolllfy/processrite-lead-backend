import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {nextWeekdayFollowup,initializeEnquiryWorkflow,brandPerformance} from '../lib/enquiry-workflow.js';
import {brandIntakeSchema,recordBrandIntake} from '../lib/brand-intake.js';
let db;
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec("CREATE TABLE crm_users(id bigserial,username text,role text,status text);INSERT INTO crm_users(username,role,status) VALUES('qa-admin','admin','active');CREATE TABLE lead_submissions(id bigserial PRIMARY KEY,source_url text,page_source text,lead_source text,created_at timestamptz DEFAULT now(),status text DEFAULT 'New',archived boolean DEFAULT false,assigned_to text,next_action text,follow_up_date text,follow_up_at timestamptz);"+brandIntakeSchema);},20000);
afterAll(async()=>db.close());
it('uses the next weekday at 10 AM Eastern across weekend and daylight-saving changes',()=>{
 expect(nextWeekdayFollowup(new Date('2026-10-19T15:00:00Z'))).toBe('2026-10-20T14:00:00.000Z');
 expect(nextWeekdayFollowup(new Date('2026-10-16T15:00:00Z'))).toBe('2026-10-19T14:00:00.000Z');
 expect(nextWeekdayFollowup(new Date('2026-10-30T15:00:00Z'))).toBe('2026-11-02T15:00:00.000Z');
 expect(nextWeekdayFollowup(new Date('2026-03-06T15:00:00Z'))).toBe('2026-03-09T14:00:00.000Z');
});
it('assigns new brand enquiries, preserves legacy records, and excludes archives from measurement',async()=>{
 const row=(await db.query("INSERT INTO lead_submissions(source_url) VALUES('https://jerseypayments.com/contact/') RETURNING id")).rows[0];
 const intake={brand:'jerseypayments',enquiry_type:'payment_review',details:{},form_version:'brand_v1'};
 await recordBrandIntake(db,row.id,intake);await initializeEnquiryWorkflow(db,row.id,intake,new Date('2026-10-19T15:00:00Z'));
 const saved=(await db.query('SELECT * FROM lead_submissions WHERE id=$1',[row.id])).rows[0];
 expect(saved.assigned_to).toBe('qa-admin');expect(saved.next_action).toContain('Payments review');expect(saved.follow_up_date).toBe('2026-10-20T14:00:00.000Z');
 await initializeEnquiryWorkflow(db,999,null);
 expect((await brandPerformance(db)).find(b=>b.brand==='jerseypayments').last_30_days).toBe(1);
 await db.query('UPDATE lead_submissions SET archived=true WHERE id=$1',[row.id]);
 expect((await brandPerformance(db)).find(b=>b.brand==='jerseypayments').total).toBe(0);
});
