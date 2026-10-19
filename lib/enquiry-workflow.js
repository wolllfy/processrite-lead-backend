import {allBrands,inferredBrandSql} from './brand-intake.js';
export function nextWeekdayFollowup(now=new Date()){
 const zone=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=date=>Object.fromEntries(zone.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const local=parts(now);const candidate=new Date(Date.UTC(local.year,local.month-1,local.day+1,10));
 while([0,6].includes(candidate.getUTCDay()))candidate.setUTCDate(candidate.getUTCDate()+1);
 const at=parts(candidate);const offset=Date.UTC(at.year,at.month-1,at.day,at.hour,at.minute,at.second)-candidate.getTime();
 return new Date(candidate.getTime()-offset).toISOString();
}
export async function initializeEnquiryWorkflow(client,id,intake,now=new Date()){
 if(!intake)return;
 const admin=(await client.query("SELECT username FROM crm_users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1")).rows[0];
 if(!admin)throw Error('No active administrator for enquiry ownership.');
 const brand=allBrands.find(b=>b.slug===intake.brand);
 const action=`Review ${brand?.label||'project enquiry'} details, contact the enquirer, and agree the next step.`;
 await client.query('UPDATE lead_submissions SET assigned_to=$1,next_action=$2,follow_up_date=$3::text,follow_up_at=$3::text::timestamptz WHERE id=$4',[admin.username,action,nextWeekdayFollowup(now),id]);
}
export async function brandPerformance(pool){
 const rows=(await pool.query(`SELECT brand,count(*)::int total,count(*) FILTER(WHERE created_at>=now()-interval '7 days')::int last_7_days,count(*) FILTER(WHERE created_at>=now()-interval '30 days')::int last_30_days,count(*) FILTER(WHERE coalesce(status,'New')='New')::int new_enquiries,count(*) FILTER(WHERE coalesce(status,'') NOT IN ('Won','Lost') AND follow_up_at<now())::int overdue FROM (SELECT ${inferredBrandSql()} AS brand,created_at,status,follow_up_at FROM lead_submissions WHERE coalesce(archived,false)=false) classified GROUP BY brand`)).rows;
 return [...allBrands,{slug:'unassigned',name:'Unassigned',group:'projects'}].map(b=>({brand:b.slug,name:b.name,group:b.group,total:0,last_7_days:0,last_30_days:0,new_enquiries:0,overdue:0,...rows.find(r=>r.brand===b.slug)}));
}
