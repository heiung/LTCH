import {createClient} from '@supabase/supabase-js';
import {createHmac} from 'node:crypto';
import {createSupabaseOtpStore,createSupabaseSessionStore,createSupabaseRateLimiter} from './supabase-stores.mjs';
import {createFirebaseVerifier} from './firebase-identity.mjs';
import {createSupabaseRepository} from './supabase-repository.mjs';
import {readOverview} from './overview.mjs';
import {createPracticeHandler} from './practice-handler.mjs';
import {createSupabasePracticeRepository} from './supabase-practice-repository.mjs';
import {createSubmissionHandler,configuredStorage} from './submission-handler.mjs';
import { uploadStudentSubmissionToDrive, trashDriveTargetsSafe } from './lesson-storage.mjs';
import { videoMedia } from './video-stream.mjs';
import {business} from './business.mjs';
import {noticeMedia} from './notices.mjs';
import {practiceMedia} from './practice-drive.mjs';
import {enrollment} from './enrollment-handler.mjs';
import {verifyReminderTick,runLessonReminders} from './lesson-reminders.mjs';
import {resolveAttendanceMail,verifyAttendanceMailRequest} from './attendance-mail.mjs';
import {ApiError,data,demand,accountProfile} from './policy.mjs';
import {applicationSession,readJson,json,withCors} from './http.mjs';
import {resolveAllowedOrigin,resolveSupabaseOrigin,resolveFirebaseProjectId,resolveAdminEmail} from './config.mjs';
import otpModule from '../server/domain/otp.cjs';
import authModule from '../server/domain/auth-flow.cjs';
import mailModule from '../server/integrations/apps-script-mail.cjs';
import authErrorModule from '../server/domain/auth-error.cjs';
const {AuthError}=authErrorModule;
const {createOtpService}=otpModule,{createAuthFlow}=authModule,{sendOtpEmail}=mailModule;
export function createWorker(dependencies={}){let mediaActive=0,healthCache=null;return {async fetch(request,env){
 const path=new URL(request.url).pathname,origin=request.headers.get('origin');
 const allowed=resolveAllowedOrigin(env);
 const supabaseOrigin=resolveSupabaseOrigin(env);
 const reply=r=>withCors(r,allowed&&origin===allowed?allowed:null);
 const createBoundedDb=urlOrigin=>dependencies.db||createClient(urlOrigin,env.SUPABASE_SECRET,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal||AbortSignal.timeout(20000)})}});
 try{
  if(path==='/api/health'&&request.method==='GET'){
   const configured=Boolean(allowed&&supabaseOrigin&&env.SUPABASE_SECRET&&env.MAIL_SECRET?.length>=32&&env.MAIL_ENDPOINT&&env.FIREBASE_API_KEY);
   let database='not_configured';
   if(configured){
    if(!healthCache||healthCache.until<=Date.now()){
     const check=(async()=>{try{
      const healthDb=dependencies.db||createClient(supabaseOrigin,env.SUPABASE_SECRET,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(3000)})}});
      const result=await healthDb.from('ltch_accounts').select('uid').limit(1);
      return result.error?'unavailable':'ok';
     }catch{return 'unavailable';}})();
     healthCache={until:Date.now()+30000,check};
    }
    database=await healthCache.check;
   }
   return reply(json({ok:true,version:'school-schedule-20261101',configured,ready:configured&&database==='ok',checks:{database,firebase:'not_checked',mail:'not_checked',drive:'not_checked'}}));
  }
  if(request.method==='OPTIONS'){
   demand(origin===allowed&&allowed&&path.startsWith('/api/'),403);
   demand(['GET','POST'].includes(request.headers.get('access-control-request-method')),403);
   const requested=(request.headers.get('access-control-request-headers')||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
   demand(requested.every(h=>['authorization','content-type','x-firebase-token'].includes(h)),403);
   return reply(new Response(null,{status:204,headers:{'access-control-allow-methods':'GET, POST','access-control-allow-headers':'authorization, content-type, x-firebase-token','access-control-max-age':'600','vary':'Access-Control-Request-Method, Access-Control-Request-Headers'}}));
  }
  if(path==='/api/internal/lesson-reminders'){
   const tick=await verifyReminderTick(request,env.MAIL_SECRET);
   demand(allowed&&supabaseOrigin&&env.SUPABASE_SECRET&&env.MAIL_ENDPOINT,503,'Dịch vụ chưa được cấu hình.');
   const db=createBoundedDb(supabaseOrigin);
   return reply(json(await runLessonReminders(db,env,tick)));
  }
  if(path==='/api/internal/attendance-mail'){
   const jobs=await verifyAttendanceMailRequest(request,env.MAIL_SECRET);
   demand(allowed&&supabaseOrigin&&env.SUPABASE_SECRET,503);
   const db=createBoundedDb(supabaseOrigin);
   const results=await Promise.allSettled(jobs.map(job=>resolveAttendanceMail(db,job)));
   return reply(json({items:results.map((result,index)=>({
    key:jobs[index].key,messages:result.status==='fulfilled'?result.value:null
   }))}));
  }
  if(path==='/api/notice-media'){
   demand(!origin || origin===allowed,403);
   demand(allowed && supabaseOrigin && env.SUPABASE_SECRET,503);
   const db=createBoundedDb(supabaseOrigin);
   return reply(await noticeMedia(request,{db,env}));
  }
  if(path==='/api/practice-media'){
   demand(!origin || origin===allowed,403);
   demand(allowed && env.MAIL_SECRET?.length>=32,503);
   const mediaResp=reply(await practiceMedia(request,{env,openDrive:dependencies.openDrive}));
   if(mediaResp.ok){const h=new Headers(mediaResp.headers);h.set('cache-control','private, max-age=14400, immutable');return new Response(mediaResp.body,{status:mediaResp.status,headers:h});}
   return mediaResp;
  }
  if(path==='/api/video-media'){
   demand(!origin || origin===allowed,403);
   demand(allowed && env.MAIL_SECRET?.length>=32,503);
   return reply(await videoMedia(request,{env,openDrive:dependencies.openDrive}));
  }
  demand(origin===allowed&&allowed,403,'Nguồn yêu cầu không hợp lệ.');demand(['GET','POST'].includes(request.method),405);
  if(!supabaseOrigin||!env.SUPABASE_SECRET||env.MAIL_SECRET?.length<32||!env.MAIL_SECRET||!env.MAIL_ENDPOINT||!env.FIREBASE_API_KEY) return reply(json({error:'Dịch vụ chưa được cấu hình.'},503));
  const db=createBoundedDb(supabaseOrigin),repo=createSupabaseRepository(db,{adminEmail:resolveAdminEmail(env)});
  const verify=dependencies.verify||createFirebaseVerifier({projectId:resolveFirebaseProjectId(env),apiKey:env.FIREBASE_API_KEY});
  const limit=createSupabaseRateLimiter(db);
  // Separate purpose-specific key material from the mail signing key.
  const otpKey=createHmac('sha256',env.MAIL_SECRET).update('ltch:otp-digest:v1').digest('base64url');
  // Google enforces the account's email quota; per-user/IP anti-abuse limits remain below.
  const otp=createOtpService({store:createSupabaseOtpStore(db),secret:otpKey,send:({email,code})=>sendOtpEmail({email,code,endpoint:env.MAIL_ENDPOINT,secret:env.MAIL_SECRET})});
  const auth=createAuthFlow({otp,sessions:createSupabaseSessionStore(db),verifyIdentity:verify,onVerified:user=>repo.ensureAccount(user)});
  if(path==='/api/auth/begin'||path==='/api/auth/complete'){
   demand(request.method==='POST',405);if(!await limit(request,path.endsWith('begin')?'begin':'complete'))throw new AuthError('AUTH_RATE_LIMITED','Vui lòng thử lại sau.',429,60);
   const firebaseToken=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization')||'')?.[1];
   if(path.endsWith('begin'))return reply(json(await auth.begin(firebaseToken)));
   const b=await readJson(request,2048);const session=await auth.complete(firebaseToken,b.challengeId,b.code);return reply(json({token:session.token,expiresAt:session.expiresAt}));
  }
  const session=await auth.authenticate(applicationSession(request));demand(session,401,'Vui lòng đăng nhập.');
  const identity=await verify(request.headers.get('x-firebase-token'));demand(identity.uid===session.uid,401,'Phiên đăng nhập không hợp lệ.');
  if(path==='/api/auth/logout'){demand(request.method==='POST',405);await auth.logout(applicationSession(request));return reply(json({ok:true}));}
  if(path.startsWith('/api/enrollment/')||path.startsWith('/api/admin/enrollments')){
   let actor=await repo.actor(session.uid);
   if(!actor){const raw=data(await db.from('ltch_accounts').select('uid,status,roles').eq('uid',session.uid).maybeSingle());demand(raw?.status==='pending');actor={...raw,memberships:[],childMemberships:[]};}
   return reply(await enrollment(request,path,{db,actor,env,limit}));
  }
  const actor=await repo.actor(session.uid);
  if(!actor){
   const account=data(await db.from('ltch_accounts').select('status').eq('uid',session.uid).maybeSingle());
   if(account?.status==='pending'&&path==='/api/bootstrap'&&request.method==='GET')return reply(json({accountStatus:'pending'}));
   return reply(json({code:account?.status==='pending'?'ACCOUNT_PENDING':'ACCOUNT_DISABLED',error:account?.status==='pending'?'Tài khoản đang chờ duyệt.':'Tài khoản chưa được cấp quyền hoặc đã bị khóa.'},403));
  }
  if(request.method==='POST' && (/^\/api\/classes\/[A-Za-z0-9_-]+\/forum$/.test(path)||/^\/api\/forum\/(?:posts|comments)\/[A-Za-z0-9_-]+\/(?:comments|edit|moderate|delete)$/.test(path))) demand(await limit(request,'forum'),429,'Bạn đã gửi nhiều bài viết. Vui lòng thử lại sau.');
  if(request.method==='POST' && (/^\/api\/classes\/[A-Za-z0-9_-]+\/lessons\/[A-Za-z0-9_-]+\/files$/.test(path)||/^\/api\/practice\/exams\/[A-Za-z0-9_-]+\/solutions\/files$/.test(path)||/^\/api\/notices\/[A-Za-z0-9_-]+\/files$/.test(path))) {
   demand(await limit(request,'media'),429,'Bạn đã tải nhiều tệp. Vui lòng thử lại sau.');
   demand(mediaActive===0,429,'Hệ thống đang tải một tệp khác. Vui lòng thử lại sau.');
   mediaActive++;
   try {return reply(await (dependencies.business||business)(request,path,{db,actor,env,openDrive:dependencies.openDrive}));}
   finally {mediaActive--;}
  }
  const profile=accountProfile(actor);
  if(path==='/api/bootstrap'){
   demand(request.method==='GET',405);const classes=await repo.classesFor(actor);
   return reply(json({accountStatus:'active',me:profile,classes,overview:await readOverview(db,classes)}));
  }
  if(request.method==='GET'&&path==='/api/me')return reply(json(profile));
  if(request.method==='GET'&&path==='/api/classes')return reply(json({items:await repo.classesFor(actor)}));
  const attempt=/^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/attempts\/([A-Za-z0-9_-]{16,100})$/.exec(path),exam=/^\/api\/exams\/([A-Za-z0-9_-]{1,128})$/.exec(path);
  if((request.method==='GET'&&(attempt||exam))||(request.method==='POST'&&attempt)){const m=attempt||exam;return reply(await createPracticeHandler({auth,accounts:repo,repository:createSupabasePracticeRepository(db)})(request,{examId:m[1],attemptId:m[2],action:attempt?(request.method==='POST'?'submit':'result'):'read'}));}
  const submission=/^\/api\/assignments\/([A-Za-z0-9_-]{1,128})\/submissions$/.exec(path);
  if(request.method==='POST'&&submission){
   const driveReady=Boolean(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN);
   const storage=driveReady?{
    upload:({bytes,contentType,actor,assignment,submissionId,fileName,fileIndex,fileCount})=>uploadStudentSubmissionToDrive({db,env,actor,assignment,submissionId,bytes,contentType,fileName,fileIndex,fileCount,...(dependencies.openDrive?{openDrive:dependencies.openDrive}:{})}),
    trash:async({objectPaths=[]})=>{
     const driveIds=objectPaths.filter(p=>typeof p==='string'&&p.startsWith('drive:')).map(p=>p.slice('drive:'.length));
     if(driveIds.length)await trashDriveTargetsSafe({env,driveIds,...(dependencies.openDrive?{openDrive:dependencies.openDrive}:{})});
    }
   }:configuredStorage(env);
   return reply(await createSubmissionHandler({auth,repository:repo,storage})(request,submission[1]));
  }
  return reply(await (dependencies.business||business)(request,path,{db,actor,env,openDrive:dependencies.openDrive}));
 }catch(error){
  if(!(error instanceof AuthError)&&!(error instanceof ApiError)&&!(error instanceof RangeError)){
   const reason=String(error?.message||'Unknown error').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+|(?:Bearer|Session)\s+\S+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[^\s@]+@[^\s@]+\.[^\s@]+/g,'[redacted]').slice(0,180);
   console.error('LTCH_UNEXPECTED_ERROR',{path,name:error?.name||'Error',reason});
  }
  if(error instanceof AuthError){
   const response=json({code:error.code,error:error.message,...(error.retryAfter?{retryAfter:error.retryAfter}:{})},error.status);
   if(error.retryAfter)response.headers.set('retry-after',String(error.retryAfter));
   return reply(response);
  }
  return reply(json({error:error instanceof ApiError?error.message:error instanceof RangeError?'Dữ liệu quá lớn.':'Không thể xử lý yêu cầu. Vui lòng thử lại.'},error instanceof ApiError?error.status:error instanceof RangeError?413:error instanceof SyntaxError||error instanceof TypeError?400:500));
 }
}};}
export default createWorker();
