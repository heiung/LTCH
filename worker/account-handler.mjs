import { applicationSession } from './http.mjs';
import {accountProfile} from './policy.mjs';
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function createAccountHandler({auth,repository}) {
 return async function handle(request,path) {
  const token=applicationSession(request);
  const session=await auth.authenticate(token);if(!session)return response({error:'Vui lòng đăng nhập.'},401);
  const actor=await repository.actor(session.uid);if(!actor)return response({error:'Tài khoản chưa được cấp quyền.'},403);
  if(path==='/api/me')return response(accountProfile(actor));
  if(path==='/api/classes')return response({items:await repository.classesFor(actor)});
  return response({error:'Không tìm thấy.'},404);
 };
}

