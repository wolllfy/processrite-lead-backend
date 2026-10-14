import {describe,it,expect} from 'vitest';
import {confirmedCallback} from '../lib/voice-confirmation.js';
const result={role:'tool_call_result',name:'LogLead',result:JSON.stringify({ok:true,leadId:'29'})};
const conversation=(reply='Correct.')=>[{role:'user',message:'9 7 3 5 5 5 0 1 9 9.'},{role:'bot',message:'I heard 9 7 3 5 5 5 0 1 9 9. Is that correct?'},{role:'user',message:reply},result];
describe('provider-confirmed callback',()=>{
 it('recovers the agreed digits independently of model tool arguments',()=>expect(confirmedCallback(conversation())).toEqual({phone:'9735550199',leadId:'29'}));
 it('accepts explicit yes and a leading US country code',()=>{const c=conversation('Yes, that is correct.');c[0].message='+1 (973) 555-0199';expect(confirmedCallback(c)?.phone).toBe('9735550199');});
 it('requires matching caller and assistant numbers',()=>{const c=conversation();c[1].message='9 7 3 5 5 5 0 1 8 9. Is that correct?';expect(confirmedCallback(c)).toBeNull();});
 it('does not treat presence or a partial correction as consent',()=>{for(const r of ["Yeah, I am here.",'Yes, but the last digit is wrong.','No, change that number.'])expect(confirmedCallback(conversation(r))).toBeNull();});
 it('does not trust a caller-supplied success object or a failed tool',()=>{const c=conversation();c[3]={...result,role:'user'};expect(confirmedCallback(c)).toBeNull();c[3]={...result,result:'{"ok":false}'};expect(confirmedCallback(c)).toBeNull();});
 it('uses the last confirmed correction',()=>{const c=conversation();c.push({role:'user',message:'Actually use 9735550188.'},{role:'bot',message:'9735550188. Is that correct?'},{role:'user',message:'Yes.'});expect(confirmedCallback(c)?.phone).toBe('9735550188');});
 it('does not truncate card-length digit sequences',()=>{const c=conversation();c[0].message='9735550199123456';expect(confirmedCallback(c)).toBeNull();});
 it('supports spoken digit words',()=>{const c=conversation();c[0].message='nine seven three five five five zero one nine nine';expect(confirmedCallback(c)?.phone).toBe('9735550199');});
});
