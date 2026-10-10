import express from 'express';
import { installAccounts } from './accounts.js';
export function mountManagedAccounts(app,{pool,env,authLimiter}) {
 const ttl=Number(env.AUTH_SESSION_TTL_SECONDS||28800);
 if(!Number.isInteger(ttl)||ttl<60||ttl>86400) throw Error('Invalid session TTL');
 const router=express.Router();
 router.post('/api/auth/login',authLimiter);
 installAccounts(router,{pool,env,authLimiter,ttl,route:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)});
 // The existing public ingestion handler and its validation remain unchanged in this account-only release.
 app.use((req,res,next)=>req.method==='POST'&&/^\/api\/leads\/?$/i.test(req.path)?next():router(req,res,next));
 router.use((error,_req,res,_next)=>{
  const status=[400,401,403,404,409,503].includes(error.status)?error.status:500;
  res.status(status).json({ok:false,message:status===500?'Request could not be completed.':error.message});
 });
 const timer=setInterval(()=>{pool.query('DELETE FROM crm_sessions WHERE expires_at<now()').catch(()=>console.error('account_expiry_cleanup_failed'));pool.query('DELETE FROM crm_account_tokens WHERE expires_at<now()').catch(()=>console.error('account_expiry_cleanup_failed'));},3600000);
 timer.unref();
 return ()=>clearInterval(timer);
}
