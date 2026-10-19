import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {brands,brandIntakeSchema,validateBrandIntake,recordBrandIntake,attachBrandIntake,brandFilterSql,inferBrand} from '../lib/brand-intake.js';
let db;
beforeAll(async()=>{db=new PGlite();await db.waitReady;await db.exec('CREATE TABLE lead_submissions(id bigserial PRIMARY KEY,source_url text,page_source text,lead_source text);'+brandIntakeSchema);},20000);
afterAll(async()=>db.close());
it('stores every brand’s structured answers and isolates views including legacy leads',async()=>{
 for(const brand of brands){
  const source='https://'+brand.slug+'.com/contact/';
  const input={brand:brand.slug,enquiry_type:brand.type,source_url:source,intake_details:Object.fromEntries(brand.fields.map(f=>[f.key,f.options?.[0]||'Synthetic project detail']))};
  const intake=validateBrandIntake(input);
  const row=(await db.query('INSERT INTO lead_submissions(source_url,page_source,lead_source) VALUES($1,$1,$2) RETURNING *',[source,'Website Form'])).rows[0];
  await recordBrandIntake(db,row.id,intake);
  const attached=(await attachBrandIntake(db,[row]))[0];
  expect(attached.brand).toBe(brand.slug);expect(attached.enquiry_type).toBe(brand.type);expect(attached.intake_details).toEqual(intake.details);expect(attached.form_version).toBe('brand_v1');
  const params=[],filter=brandFilterSql({brand:brand.slug},params);
  expect((await db.query('SELECT id FROM lead_submissions WHERE '+filter,params)).rows.map(x=>x.id)).toEqual([row.id]);
 }
 await db.query("INSERT INTO lead_submissions(source_url,lead_source) VALUES('https://processrite.com/contact/','Website Form'),('https://oliverite.com/contact/','Website Form'),('https://evil.example/oliverite.com','Website Form')");
 const paymentParams=[],paymentFilter=brandFilterSql({view:'payments'},paymentParams);
 expect((await db.query('SELECT id FROM lead_submissions WHERE '+paymentFilter,paymentParams)).rows).toHaveLength(2);
 const oliveParams=[],oliveFilter=brandFilterSql({brand:'oliverite'},oliveParams);
 expect((await db.query('SELECT id FROM lead_submissions WHERE '+oliveFilter,oliveParams)).rows).toHaveLength(2);
 const projectParams=[],projectFilter=brandFilterSql({view:'projects'},projectParams);
 expect((await db.query('SELECT id FROM lead_submissions WHERE '+projectFilter,projectParams)).rows).toHaveLength(brands.length+1);
},20000);
it('rejects mismatched brands, unknown fields, missing required fields, and invalid options',()=>{
 const input={brand:'oliverite',enquiry_type:'olive_oil_question',page_source:'https://oliverite.com/contact/',intake_details:{buyer_type:'Home cook',topic:'Tasting and flavor'}};
 expect(validateBrandIntake(input).details.topic).toBe('Tasting and flavor');
 expect(()=>validateBrandIntake({...input,page_source:'https://atmrite.com/contact/'})).toThrow();
 expect(()=>validateBrandIntake({...input,intake_details:{...input.intake_details,bank_account:'x'}})).toThrow();
 expect(()=>validateBrandIntake({...input,intake_details:{buyer_type:'Home cook'}})).toThrow();
 expect(()=>validateBrandIntake({...input,intake_details:{buyer_type:'Wrong',topic:'Tasting and flavor'}})).toThrow();
 expect(validateBrandIntake({})).toBeNull();
 expect(inferBrand({page_source:'vapi-phone-call'}).slug).toBe('processrite');
 expect(()=>brandFilterSql({brand:"x' OR TRUE"},[])).toThrow();
});
