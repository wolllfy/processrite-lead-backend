export const campaignSchema=`
ALTER TABLE processrite_sms_sends ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS processrite_review_requests(lead_id bigint PRIMARY KEY REFERENCES lead_submissions(id),campaign text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',medium text NOT NULL DEFAULT '',preferred_day text NOT NULL DEFAULT '',preferred_window text NOT NULL DEFAULT '',contact_method text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());`;
export const campaignKey=value=>String(value||'').trim().toLowerCase();
export async function recordReviewRequest(c,leadId,input){
 let url;try{url=new URL(input.source_url||input.page_source);}catch{}
 const campaign=campaignKey(url?.searchParams.get('utm_campaign'));
 await c.query('INSERT INTO processrite_review_requests(lead_id,campaign,source,medium,preferred_day,preferred_window,contact_method) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(lead_id) DO NOTHING',[leadId,/^[a-z0-9_-]{1,60}$/.test(campaign)?campaign:'',String(url?.searchParams.get('utm_source')||'').slice(0,100),String(url?.searchParams.get('utm_medium')||'').slice(0,100),input.review_day||'',input.review_window||'',input.review_contact||'']);
}
export async function attachReviewRequests(pool,rows){
 if(!rows.length)return rows;
 const extra=(await pool.query('SELECT * FROM processrite_review_requests WHERE lead_id=ANY($1::bigint[])',[rows.map(r=>r.id)])).rows;
 return rows.map(r=>{const m=extra.find(x=>String(x.lead_id)===String(r.id));return m?{...r,utm_campaign:m.campaign,utm_source:m.source,utm_medium:m.medium,review_request:{preferred_day:m.preferred_day,preferred_window:m.preferred_window,contact_method:m.contact_method}}:r;});
}
export async function campaignReport(pool){
 const sends=(await pool.query(`SELECT s.campaign,s.recipient,s.created_at,m.delivery_status FROM processrite_sms_sends s LEFT JOIN processrite_sms_messages m ON m.message_sid=s.message_sid WHERE s.campaign<>'' AND s.message_sid IS NOT NULL ORDER BY s.created_at`)).rows;
 const replies=(await pool.query(`SELECT sender,created_at FROM processrite_sms_messages WHERE direction='inbound' AND needs_attention=true`)).rows;
 const requests=(await pool.query(`SELECT r.*,l.status,l.phone FROM processrite_review_requests r JOIN lead_submissions l ON l.id=r.lead_id WHERE r.campaign<>'' AND coalesce(l.archived,false)=false`)).rows;
 const leads=(await pool.query("SELECT phone,status FROM lead_submissions WHERE coalesce(archived,false)=false AND status IN ('Proposal Sent','Won')")).rows;
 const result=new Map(),key=p=>String(p||'').replace(/\D/g,'').slice(-10);
 const row=name=>{if(!result.has(name))result.set(name,{campaign:name,sent:0,delivered:0,replies:0,enquiries:0,review_requests:0,proposals:0,won:0});return result.get(name);};
 for(const s of sends){const r=row(s.campaign);r.sent++;if(s.delivery_status==='delivered')r.delivered++;}
 for(const m of replies){const prior=sends.filter(s=>key(s.recipient)===key(m.sender)&&new Date(s.created_at)<=new Date(m.created_at));const last=prior.at(-1);if(last)row(last.campaign).replies++;}
 for(const m of requests){const r=row(m.campaign);r.enquiries++;if(m.preferred_day||m.preferred_window||m.contact_method)r.review_requests++;}
 const outcomes=new Set();
 for(const m of leads){const last=sends.filter(s=>key(s.recipient)===key(m.phone)).at(-1);const campaign=last?.campaign||requests.find(r=>key(r.phone)===key(m.phone))?.campaign;if(!campaign)continue;const identity=`${campaign}:${key(m.phone)}:${m.status}`;if(outcomes.has(identity))continue;outcomes.add(identity);row(campaign)[m.status==='Won'?'won':'proposals']++;}
 return [...result.values()];
}
export function mountCampaigns(app,{pool,limiter}){
 app.get('/api/sms/campaigns',limiter,async(req,res)=>{
  if(!req.user)return res.status(401).json({ok:false});
  try{res.json({ok:true,campaigns:await campaignReport(pool)});}catch{res.status(500).json({ok:false,message:'Campaign report is unavailable.'});}
 });
}
