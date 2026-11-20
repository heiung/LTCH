import { createHash } from 'node:crypto';
import {ApiError} from './policy.mjs';
const isId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const databaseFailure = () => new ApiError(503, 'Database request failed');
const check = result => { if (result.error) throw databaseFailure(); return result.data; };
export function createSupabaseOtpStore(db) {
  return { async update(uid, change) {
    if (typeof uid !== 'string' || !uid || uid.length > 128 || typeof change !== 'function') throw new TypeError('Invalid OTP request');
    for (let tries=0;tries<12;tries++) {
      const row=check(await db.from('ltch_otp_challenges').select('version,payload').eq('uid',uid).maybeSingle());
      const result=change(row?.payload ?? null);
      if (!result || !Object.hasOwn(result,'next') || !Object.hasOwn(result,'value')) throw new TypeError('Invalid update');
      if (!row && result.next == null) return result.value;
      if (!row) {
        const inserted=await db.from('ltch_otp_challenges').insert({uid,version:1,payload:result.next});
        if (!inserted.error) return result.value;
        if (inserted.error.code==='23505') continue;
        throw databaseFailure();
      }
      let query;
      if (result.next == null) query=db.from('ltch_otp_challenges').delete().eq('uid',uid).eq('version',row.version).select('version');
      else query=db.from('ltch_otp_challenges').update({version:row.version+1,payload:result.next}).eq('uid',uid).eq('version',row.version).select('version');
      if (check(await query).length === 1) return result.value;
    }
    throw new ApiError(503, 'Hệ thống đang bận. Vui lòng thử lại sau.');
  } };
}
export function createSupabaseSessionStore(db) {
 return {
  async create(id,value) {
   if (!isId(id) || !value || typeof value.uid!=='string' || !value.uid || value.uid.length>128 || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt<=value.createdAt) throw new TypeError('Invalid session');
   check(await db.from('ltch_sessions').insert({id,uid:value.uid,created_at:value.createdAt,expires_at:value.expiresAt}));
  },
  async get(id) {
   if (!isId(id)) return null;
   const row=check(await db.from('ltch_sessions').select('uid,created_at,expires_at').eq('id',id).maybeSingle());
   return row ? {uid:row.uid,createdAt:row.created_at,expiresAt:row.expires_at} : null;
  },
  async delete(id) {if (isId(id)) check(await db.from('ltch_sessions').delete().eq('id',id));}
 };
}
export function createSupabaseRateLimiter(db,clock=Date.now) {
 const policies={begin:{max:10,window:900000},complete:{max:30,window:900000},enrollment:{max:50,window:3600000},urgent:{max:3,window:86400000},staffRequest:{max:20,window:3600000},forum:{max:100,window:3600000},media:{max:100,window:3600000}};
 return async (request,action)=>{
  const policy=policies[action],ip=request.headers.get('CF-Connecting-IP'),now=clock();
  if(!policy || !ip || ip.length>80 || !Number.isSafeInteger(now)) return false;
  const bucket=Math.floor(now/policy.window);
  const id=createHash('sha256').update(JSON.stringify([action,ip,bucket])).digest('hex');
  return check(await db.rpc('ltch_consume_rate',{p_id:id,p_expiry:(bucket+2)*policy.window,p_max:policy.max}))===true;
 };
}
