import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import express from "express";
import request from "supertest";
import { easternReportDay, processRiteReport, deliverProcessRiteReport, mountProcessRiteReports } from "../lib/daily-report.js";
let db,pool;
beforeAll(async()=>{db=new PGlite();await db.waitReady;for(const name of fs.readdirSync(new URL("../migrations/",import.meta.url)).sort())await db.exec(fs.readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));const query=(sql,args)=>sql.includes("pg_advisory_xact_lock")?Promise.resolve({rows:[]}):db.query(sql,args);pool={query,connect:async()=>({query,release(){}})};},20000);
afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec("TRUNCATE lead_submissions,crm_access_events RESTART IDENTITY CASCADE");});
it("schedules 9 PM in Eastern standard and daylight time",()=>{
 expect(easternReportDay(new Date("2026-10-11T00:59:00Z")).due).toBe(false);
 expect(easternReportDay(new Date("2026-10-11T01:00:00Z"))).toEqual({date:"2026-10-10",due:true});
 expect(easternReportDay(new Date("2026-12-11T01:59:00Z")).due).toBe(false);
 expect(easternReportDay(new Date("2026-12-11T02:00:00Z"))).toEqual({date:"2026-12-10",due:true});
});
it("keeps homepage and phone attribution while excluding sensitive fields and archived leads",async()=>{
 await db.query("INSERT INTO lead_submissions(name,business_name,phone,email,business_type,monthly_processing_volume,lead_source,page_source,source_url,transcript,archived) VALUES('Private Name','Merchant One','secret-phone','secret-email','Retail','10000','Website Form','homepage','https://processrite.com/','private-transcript',false),('Private Name','Phone Merchant','secret-phone','secret-email','Retail','20000','vapi-phone-call','phone','','private-transcript',false),('Private Name','Archived Merchant','secret-phone','secret-email','Retail','20000','Website Form','homepage','','private-transcript',true)");
 const text=await processRiteReport(pool);
 expect(text).toContain("Active leads: 2");expect(text).toContain("homepage");expect(text).toContain("vapi-phone-call");
 expect(text).not.toMatch(/secret-phone|secret-email|private-transcript|Archived Merchant/);
});
it("claims once across repeated daily sends",async()=>{
 const send=vi.fn().mockResolvedValue(undefined),now=new Date();
 expect(await deliverProcessRiteReport({pool,env:{},send,now})).toEqual({accepted:true});
 expect(await deliverProcessRiteReport({pool,env:{},send,now})).toEqual({skipped:true});expect(send).toHaveBeenCalledTimes(1);
});
it("records uncertain failure and suppresses automatic resend",async()=>{
 const send=vi.fn().mockRejectedValue(Error("secret SMTP failure")),now=new Date();
 await expect(deliverProcessRiteReport({pool,env:{},send,now})).rejects.toMatchObject({status:502});
 expect(await deliverProcessRiteReport({pool,env:{},send,now})).toEqual({skipped:true});
 expect((await db.query("SELECT action FROM crm_access_events")).rows.some(r=>r.action.endsWith(":failed_or_unconfirmed"))).toBe(true);
});
it("limits report access and tests to administrators",async()=>{
 const app=express();app.use((_q,_s,next)=>next());const stop=mountProcessRiteReports(app,{pool,env:{PROCESSRITE_DAILY_REPORT_ENABLED:"false"},limiter:(_q,_s,next)=>next()});
 try{expect((await request(app).get("/api/reports/daily")).status).toBe(403);expect((await request(app).post("/api/reports/daily/test")).status).toBe(403);}finally{stop();}
});
