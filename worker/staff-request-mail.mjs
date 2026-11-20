import {createHash,createHmac,randomBytes} from 'node:crypto';
import templates from '../server/domain/notification-templates.cjs';
import {resolveAdminEmail,resolveSiteOrigin} from './config.mjs';

// The signed message is addressed only to the school's official administrator.
export async function notifyStaffRequest(env,account,role,fetchImpl=globalThis.fetch){
 const eventId='staff_'+createHash('sha256').update(account.uid+'\n'+role).digest('hex');
 const email=resolveAdminEmail(env),timestamp=Date.now(),nonce=randomBytes(16).toString('hex');
 const label=role==='teacher'?'Giáo viên':'Trợ giảng';
 const mail=templates.renderNotification('staff_request',{role_label:label,full_name:account.display_name,user_email:account.email},{siteUrl:resolveSiteOrigin(env),supportEmail:email});
 const payload=JSON.stringify({email,eventId,...mail});
 const signature=createHmac('sha256',env.MAIL_SECRET).update([timestamp,nonce,payload].join('\n')).digest('hex');
 try{
  const response=await fetchImpl(env.MAIL_ENDPOINT,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({kind:'notification',timestamp,nonce,payload,signature}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')),signal:AbortSignal.timeout(25000)});
  if(!response.ok)return false;
  return (await response.json()).ok===true;
 }catch{return false;}
}
