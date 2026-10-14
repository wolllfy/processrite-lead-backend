const words={zero:'0',oh:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'};
const normalize=s=>s.replace(/^1(?=\d{10}$)/,'');
function numberIn(message){
 const s=String(message||'').replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi,w=>words[w.toLowerCase()]);
 const candidates=(s.match(/\+?\d[\d\s().,-]*\d/g)||[]).map(v=>v.replace(/\D/g,'')).filter(v=>/^\d{10}$|^1\d{10}$/.test(v));
 return candidates.length===1?normalize(candidates[0]):null;
}
function agrees(message){
 const s=String(message||'').trim().toLowerCase();
 return /^(yes\b|correct\b|that is correct\b|that's correct\b|right\b|that is right\b|that's right\b)/.test(s)&&! /\b(no|not|wrong|incorrect|but|except|change|instead)\b/.test(s);
}
// Authenticated provider roles, not a model-generated transcript or caller ID.
export function confirmedCallback(messages){
 if(!Array.isArray(messages))return null;
 let offered=null,readBack=null,confirmed=null,leadId=null;
 for(const m of messages.slice(0,400)){
  const message=m.message||m.content||'';
  if(m.role==='user'){
   const number=numberIn(message);
   if(number){offered=number;readBack=null;}
   else if(readBack&&agrees(message)){confirmed=readBack;readBack=null;}
  }else if(m.role==='bot'||m.role==='assistant'){
   const number=numberIn(message);
   if(offered&&number===offered&&/\b(correct|is that right)\b/i.test(message))readBack=number;
   else if(readBack)readBack=null;
  }else if(m.role==='tool_call_result'&&m.name==='LogLead'){
   try{const r=typeof m.result==='string'?JSON.parse(m.result):m.result;if(r?.ok===true&&/^\d+$/.test(String(r.leadId)))leadId=String(r.leadId);}catch{/* No confirmed intake marker. */}
  }
 }
 return confirmed&&leadId?{phone:confirmed,leadId}:null;
}
