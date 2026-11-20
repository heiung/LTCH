import {classCanRead,staffCan,studentScope} from './policy.mjs';
import { applicationSession } from './http.mjs';
import practiceModule from '../server/domain/practice.cjs';
const {createPracticeService}=practiceModule;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function createPracticeHandler({auth,accounts,repository,clock}) {
 const service=createPracticeService({
  repository,
  clock,
  authorize:async(actor,exam,action)=>action==='result'?classCanRead(actor,exam.classId):actor.roles.includes('student')&&actor.memberships.some(m=>m.class_id===exam.classId&&m.member_role==='student'),
  canReadAttempt:async(actor,exam,attempt)=>classCanRead(actor,exam.classId)&&(staffCan(actor,exam.classId)||(studentScope(actor,exam.classId)||[]).includes(attempt.uid))
 });
 return async (request,{examId,attemptId,action})=>{
  try {
   const token=applicationSession(request);
   const session=await auth.authenticate(token);if(!session)return json({error:'Vui lòng đăng nhập.'},401);
   const actor=await accounts.actor(session.uid);if(!actor)return json({error:'Không có quyền truy cập.'},403);
   if(action==='read')return json(await service.read(actor,examId));
   if(action==='result')return json(await service.result(actor,examId,attemptId));
   if(action==='submit'){
    const n=Number(request.headers.get('content-length')||0);if(!Number.isFinite(n)||n>65536)return json({error:'Dữ liệu quá lớn.'},413);
    if(!request.body)return json({error:'Dữ liệu không hợp lệ.'},400);
    const reader=request.body.getReader();let size=0,chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return json({error:'Dữ liệu quá lớn.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));return json(await service.submit(actor,examId,attemptId,body.responses),201);
   }
   return json({error:'Không tìm thấy.'},404);
  }catch(_){return json({error:'Không thể xử lý yêu cầu.'},400);}
 };
}


