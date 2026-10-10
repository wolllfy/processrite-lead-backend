import crypto from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(crypto.scrypt);
let hashing = 0;
export async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length > 128) throw Object.assign(new Error("Invalid password"), {status:400});
  if (hashing >= 2) throw Object.assign(new Error("Sign-in busy. Try again shortly."), {status:503});
  hashing++;
  try {
    const key = await derive(password, salt, 64, {N:32768,r:8,p:3,maxmem:64*1024*1024});
    return `scrypt$32768$8$3$${salt}$${key.toString("hex")}`;
  } finally { hashing--; }
}
export async function verifyPassword(password, stored) {
  const parts = (stored || "").split("$");
  const valid = parts.length === 6 && parts.slice(0,4).join("$") === "scrypt$32768$8$3" && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const actual = await hashPassword(password, valid ? parts[4] : "0".repeat(32));
  return valid && crypto.timingSafeEqual(Buffer.from(actual.split("$")[5],"hex"),Buffer.from(parts[5],"hex"));
}
export const tokenHash = token => crypto.createHash("sha256").update(token).digest("hex");
export const publicUser = user => ({id:String(user.id),username:user.username,email:user.email,display_name:user.display_name,role:user.role,status:user.status,created_at:user.created_at,last_login_at:user.last_login_at});
export const permissions = {
 admin:["read","create","update","delete","users","notifications"],
 manager:["read","create","update","notifications"],
 sales:["read","create","update"],
 viewer:["read"],
};
export async function transaction(pool, fn) {
 const client=await pool.connect();
 try { await client.query("BEGIN"); const result=await fn(client); await client.query("COMMIT"); return result; }
 catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const audit = (db,actor,target,action) => db.query("INSERT INTO crm_access_events(actor_id,target_id,action) VALUES($1,$2,$3)",[actor,target,action]);
export function installAccounts(app,{pool,env,authLimiter,route,ttl}) {
 const origin = new URL(env.CRM_PUBLIC_URL || "https://portal.processrite.com");
 if(origin.protocol!=="https:" && !["localhost","127.0.0.1"].includes(origin.hostname)) throw Error("CRM_PUBLIC_URL requires HTTPS");
 app.post("/api/auth/login",route(async(req,res)=>{
   const username=typeof req.body?.username==="string"?req.body.username.trim().toLowerCase():"";
   const password=typeof req.body?.password==="string" && req.body.password.length<=128?req.body.password:"";
   const user=(await pool.query("SELECT * FROM crm_users WHERE username=$1",[username.slice(0,64)])).rows[0];
   const valid=await verifyPassword(password,user?.password_hash);
   if(!valid||user?.status!=="active") return res.status(401).json({ok:false,message:"Invalid credentials."});
   const token=crypto.randomBytes(32).toString("base64url");
   await transaction(pool,async db=>{
     const current=(await db.query("SELECT id FROM crm_users WHERE id=$1 AND status='active' AND password_hash=$2 FOR UPDATE",[user.id,user.password_hash])).rows[0];
     if(!current) fail(401,"Invalid credentials.");
     await db.query("INSERT INTO crm_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')",[tokenHash(token),user.id,ttl]);
     await db.query("UPDATE crm_users SET last_login_at=now() WHERE id=$1",[user.id]);
     await audit(db,user.id,user.id,"login");
   });
   res.set("Cache-Control","no-store").json({ok:true,token,expires_at:Math.floor(Date.now()/1000)+ttl,user:publicUser(user)});
 }));
 app.post("/api/auth/accept",authLimiter,route(async(req,res)=>{
   const {token,password}=req.body||{};
   if(typeof token!=="string"||token.length>100||typeof password!=="string"||password.trim().length<15||password.length>128) fail(400,"Use a valid link and a password of 15–128 characters.");
   const passwordHash=await hashPassword(password);
   await transaction(pool,async db=>{
     const record=(await db.query("SELECT t.*,u.status FROM crm_account_tokens t JOIN crm_users u ON u.id=t.user_id WHERE token_hash=$1 AND expires_at>now() FOR UPDATE OF t,u",[tokenHash(token)])).rows[0];
     if(!record||record.status==="disabled") fail(400,"Link expired or already used. Ask your administrator for a new link.");
     await db.query("UPDATE crm_users SET password_hash=$1,status='active',updated_at=now() WHERE id=$2",[passwordHash,record.user_id]);
     await db.query("DELETE FROM crm_account_tokens WHERE user_id=$1",[record.user_id]);
     await db.query("DELETE FROM crm_sessions WHERE user_id=$1",[record.user_id]);
     await audit(db,record.user_id,record.user_id,record.purpose==="invite"?"invite_accepted":"password_reset");
   });
   res.json({ok:true,message:"Password saved. Sign in with your username."});
 }));
 const authenticate=route(async(req,res,next)=>{
   const raw=req.get("authorization")||"",token=raw.startsWith("Bearer ")?raw.slice(7):"";
   if(!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(401).json({ok:false,message:"Unauthorized."});
   const user=(await pool.query("SELECT u.*,s.token_hash FROM crm_sessions s JOIN crm_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'",[tokenHash(token)])).rows[0];
   if(!user) return res.status(401).json({ok:false,message:"Unauthorized."});
   req.user=user;res.set("Cache-Control","no-store");next();
 });
 app.use("/api",authenticate);
 app.get("/api/auth/me",(req,res)=>res.json({ok:true,user:publicUser(req.user),permissions:permissions[req.user.role]}));
 app.post("/api/auth/logout",route(async(req,res)=>{await pool.query("DELETE FROM crm_sessions WHERE token_hash=$1",[req.user.token_hash]);res.json({ok:true});}));
 const admin=(req,res,next)=>req.user.role==="admin"?next():res.status(403).json({ok:false,message:"Administrator access required."});
 app.use("/api/users",admin);
 app.get("/api/users",route(async(_req,res)=>res.json({ok:true,users:(await pool.query("SELECT * FROM crm_users ORDER BY created_at,id LIMIT 1000")).rows.map(publicUser)})));
 app.get("/api/users/events",route(async(_req,res)=>res.json({ok:true,events:(await pool.query("SELECT e.id,e.action,e.created_at,a.username actor,t.username target FROM crm_access_events e LEFT JOIN crm_users a ON a.id=e.actor_id LEFT JOIN crm_users t ON t.id=e.target_id ORDER BY e.id DESC LIMIT 100")).rows})));
 async function issue(db,user,actor,purpose) {
   const token=crypto.randomBytes(32).toString("base64url");
   await db.query("DELETE FROM crm_account_tokens WHERE user_id=$1",[user.id]);
   await db.query("INSERT INTO crm_account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",[tokenHash(token),user.id,purpose,purpose==="invite"?86400:3600]);
   if(purpose==="reset") await db.query("DELETE FROM crm_sessions WHERE user_id=$1",[user.id]);
   await audit(db,actor,user.id,purpose+"_issued");
   return {user:publicUser(user),link:`${origin.origin}/#set-password=${token}`,expires_in:purpose==="invite"?86400:3600};
 }
 async function adminTransaction(req,fn) {
   return transaction(pool,async db=>{
     await db.query("SELECT pg_advisory_xact_lock(731905)");
     const actor=(await db.query("SELECT id FROM crm_users WHERE id=$1 AND role='admin' AND status='active' FOR UPDATE",[req.user.id])).rows[0];
     if(!actor) fail(403,"Administrator access required.");
     return fn(db);
   });
 }
 app.post("/api/users",route(async(req,res)=>{
   const {username,email,display_name,role}=req.body||{};
   if(typeof username!=="string"||!/[a-z0-9]/i.test(username)||!/^\w[\w.-]{2,63}$/.test(username)||typeof email!=="string"||!/^\S+@\S+\.\S+$/.test(email)||email.length>160||typeof display_name!=="string"||!display_name.trim()||display_name.length>160||!Object.hasOwn(permissions,role)) fail(400,"Enter a valid username, name, email and role.");
   const result=await adminTransaction(req,async db=>{
     const user=(await db.query("INSERT INTO crm_users(username,email,display_name,role) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING RETURNING *",[username.toLowerCase(),email.trim(),display_name.trim(),role])).rows[0];
     if(!user) fail(409,"Username already exists.");
     return issue(db,user,req.user.id,"invite");
   });res.status(201).json({ok:true,...result});
 }));
 app.patch("/api/users/:id",route(async(req,res)=>{
   const {role,status}=req.body||{};
   if(!/^\d+$/.test(req.params.id)||Object.keys(req.body||{}).some(k=>!["role","status"].includes(k))||(!role&&!status)||(role&&!Object.hasOwn(permissions,role))||(status&&!["active","disabled"].includes(status))) fail(400,"Invalid account update.");
   const result=await adminTransaction(req,async db=>{
     // Serialize administrator membership changes to prevent concurrent last-admin removal.
     await db.query("SELECT pg_advisory_xact_lock(731905)");
     const user=(await db.query("SELECT * FROM crm_users WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
     if(!user) fail(404,"User not found.");
     if(String(user.id)===String(req.user.id)&&(status==="disabled"||(role&&role!=="admin"))) fail(409,"You cannot disable or demote your own account.");
     if(status==="active"&&!user.password_hash) fail(409,"This user must accept an invitation first.");
     if(user.role==="admin"&&user.status==="active"&&(status==="disabled"||(role&&role!=="admin"))){const count=(await db.query("SELECT count(*)::int n FROM crm_users WHERE role='admin' AND status='active'")).rows[0].n;if(count<=1) fail(409,"Keep at least one active administrator.");}
     const updated=(await db.query("UPDATE crm_users SET role=$1,status=$2,updated_at=now() WHERE id=$3 RETURNING *",[role||user.role,status||user.status,user.id])).rows[0];
     await db.query("DELETE FROM crm_sessions WHERE user_id=$1",[user.id]);
     await db.query("DELETE FROM crm_account_tokens WHERE user_id=$1",[user.id]);
     await audit(db,req.user.id,user.id,"account_updated");return publicUser(updated);
   });res.json({ok:true,user:result});
 }));
 app.post("/api/users/:id/:action",route(async(req,res)=>{
   const {id,action}=req.params;
   if(!/^\d+$/.test(id)||!["invite","reset","revoke"].includes(action)) fail(400,"Invalid account action.");
   const result=await adminTransaction(req,async db=>{
     const user=(await db.query("SELECT * FROM crm_users WHERE id=$1 FOR UPDATE",[id])).rows[0];
     if(!user) fail(404,"User not found.");
     if(action==="revoke"){await db.query("DELETE FROM crm_sessions WHERE user_id=$1",[id]);await audit(db,req.user.id,id,"sessions_revoked");return {};}
     if(user.status==="disabled"||(action==="invite"&&user.status!=="invited")||(action==="reset"&&user.status!=="active")) fail(409,"Action is not available for this account.");
     return issue(db,user,req.user.id,action);
   });res.json({ok:true,...result});
 }));
 app.use("/api",(req,res,next)=>{
   if (req.method === "PATCH" && req.path.startsWith("/leads/") && Object.hasOwn(req.body||{},"archived") && req.user.role!=="admin") return res.status(403).json({ok:false,message:"Only administrators can archive leads."});
   const needed=req.path.startsWith("/notifications")?"notifications":req.method==="GET"?"read":req.method==="DELETE"?"delete":req.method==="PATCH"?"update":"create";
   return permissions[req.user.role]?.includes(needed)?next():res.status(403).json({ok:false,message:"Your role does not allow this action."});
 });
 return authenticate;
}
