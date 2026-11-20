import {validState,redirectUri} from './drive-connect-core.mjs';

function page(res,status,text){res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(text);}
function resolveSafeSite(siteUrl){
 const raw=typeof siteUrl==='string'&&siteUrl.trim()?siteUrl.trim().replace(/\/+$/,''):(typeof process!=='undefined'&&process.env?.ALLOWED_ORIGIN?.trim()?.replace(/\/+$/,''))||'';
 return /^https:\/\/[a-z0-9.-]+$/i.test(raw)?raw:'https://ltch.example.com';
}

// The loopback listener never renders or logs an OAuth code, verifier or token.
export function createDriveConnectHandler({flow,expires,run,onFinished,clock=Date.now,siteUrl}){
 let started=false,consumed=false,outcome='processing';
 const baseSite=resolveSafeSite(siteUrl);
 return async(req,res)=>{
  if(req.method!=='GET'||req.headers.host!=='127.0.0.1:48421'||typeof req.url!=='string'||req.url.length>8192||!req.url.startsWith('/')||req.url.startsWith('//')){page(res,400,'Yêu cầu không hợp lệ.');return;}
  let url;try{url=new URL(req.url,redirectUri);}catch{page(res,400,'Yêu cầu không hợp lệ.');return;}
  if(url.origin!=='http://127.0.0.1:48421'){page(res,400,'Yêu cầu không hợp lệ.');return;}
  if(url.pathname==='/start'&&!started&&!consumed&&clock()<expires&&(!req.headers['sec-fetch-site']||['none','same-origin'].includes(req.headers['sec-fetch-site']))){started=true;res.writeHead(303,{location:flow.url,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return;}
  if(url.pathname==='/status'&&consumed){
   if(outcome==='processing'){
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",refresh:'2; url=/status'});
    res.end('Đang kiểm tra kết nối Drive, vui lòng chờ.');return;
   }
   if(outcome==='success'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",refresh:`5; url=${baseSite}/app`});
    res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết nối Drive thành công</title><p>Đã kiểm tra kết nối Drive. Đang trở về website lớp.</p><p><a href="${baseSite}/app">Mở website Lớp Toán cô Hạnh</a></p></html>`);return;
   }
   page(res,200,'Chưa hoàn tất kết nối. Hãy kiểm tra lại thiết lập.');return;
  }
  if(url.pathname!=='/callback'||!started||consumed||clock()>=expires||!validState(url.searchParams.get('state'),flow.state)||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1){page(res,400,'Phiên ủy quyền không hợp lệ hoặc đã hết hạn.');return;}
  consumed=true;
  // Remove the authorization code from the browser address before exchanging it.
  res.writeHead(303,{location:'/status','cache-control':'no-store','referrer-policy':'no-referrer'});res.end();
  let failure;
  try{await run(url.searchParams.get('code'),flow.verifier);outcome='success';}
  catch(error){outcome='failed';failure=error;}
  finally{onFinished(failure);}
 };
}
