const check = r => {if(r.error)throw new Error('Database request failed');return r.data;};
const valid=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
export function createSupabasePracticeRepository(db) {
 return {
  async getExam(id) {
   if(!valid(id))return null;
   const e=check(await db.from('ltch_exams').select('id,class_id,title,status,opens_at,closes_at,results_at,solutions_at,questions').eq('id',id).maybeSingle());
   return e ? {id:e.id,classId:e.class_id,title:e.title,status:e.status,opensAt:e.opens_at,closesAt:e.closes_at,resultsAt:e.results_at,solutionsAt:e.solutions_at,questions:e.questions} : null;
  },
  async saveAttemptOnce(a) {
   if(!valid(a.attemptId)||!valid(a.examId)||!valid(a.uid))throw new TypeError('Invalid attempt');
   const r=await db.from('ltch_practice_attempts').insert({id:a.attemptId,exam_id:a.examId,uid:a.uid,submitted_at:a.submittedAt,responses:a.responses,score:a.score,max_score:a.max,results:a.results});
   if(r.error?.code==='23505')return false;check(r);return true;
  },
  async getAttempt(id) {
   if(!valid(id))return null;
   const a=check(await db.from('ltch_practice_attempts').select('id,exam_id,uid,submitted_at,score,max_score,results').eq('id',id).maybeSingle());
   return a ? {attemptId:a.id,examId:a.exam_id,uid:a.uid,submittedAt:a.submitted_at,score:a.score,max:a.max_score,results:a.results} : null;
  }
 };
}
