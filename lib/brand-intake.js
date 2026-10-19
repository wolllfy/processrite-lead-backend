import fs from 'node:fs';
export const brands=JSON.parse(fs.readFileSync(new URL('./brand-config.json',import.meta.url),'utf8'));
const legacy=[['processrite','Process Rite'],['paymentrite','PaymentRite'],['merchantrite','MerchantRite'],['checkoutrite','CheckoutRite']].map(([slug,name])=>({slug,name,group:'payments',type:'payment_enquiry',label:'Payments enquiry',fields:[]}));
export const allBrands=[...brands,...legacy];
const bySlug=new Map(allBrands.map(b=>[b.slug,b]));
export const brandIntakeSchema=`CREATE TABLE IF NOT EXISTS brand_enquiries (
 lead_id bigint PRIMARY KEY REFERENCES lead_submissions(id) ON DELETE CASCADE,
 brand text NOT NULL, enquiry_type text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 form_version text NOT NULL DEFAULT 'brand_v1', created_at timestamptz NOT NULL DEFAULT now()
); CREATE INDEX IF NOT EXISTS brand_enquiries_brand_idx ON brand_enquiries(brand);`;
export function inferBrand(row){
 for(const value of [row.source_url,row.page_source]){
  try{const host=new URL(value).hostname.toLowerCase().replace(/^www\./,'');const found=allBrands.find(b=>host===b.slug+'.com');if(found)return found;}catch{}
 }
 if(/vapi|phone|homepage/i.test(`${row.lead_source||''} ${row.page_source||''}`))return bySlug.get('processrite');
 return {slug:'unassigned',name:'Unassigned',group:'projects',type:'general_enquiry',label:'General enquiry',fields:[]};
}
export function validateBrandIntake(input){
 if(!input.brand && !input.enquiry_type && !input.intake_details)return null;
 const brand=brands.find(b=>b.slug===input.brand);
 if(!brand || inferBrand(input).slug!==brand.slug || input.enquiry_type!==brand.type)throw Error('Brand and enquiry type must match the source website.');
 const details=input.intake_details||{};
 if(!details||typeof details!=='object'||Array.isArray(details)||Object.keys(details).some(k=>!brand.fields.some(f=>f.key===k)))throw Error('Unrecognized project fields.');
 const clean={};
 for(const field of brand.fields){const value=details[field.key]??'';if(typeof value!=='string'||value.length>500)throw Error('Check the project fields.');const text=value.trim();if(field.required&&!text)throw Error('Complete the required project fields.');if(text&&field.options&&!field.options.includes(text))throw Error('Choose a valid project option.');if(text)clean[field.key]=text;}
 return {brand:brand.slug,enquiry_type:brand.type,details:clean,form_version:'brand_v1'};
}
export async function recordBrandIntake(client,id,intake){
 if(intake)await client.query('INSERT INTO brand_enquiries(lead_id,brand,enquiry_type,details,form_version) VALUES($1,$2,$3,$4::jsonb,$5)',[id,intake.brand,intake.enquiry_type,JSON.stringify(intake.details),intake.form_version]);
}
export async function attachBrandIntake(pool,rows){
 if(!rows.length)return rows;
 const extra=(await pool.query('SELECT * FROM brand_enquiries WHERE lead_id=ANY($1::bigint[])',[rows.map(r=>r.id)])).rows;
 const index=new Map(extra.map(x=>[String(x.lead_id),x]));
 return rows.map(row=>{const data=index.get(String(row.id));const brand=data?bySlug.get(data.brand)||inferBrand(row):inferBrand(row);return {...row,brand:brand.slug,brand_label:brand.name,intake_group:brand.group,enquiry_type:data?.enquiry_type||brand.type,enquiry_label:brand.label,intake_details:data?.details||{},intake_fields:brand.fields.map(f=>({key:f.key,label:f.label})),form_version:data?.form_version||'legacy'};});
}
// Exact hostname matching for pre-migration records; never match a domain substring.
export function inferredBrandSql(){
 const source="lower(regexp_replace(split_part(split_part(coalesce(nullif(source_url,''),page_source,''),'://',2),'/',1),'^www[.]',''))";
 return `coalesce((SELECT b.brand FROM brand_enquiries b WHERE b.lead_id=lead_submissions.id), CASE ${allBrands.map(b=>`WHEN ${source}='${b.slug}.com' THEN '${b.slug}'`).join(' ')} WHEN coalesce(lead_source,'') ~* 'vapi|phone' OR coalesce(page_source,'') ~* 'vapi|phone|homepage' THEN 'processrite' ELSE 'unassigned' END)`;
}
export function brandFilterSql(query,params){
 const brand=String(query.brand||'all'),view=String(query.view||'all');
 if(!['all','payments','projects'].includes(view)||!(brand==='all'||brand==='unassigned'||bySlug.has(brand)))throw Error('Choose a valid CRM view.');
 const clauses=[],expr=inferredBrandSql();
 if(brand!=='all'){params.push(brand);clauses.push(`${expr}=$${params.length}`);}
 if(view!=='all'){params.push(allBrands.filter(b=>b.group==='payments').map(b=>b.slug));clauses.push(`${expr} ${view==='projects'?'<>ALL':'=ANY'}($${params.length}::text[])`);}
 return clauses.length?clauses.join(' AND '):'TRUE';
}
