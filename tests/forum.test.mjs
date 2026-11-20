import test from 'node:test';
import assert from 'node:assert/strict';
import {forum,forumCanRead,forumCanWrite} from '../worker/forum.mjs';

const actor=(role, cls='c', permissions=[], uid=role)=>({uid,status:'active',roles:[role],memberships:role==='parent'?[]:[{class_id:cls,member_role:role,permissions}],childMemberships:role==='parent'?[{class_id:cls,uid:'student'}]:[]});
function database() {
 const tables={ltch_forum_posts:[],ltch_forum_comments:[],ltch_class_memberships:[],ltch_accounts:[{uid:'student',display_name:'Học sinh',roles:['student']},{uid:'student2',display_name:'Học sinh 2',roles:['student']},{uid:'teacher',display_name:'Giáo viên',roles:['teacher']},{uid:'assistant',display_name:'Trợ giảng',roles:['assistant']},{uid:'admin',display_name:'Quản trị',roles:['admin']}]};
 return {tables,from(name){
  let rows=tables[name]||(tables[name]=[]),filters=[],single=false,ordering=[],max=Infinity,mode='select',patchData=null;
  const q={select(){mode='select';return q;},update(patch){mode='update';patchData=patch;return q;},delete(){mode='delete';return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},or(expr){const m=/^created_at\.lt\.(\d+),and\(created_at\.eq\.\d+,id\.lt\.([A-Za-z0-9_-]+)\)$/.exec(expr);assert.ok(m);filters.push(r=>r.created_at<Number(m[1])||r.created_at===Number(m[1])&&r.id<m[2]);return q;},order(k,{ascending=true}={}){ordering.push([k,ascending]);return q;},limit(n){max=n;return q;},maybeSingle(){single=true;return q;},insert(row){rows.push({...row});return Promise.resolve({data:null,error:null});},then(resolve,reject){
   if(mode==='update'){for(const r of rows){if(filters.every(f=>f(r)))Object.assign(r,patchData);}return Promise.resolve({data:null,error:null}).then(resolve,reject);}
   if(mode==='delete'){for(let i=rows.length-1;i>=0;i--){if(filters.every(f=>f(rows[i])))rows.splice(i,1);}return Promise.resolve({data:null,error:null}).then(resolve,reject);}
   let result=rows.filter(r=>filters.every(f=>f(r)));if(ordering.length)result.sort((a,b)=>{for(const [k,asc] of ordering){const diff=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(diff)return diff*(asc?1:-1);}return 0;});result=result.slice(0,max).map(r=>({...r}));return Promise.resolve({data:single?result[0]||null:result,error:null}).then(resolve,reject);
  }};return q;
 }};
}
const req=(path,body)=>new Request(`https://test${path}`,body?{method:'POST',body}:undefined);
const jsonReq=(path,body)=>new Request(`https://test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const form=data=>{const f=new FormData();for(const [k,v] of Object.entries(data))f.set(k,v);return f;};
test('forum access is confined to assigned students and staff; assistant writes require a grant',()=>{
 for(const role of ['student','teacher','assistant'])assert.equal(forumCanRead(actor(role),'c'),true);
 assert.equal(forumCanRead(actor('parent'),'c'),false);
 assert.equal(forumCanRead(actor('student','other'),'c'),false);
 assert.equal(forumCanRead({...actor('admin'),status:'disabled'},'c'),false);
 assert.equal(forumCanWrite(actor('assistant'),'c'),false);
 assert.equal(forumCanWrite(actor('assistant','c',['messages.write']),'c'),true);
 assert.equal(forumCanWrite(actor('student'),'c'),true);
 assert.equal(forumCanWrite(actor('admin'),'c'),true);
});
test('students post questions and assigned teachers answer; other classes cannot read or reply',async()=>{
 const db=database(),ctx={db,env:{}},path='/api/classes/c/forum';
 let res=await forum(req(path,form({title:'Bài toán',body:'Giúp em giải bài này'})),path,{...ctx,actor:actor('student')});assert.equal(res.status,201);
 const postId=db.tables.ltch_forum_posts[0].id, comments=`/api/forum/posts/${postId}/comments`;
 res=await forum(req(comments,form({body:'Lời giải'})),comments,{...ctx,actor:actor('teacher')});assert.equal(res.status,201);
 res=await forum(req(path),path,{...ctx,actor:actor('student')});const listing=await res.json();assert.equal(listing.items[0].author_name,'Học sinh');assert.equal(listing.items[0].body,'Giúp em giải bài này');
 res=await forum(req(comments),comments,{...ctx,actor:actor('student')});assert.equal((await res.json()).items[0].author_name,'Giáo viên');
 for(const outsider of [actor('student','other'),actor('parent'),actor('assistant','other')]){
  await assert.rejects(forum(req(path),path,{...ctx,actor:outsider}),e=>e.status===403);
  await assert.rejects(forum(req(comments),comments,{...ctx,actor:outsider}),e=>e.status===403);
  await assert.rejects(forum(req(comments,form({body:'Lời giải'})),comments,{...ctx,actor:outsider}),e=>e.status===403);
 }
 await assert.rejects(forum(req(comments,form({body:'Lời giải'})),comments,{...ctx,actor:actor('assistant')}),e=>e.status===403);
});
test('forum never returns private storage paths and checks membership before file access',async()=>{
 const db=database();db.tables.ltch_forum_posts.push({id:'p',class_id:'c',author_uid:'student',title:'Bài',body:'Nội dung',created_at:1,file_path:'c/forum/private.pdf',file_name:'bai.pdf',content_type:'application/pdf',file_size:10});
 const ctx={db,env:{},actor:actor('student')},path='/api/classes/c/forum';
 const payload=await (await forum(req(path),path,ctx)).json();assert.equal(payload.items[0].has_file,true);assert.equal('file_path' in payload.items[0],false);
 const file='/api/forum/posts/p/file';await assert.rejects(forum(req(file),file,{...ctx,actor:actor('student','other')}),e=>e.status===403);
});
test('forum pages remain stable when posts share a timestamp',async()=>{
 const db=database(),path='/api/classes/c/forum',ctx={db,env:{},actor:actor('student')};
 for(let i=0;i<205;i++)db.tables.ltch_forum_posts.push({id:`p${String(i).padStart(3,'0')}`,class_id:'c',author_uid:'student',title:'Bài',body:'Nội dung',created_at:100});
 let query=path,items=[];
 do {const result=await (await forum(req(query),path,ctx)).json();items.push(...result.items);query=result.nextCursor?`${path}?beforeCreatedAt=${result.nextCursor.beforeCreatedAt}&beforeId=${result.nextCursor.beforeId}`:null;} while(query);
 assert.equal(items.length,205);assert.equal(new Set(items.map(x=>x.id)).size,205);
 await assert.rejects(forum(req(`${path}?beforeCreatedAt=1`),path,ctx),e=>e.status===400);
});
test('forum accepts an actual PNG, rejects a disguised file, and removes the upload if saving fails',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return new Response('ok',{status:200});};
 const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_SECRET:'test-secret'},path='/api/classes/c/forum';
 const png=new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])],'bai.png',{type:'image/png'});
 try {
  const db=database(),ctx={db,env,actor:actor('student')};
  await forum(req(path,form({title:'Ảnh bài tập',body:'Giúp em',file:png})),path,ctx);
  assert.match(db.tables.ltch_forum_posts[0].file_path,/^c\/forum\//);assert.equal(calls.at(-1).method,'POST');
  const filePath=`/api/forum/posts/${db.tables.ltch_forum_posts[0].id}/file`;
  const download=await forum(req(filePath),filePath,ctx);assert.equal(download.headers.get('content-type'),'image/png');assert.equal(download.headers.get('cache-control'),'no-store');assert.equal(calls.at(-1).method,'GET');
  const bad=new File(['not an image'],'fake.png',{type:'image/png'});
  await assert.rejects(forum(req(path,form({title:'Sai',body:'Sai',file:bad})),path,ctx),e=>e.status===400);
  assert.equal(db.tables.ltch_forum_posts.length,1);
  const failing={from(){return {insert(){return Promise.resolve({error:{message:'db failed'}});}};}};
  await assert.rejects(forum(req(path,form({title:'Lỗi',body:'Lỗi',file:png})),path,{db:failing,env,actor:actor('student')}),e=>e.status===503);
  assert.equal(calls.at(-1).method,'DELETE');
 } finally {globalThis.fetch=original;}
});

test('forum metadata, pin permissions, and detail endpoint enforce strict role isolation', async () => {
  const db = database();
  const ctx = { db, env: {} };
  const listPath = '/api/classes/c/forum';

  // Student tries to spoof pinned=1 -> stripped; category and sessionNumber saved cleanly without leaking raw prefix
  const stuRes = await forum(
    req(listPath, form({ title: 'BTVN câu 3', body: 'Em hỏi $x^2=4$', category: 'homework', sessionNumber: '4', pinned: '1' })),
    listPath,
    { ...ctx, actor: actor('student') }
  );
  assert.equal(stuRes.status, 201);
  const { id: stuPostId } = await stuRes.json();

  // Teacher creates pinned post
  const teaRes = await forum(
    req(listPath, form({ title: 'Quy ước buổi 4', body: 'Nộp trước 20h', category: 'lesson', sessionNumber: '4', pinned: '1' })),
    listPath,
    { ...ctx, actor: actor('teacher') }
  );
  assert.equal(teaRes.status, 201);
  const { id: teaPostId } = await teaRes.json();

  const listing = await (await forum(req(listPath), listPath, { ...ctx, actor: actor('student') })).json();
  const stuPost = listing.items.find(p => p.id === stuPostId);
  const teaPost = listing.items.find(p => p.id === teaPostId);
  assert.equal(stuPost.category, 'homework');
  assert.equal(stuPost.session_number, 4);
  assert.equal(stuPost.pinned, false);
  assert.equal(stuPost.body, 'Em hỏi $x^2=4$');
  assert.equal(stuPost.body.includes('[[ltch-forum:'), false);
  assert.equal(teaPost.pinned, true);

  // Detail endpoint
  const detailPath = `/api/forum/posts/${stuPostId}`;
  const detail = await (await forum(req(detailPath), detailPath, { ...ctx, actor: actor('student') })).json();
  assert.equal(detail.post.id, stuPostId);
  assert.equal(detail.canWrite, true);
  await assert.rejects(forum(req(detailPath), detailPath, { ...ctx, actor: actor('parent') }), e => e.status === 403);
  await assert.rejects(forum(req(detailPath), detailPath, { ...ctx, actor: actor('student', 'other') }), e => e.status === 403);
  await assert.rejects(forum(req('/api/forum/posts/missing-id'), '/api/forum/posts/missing-id', { ...ctx, actor: actor('student') }), e => e.status === 404);
});

test('forum edit, moderation, lock enforcement, comment CRUD, delete, and inline preview work end-to-end', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method || 'GET' });
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
  };

  try {
    const db = database();
    const env = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_SECRET: 'test-secret' };
    const ctx = { db, env };
    const listPath = '/api/classes/c/forum';
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])], 'de.png', { type: 'image/png' });

    // 1. Author posts with attachment
    const createRes = await forum(
      req(listPath, form({ title: 'Câu 7 hình học', body: 'Nhờ cô xem hình', category: 'homework', sessionNumber: '2', file: png })),
      listPath,
      { ...ctx, actor: actor('student') }
    );
    const { id: postId } = await createRes.json();

    // Inline file preview returns inline content-disposition
    const inlineRes = await forum(req(`/api/forum/posts/${postId}/file?inline=1`), `/api/forum/posts/${postId}/file`, { ...ctx, actor: actor('student') });
    assert.match(inlineRes.headers.get('content-disposition'), /^inline;/);

    // Non-author student rejected 403 on edit
    await assert.rejects(
      forum(jsonReq(`/api/forum/posts/${postId}/edit`, { title: 'Sửa trộm', body: 'Nội dung khác' }), `/api/forum/posts/${postId}/edit`, { ...ctx, actor: actor('student', 'c', [], 'student2') }),
      e => e.status === 403
    );

    // Author edits metadata & removes attachment -> DELETE triggered in storage
    const editRes = await forum(
      req(`/api/forum/posts/${postId}/edit`, form({ title: 'Câu 7 (đã bổ sung)', body: 'Cho tam giác ABC', category: 'exam', sessionNumber: '6', removeFile: '1' })),
      `/api/forum/posts/${postId}/edit`,
      { ...ctx, actor: actor('student') }
    );
    const edited = await editRes.json();
    assert.equal(edited.post.title, 'Câu 7 (đã bổ sung)');
    assert.equal(edited.post.category, 'exam');
    assert.equal(edited.post.session_number, 6);
    assert.equal(edited.post.has_file, false);
    assert.ok(edited.post.edited_at > 0);
    assert.equal(fetchCalls.some(c => c.method === 'DELETE'), true);

    // Create a second post and comment on it to test cross-post acceptedCommentId rejection
    const otherPostRes = await forum(req(listPath, form({ title: 'Bài khác', body: 'Nội dung khác' })), listPath, { ...ctx, actor: actor('student', 'c', [], 'student2') });
    const { id: otherPostId } = await otherPostRes.json();
    const otherCommentRes = await forum(req(`/api/forum/posts/${otherPostId}/comments`, form({ body: 'Trả lời bài khác' })), `/api/forum/posts/${otherPostId}/comments`, { ...ctx, actor: actor('teacher') });
    const { id: otherCommentId } = await otherCommentRes.json();

    // Teacher adds a reply with attachment on postId
    const cmRes = await forum(
      req(`/api/forum/posts/${postId}/comments`, form({ body: 'Đáp án là $\\frac{1}{2}$', file: png })),
      `/api/forum/posts/${postId}/comments`,
      { ...ctx, actor: actor('teacher') }
    );
    const { id: commentId } = await cmRes.json();

    // Student cannot pin or lock (403)
    await assert.rejects(
      forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { pinned: true }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('student') }),
      e => e.status === 403
    );
    await assert.rejects(
      forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { locked: true }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('student') }),
      e => e.status === 403
    );

    // Reject acceptedCommentId from a different post (400)
    await assert.rejects(
      forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { acceptedCommentId: otherCommentId }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('teacher') }),
      e => e.status === 400
    );

    // Author accepts comment -> resolved=true & accepted_comment_id set
    const acceptRes = await (await forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { acceptedCommentId: commentId }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('student') })).json();
    assert.equal(acceptRes.post.resolved, true);
    assert.equal(acceptRes.post.accepted_comment_id, commentId);

    // Reopening (resolved: false) clears accepted_comment_id
    const reopenRes = await (await forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { resolved: false }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('student') })).json();
    assert.equal(reopenRes.post.resolved, false);
    assert.equal(reopenRes.post.accepted_comment_id, null);

    // Teacher pins, locks, and re-accepts commentId
    const lockRes = await (await forum(jsonReq(`/api/forum/posts/${postId}/moderate`, { pinned: true, locked: true, acceptedCommentId: commentId }), `/api/forum/posts/${postId}/moderate`, { ...ctx, actor: actor('teacher') })).json();
    assert.equal(lockRes.post.pinned, true);
    assert.equal(lockRes.post.locked, true);
    assert.equal(lockRes.post.accepted_comment_id, commentId);

    // Locked post blocks student comments (403) while teacher can still reply (201)
    await assert.rejects(
      forum(req(`/api/forum/posts/${postId}/comments`, form({ body: 'Em hỏi thêm' })), `/api/forum/posts/${postId}/comments`, { ...ctx, actor: actor('student') }),
      e => e.status === 403
    );
    const staffReplyRes = await forum(req(`/api/forum/posts/${postId}/comments`, form({ body: 'Cô bổ sung thêm lưu ý' })), `/api/forum/posts/${postId}/comments`, { ...ctx, actor: actor('teacher') });
    assert.equal(staffReplyRes.status, 201);
    const { id: staffReplyId } = await staffReplyRes.json();

    // Comment edit updates cleanBody and sets edited_at
    const editCmRes = await (await forum(jsonReq(`/api/forum/comments/${commentId}/edit`, { body: 'Đáp án đúng là $\\frac{1}{4}$' }), `/api/forum/comments/${commentId}/edit`, { ...ctx, actor: actor('teacher') })).json();
    assert.equal(editCmRes.comment.body, 'Đáp án đúng là $\\frac{1}{4}$');
    assert.ok(editCmRes.comment.edited_at > 0);

    // Deleting accepted comment clears accepted_comment_id & resolved on parent post
    fetchCalls.length = 0;
    const delCmRes = await (await forum(jsonReq(`/api/forum/comments/${commentId}/delete`, {}), `/api/forum/comments/${commentId}/delete`, { ...ctx, actor: actor('teacher') })).json();
    assert.equal(delCmRes.ok, true);
    assert.equal(fetchCalls.some(c => c.method === 'DELETE'), true);
    const afterCmDel = await (await forum(req(`/api/forum/posts/${postId}`), `/api/forum/posts/${postId}`, { ...ctx, actor: actor('teacher') })).json();
    assert.equal(afterCmDel.post.accepted_comment_id, null);
    assert.equal(afterCmDel.post.resolved, false);

    // Student cannot delete post while comments still exist (staffReplyId remains)
    await assert.rejects(
      forum(jsonReq(`/api/forum/posts/${postId}/delete`, {}), `/api/forum/posts/${postId}/delete`, { ...ctx, actor: actor('student') }),
      e => e.status === 403
    );

    // Teacher deletes post even with comments remaining -> cleans up comments & post
    const delPostRes = await (await forum(jsonReq(`/api/forum/posts/${postId}/delete`, {}), `/api/forum/posts/${postId}/delete`, { ...ctx, actor: actor('teacher') })).json();
    assert.equal(delPostRes.ok, true);
    assert.equal(db.tables.ltch_forum_posts.some(p => p.id === postId), false);
    assert.equal(db.tables.ltch_forum_comments.some(c => c.id === staffReplyId), false);

    // Unreplied student post can be deleted by its student author
    const soloRes = await forum(req(listPath, form({ title: 'Tự xóa', body: 'Nhầm lớp' })), listPath, { ...ctx, actor: actor('student') });
    const { id: soloId } = await soloRes.json();
    const delSolo = await (await forum(jsonReq(`/api/forum/posts/${soloId}/delete`, {}), `/api/forum/posts/${soloId}/delete`, { ...ctx, actor: actor('student') })).json();
    assert.equal(delSolo.deletedPostId, soloId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
