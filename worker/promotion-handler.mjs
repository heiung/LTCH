import {randomUUID} from 'node:crypto';import {data,demand,id,isAdmin} from './policy.mjs';import {readJson,json} from './http.mjs';import promotionModule from '../server/domain/promotion.cjs';
const {planPromotion}=promotionModule;
export async function promotion(request,path,{db,actor}){
 demand(isAdmin(actor));demand(request.method==='POST',405);const b=await readJson(request);
 if(path.endsWith('/apply')){demand(b.confirm===true,400,'Cần xác nhận phương án chuyển lớp.');const count=data(await db.rpc('ltch_apply_promotion',{p_id:id(b.planId),p_actor:actor.uid}));return json({ok:true,count});}
 id(b.sourceYear);id(b.targetYear);demand(b.sourceYear!==b.targetYear,400);demand(b.routes&&typeof b.routes==='object'&&!Array.isArray(b.routes),400);
 const classes=data(await db.from('ltch_classes').select('id,name,school_year_id').eq('archived',false).in('school_year_id',[b.sourceYear,b.targetYear]));demand(classes.length<500,400,'Hãy chia thành các đợt chuyển nhỏ hơn.');const classMap=new Map(classes.map(c=>[c.id,c]));
 const memberships=classes.length?data(await db.from('ltch_class_memberships').select('uid,class_id').in('class_id',classes.map(c=>c.id)).eq('member_role','student').eq('status','active')):[];demand(memberships.length<1000,400,'Hãy chia thành các đợt chuyển nhỏ hơn.');
 const enrollments=memberships.map(m=>({studentId:m.uid,classId:m.class_id,schoolYear:classMap.get(m.class_id).school_year_id,status:'active'}));const destinations={};
 for(const e of enrollments.filter(e=>e.schoolYear===b.sourceYear))destinations[e.studentId]=b.overrides?.[e.studentId]||b.routes[e.classId];
 const result=planPromotion({sourceYear:b.sourceYear,targetYear:b.targetYear,classes:classes.map(c=>({id:c.id,schoolYear:c.school_year_id})),enrollments,destinations});
 if(!result.canApply)return json(result);
 const mapping=result.creates.map(c=>({...c,sourceClassId:enrollments.find(e=>e.studentId===c.studentId&&e.schoolYear===b.sourceYear).classId}));demand(mapping.length<=500,400);const planId=randomUUID(),expiresAt=Date.now()+900000;
 data(await db.from('ltch_promotion_plans').insert({id:planId,actor_uid:actor.uid,source_year:b.sourceYear,target_year:b.targetYear,mapping,expires_at:expiresAt}));return json({...result,planId,expiresAt});
}

