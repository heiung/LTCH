import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const driveScope='https://www.googleapis.com/auth/drive.file';
export const redirectUri='http://127.0.0.1:48421/callback';
export const officialEmail=(typeof process!=='undefined'&&process.env&&(process.env.DRIVE_OWNER_EMAIL||process.env.ADMIN_EMAIL))||'admin@example.com';
export class ConnectError extends Error {constructor(code){super('Không thể hoàn tất kết nối Google Drive.');this.name='ConnectError';this.code=code;}}
function base64url(bytes){return Buffer.from(bytes).toString('base64url');}
function validSecret(v,max=4096){return typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u0020\u007f]/.test(v);}
function clientIdPattern(projectNumber=(typeof process!=='undefined'&&process.env?.GOOGLE_CLOUD_PROJECT_NUMBER)||''){
 const prefix=/^\d{5,20}$/.test(String(projectNumber).trim())?String(projectNumber).trim():'\\d{5,20}';
 return new RegExp(`^${prefix}-[a-z0-9]+\\.apps\\.googleusercontent\\.com$`);
}
export function validateClient(client,{projectNumber}={}){
 const pattern=clientIdPattern(projectNumber);
 if(!client||typeof client.client_id!=='string'||!pattern.test(client.client_id)||!validSecret(client.client_secret)||!Array.isArray(client.redirect_uris)||!client.redirect_uris.includes(redirectUri))throw new ConnectError('invalid_client');
 return {clientId:client.client_id,clientSecret:client.client_secret};
}
export function createAuthorization({clientId,random=randomBytes,loginHint=officialEmail,projectNumber}={}){
 const pattern=clientIdPattern(projectNumber);
 if(typeof clientId!=='string'||!pattern.test(clientId))throw new ConnectError('invalid_client');
 const state=base64url(random(32)),verifier=base64url(random(48)),challenge=base64url(createHash('sha256').update(verifier).digest());
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:driveScope,access_type:'offline',prompt:'consent',login_hint:loginHint,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {url:url.href,state,verifier};
}
export function validState(received,expected){
 if(typeof received!=='string'||typeof expected!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(received)||!/^[A-Za-z0-9_-]{43}$/.test(expected))return false;
 return timingSafeEqual(Buffer.from(received),Buffer.from(expected));
}
export async function exchangeCode({clientId,clientSecret,code,verifier,fetchImpl=fetch}){
 if(!validSecret(clientId)||!validSecret(clientSecret)||!validSecret(code)||!validSecret(verifier,128))throw new ConnectError('invalid_request');
 const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,code_verifier:verifier,redirect_uri:redirectUri,grant_type:'authorization_code'});
 let response;try{response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body});}catch{throw new ConnectError('exchange_failed');}
 if(!response.ok)throw new ConnectError('exchange_failed');
 let token;try{token=await response.json();}catch{throw new ConnectError('invalid_response');}
 const scopes=typeof token?.scope==='string'?token.scope.split(/\s+/).filter(Boolean):[];
 if(!validSecret(token?.access_token)||!validSecret(token?.refresh_token)||typeof token?.token_type!=='string'||token.token_type.toLowerCase()!=='bearer'||!scopes.includes(driveScope)||scopes.some(s=>s!==driveScope))throw new ConnectError('scope_or_token');
 return {accessToken:token.access_token,refreshToken:token.refresh_token};
}
