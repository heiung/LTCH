import { randomUUID } from 'node:crypto';
import { demand, id, string, data, isAdmin, staffCan } from './policy.mjs';
import { readFormData, readJson, json } from './http.mjs';
import { configuredStorage } from './submission-handler.mjs';
import {
  encodeForumPostMeta,
  decodeForumPostMeta,
  encodeForumCommentMeta,
  decodeForumCommentMeta,
  normalizeForumSessionNumber,
  computeForumStats
} from '../shared/forum-metadata.mjs';

const FILE_EXT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

// Membership, rather than a client-selected preview role, controls access.
export function forumCanRead(actor, classId) {
  return (
    isAdmin(actor) ||
    (actor?.status === 'active' &&
      actor.memberships.some(
        m =>
          m.class_id === classId &&
          ['student', 'teacher', 'assistant'].includes(m.member_role) &&
          actor.roles.includes(m.member_role)
      ))
  );
}

export function forumCanWrite(actor, classId) {
  return (
    forumCanRead(actor, classId) &&
    (staffCan(actor, classId, 'messages.write') ||
      (actor.roles.includes('student') &&
        actor.memberships.some(m => m.class_id === classId && m.member_role === 'student')))
  );
}

export function forumCanModerate(actor, classId) {
  return forumCanRead(actor, classId) && staffCan(actor, classId, 'messages.write');
}

async function safeRowsQuery(promise) {
  try {
    const res = await promise;
    if (res?.error) return [];
    return Array.isArray(res?.data) ? res.data : [];
  } catch {
    return [];
  }
}

async function removeStoragePathsSafe(env, paths = []) {
  const valid = [...new Set(paths.filter(p => typeof p === 'string' && p.length > 0))];
  if (!valid.length) return;
  const storage = configuredStorage(env);
  for (const path of valid) {
    try {
      await storage.remove({ bucket: 'ltch-materials', path });
    } catch {
      // Ignore best-effort cleanup errors after database mutation.
    }
  }
}

function resolveMemberRole(uid, accountRow, classMembershipRole, actor) {
  const roles = new Set(Array.isArray(accountRow?.roles) ? accountRow.roles : []);
  if (actor && uid === actor.uid && Array.isArray(actor.roles)) {
    for (const r of actor.roles) roles.add(r);
  }
  if (roles.has('admin')) return 'admin';
  if (classMembershipRole === 'teacher' || roles.has('teacher')) return 'teacher';
  if (classMembershipRole === 'assistant' || roles.has('assistant')) return 'assistant';
  return 'student';
}

async function resolveAuthors(db, classId, uids, actor = null) {
  const ids = [...new Set(uids.filter(Boolean))];
  if (!ids.length) return new Map();
  const [accounts, memberships] = await Promise.all([
    safeRowsQuery(db.from('ltch_accounts').select('uid,display_name,roles').in('uid', ids)),
    classId
      ? safeRowsQuery(
          db
            .from('ltch_class_memberships')
            .select('uid,member_role,status')
            .eq('class_id', classId)
            .eq('status', 'active')
            .in('uid', ids)
        )
      : []
  ]);

  const accountMap = new Map(accounts.map(a => [a.uid, a]));
  const membershipMap = new Map();
  for (const m of memberships) {
    if (!m?.uid) continue;
    const prev = membershipMap.get(m.uid);
    if (!prev || m.member_role === 'teacher') membershipMap.set(m.uid, m.member_role);
  }

  const resolved = new Map();
  for (const uid of ids) {
    const acc = accountMap.get(uid);
    const name = acc?.display_name || (actor && uid === actor.uid ? actor.name : null) || 'Thành viên';
    const role = resolveMemberRole(uid, acc, membershipMap.get(uid), actor);
    resolved.set(uid, { name, role });
  }
  return resolved;
}

async function decoratePosts(db, rows, { classId, actor, preloadedComments = null } = {}) {
  if (!rows.length) return [];
  const postIds = [...new Set(rows.map(r => r.id).filter(Boolean))];
  const comments =
    preloadedComments ||
    (postIds.length
      ? await safeRowsQuery(
          db.from('ltch_forum_comments').select('id,post_id,author_uid,created_at').in('post_id', postIds)
        )
      : []);

  const allUids = [
    ...rows.map(r => r.author_uid),
    ...comments.map(c => c.author_uid)
  ];
  const authorMap = await resolveAuthors(db, classId, allUids, actor);

  const commentsByPost = new Map();
  for (const c of comments) {
    if (!c?.post_id) continue;
    if (!commentsByPost.has(c.post_id)) commentsByPost.set(c.post_id, []);
    commentsByPost.get(c.post_id).push(c);
  }

  const canWrite = forumCanWrite(actor, classId);
  const canModerate = forumCanModerate(actor, classId);

  return rows.map(({ file_path, ...r }) => {
    const meta = decodeForumPostMeta(r.body, r.title);
    const postComments = commentsByPost.get(r.id) || [];
    const authorInfo = authorMap.get(r.author_uid) || { name: 'Thành viên', role: 'student' };
    let hasStaffReply = false;
    let latestActivityAt = Number(r.created_at) || 0;
    for (const c of postComments) {
      const cAuthor = authorMap.get(c.author_uid);
      if (cAuthor && ['admin', 'teacher', 'assistant'].includes(cAuthor.role)) {
        hasStaffReply = true;
      }
      const cTs = Number(c.created_at) || 0;
      if (cTs > latestActivityAt) latestActivityAt = cTs;
    }
    const isAuthor = r.author_uid === actor?.uid;
    return {
      ...r,
      body: meta.cleanBody,
      has_file: Boolean(file_path),
      author_name: authorInfo.name,
      author_role: authorInfo.role,
      category: meta.category,
      session_number: meta.sessionNumber,
      pinned: meta.pinned,
      resolved: meta.resolved,
      accepted_comment_id: meta.acceptedCommentId,
      locked: meta.locked,
      edited_at: meta.editedAt,
      comment_count: postComments.length,
      has_staff_reply: hasStaffReply,
      latest_activity_at: latestActivityAt,
      can_edit: Boolean(canModerate || (canWrite && isAuthor)),
      can_delete: Boolean(canModerate || (canWrite && isAuthor && postComments.length === 0)),
      can_resolve: Boolean(canModerate || (canWrite && isAuthor)),
      can_moderate: Boolean(canModerate)
    };
  });
}

async function decorateComments(db, rows, { classId, actor, postAuthorUid = null, acceptedCommentId = null } = {}) {
  if (!rows.length) return [];
  const authorMap = await resolveAuthors(
    db,
    classId,
    rows.map(r => r.author_uid),
    actor
  );
  const canWrite = forumCanWrite(actor, classId);
  const canModerate = forumCanModerate(actor, classId);

  return rows.map(({ file_path, ...r }) => {
    const meta = decodeForumCommentMeta(r.body);
    const authorInfo = authorMap.get(r.author_uid) || { name: 'Thành viên', role: 'student' };
    const isMine = r.author_uid === actor?.uid;
    return {
      ...r,
      body: meta.cleanBody,
      has_file: Boolean(file_path),
      author_name: authorInfo.name,
      author_role: authorInfo.role,
      edited_at: meta.editedAt,
      is_author_op: Boolean(postAuthorUid && r.author_uid === postAuthorUid),
      is_accepted: Boolean(acceptedCommentId && r.id === acceptedCommentId),
      can_edit: Boolean(canModerate || (canWrite && isMine)),
      can_delete: Boolean(canModerate || (canWrite && isMine))
    };
  });
}

async function page(dbQuery, request, size) {
  const params = new URL(request.url).searchParams;
  const at = params.get('beforeCreatedAt');
  const key = params.get('beforeId');
  demand((at === null) === (key === null), 400, 'Mốc diễn đàn không hợp lệ.');
  if (at !== null) {
    demand(
      /^\d{1,16}$/.test(at) && Number.isSafeInteger(Number(at)) && Number(at) <= 8640000000000000,
      400,
      'Mốc diễn đàn không hợp lệ.'
    );
    dbQuery = dbQuery.or(`created_at.lt.${Number(at)},and(created_at.eq.${Number(at)},id.lt.${id(key)})`);
  }
  const rows = data(await dbQuery.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(size + 1));
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return {
    items,
    hasMore: rows.length > size,
    nextCursor: rows.length > size && last ? { beforeCreatedAt: last.created_at, beforeId: last.id } : null
  };
}

async function attachment(form, env, classId) {
  const file = form.get('file');
  if (!file) return {};
  const ext = FILE_EXT_BY_MIME[file.type];
  demand(
    ext && typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= 10_000_000,
    400,
    'Chọn ảnh JPG, PNG hoặc PDF không rỗng, tối đa 10 MB.'
  );
  const name = string(file.name || `tep.${ext}`, 250);
  const path = `${classId}/forum/${randomUUID()}.${ext}`;
  try {
    await configuredStorage(env).upload({
      bucket: 'ltch-materials',
      path,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type
    });
  } catch {
    demand(false, 400, 'Không thể tải tệp lên. Hãy kiểm tra tệp và thử lại.');
  }
  return { file_path: path, file_name: name, content_type: file.type, file_size: file.size };
}

async function save(db, table, row, env) {
  try {
    data(await db.from(table).insert(row));
  } catch (error) {
    if (row.file_path) {
      try {
        await configuredStorage(env).remove({ bucket: 'ltch-materials', path: row.file_path });
      } catch {} // Retain the original database error.
    }
    throw error;
  }
}

async function readFlexiblePayload(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (contentType.startsWith('application/json')) {
    const body = await readJson(request, 65536);
    return { kind: 'json', data: body && typeof body === 'object' ? body : {} };
  }
  const form = await readFormData(request, 10_100_000);
  return { kind: 'form', data: form };
}

function parseBoolField(val) {
  if (typeof val === 'boolean') return val;
  const lower = String(val || '').trim().toLowerCase();
  return lower === '1' || lower === 'true';
}

export async function forum(request, path, { db, actor, env }) {
  const list = /^\/api\/classes\/([A-Za-z0-9_-]+)\/forum$/.exec(path);
  const postComments = /^\/api\/forum\/posts\/([A-Za-z0-9_-]+)\/comments$/.exec(path);
  const postDetail = /^\/api\/forum\/posts\/([A-Za-z0-9_-]+)$/.exec(path);
  const postAction = /^\/api\/forum\/posts\/([A-Za-z0-9_-]+)\/(edit|moderate|delete)$/.exec(path);
  const commentAction = /^\/api\/forum\/comments\/([A-Za-z0-9_-]+)\/(edit|delete)$/.exec(path);
  const file = /^\/api\/forum\/(posts|comments)\/([A-Za-z0-9_-]+)\/file$/.exec(path);

  if (!list && !postComments && !postDetail && !postAction && !commentAction && !file) return null;

  if (list) {
    const classId = id(list[1]);
    demand(forumCanRead(actor, classId));
    const canWrite = forumCanWrite(actor, classId);
    const canModerate = forumCanModerate(actor, classId);

    if (request.method === 'GET') {
      const result = await page(db.from('ltch_forum_posts').select('*').eq('class_id', classId), request, 100);
      const items = await decoratePosts(db, result.items, { classId, actor });
      return json({
        ...result,
        items,
        canWrite,
        canModerate,
        isStaff: staffCan(actor, classId),
        stats: computeForumStats(items, actor.uid)
      });
    }

    demand(request.method === 'POST', 405);
    demand(canWrite);
    const f = await readFormData(request, 10_100_000);
    const title = string(f.get('title'), 250);
    const rawBody = string(f.get('body'), 20000);
    const category = typeof f.get('category') === 'string' ? f.get('category').trim() : 'general';
    const sessionNumber = normalizeForumSessionNumber(f.get('sessionNumber'));
    const pinned = canModerate && parseBoolField(f.get('pinned'));
    const cleanInput = decodeForumPostMeta(rawBody, title).cleanBody.trim();
    demand(cleanInput.length > 0, 400, 'Nội dung không hợp lệ.');

    const encodedBody = encodeForumPostMeta({
      category,
      sessionNumber,
      pinned,
      body: cleanInput
    });
    demand(encodedBody.length >= 1 && encodedBody.length <= 20000, 400, 'Nội dung vượt quá giới hạn 20.000 ký tự.');

    const row = {
      id: randomUUID(),
      class_id: classId,
      author_uid: actor.uid,
      title,
      body: encodedBody,
      created_at: Date.now(),
      ...(await attachment(f, env, classId))
    };
    await save(db, 'ltch_forum_posts', row, env);
    return json({ ok: true, id: row.id }, 201);
  }

  if (postDetail) {
    demand(request.method === 'GET', 405);
    const postId = id(postDetail[1]);
    const row = data(await db.from('ltch_forum_posts').select('*').eq('id', postId).maybeSingle());
    demand(row, 404, 'Không tìm thấy bài viết.');
    demand(forumCanRead(actor, row.class_id));
    const decorated = await decoratePosts(db, [row], { classId: row.class_id, actor });
    return json({
      post: decorated[0],
      canWrite: forumCanWrite(actor, row.class_id),
      canModerate: forumCanModerate(actor, row.class_id),
      isStaff: staffCan(actor, row.class_id)
    });
  }

  if (postAction) {
    demand(request.method === 'POST', 405);
    const postId = id(postAction[1]);
    const action = postAction[2];
    const row = data(await db.from('ltch_forum_posts').select('*').eq('id', postId).maybeSingle());
    demand(row, 404, 'Không tìm thấy bài viết.');
    demand(forumCanRead(actor, row.class_id));

    const canWrite = forumCanWrite(actor, row.class_id);
    const canModerate = forumCanModerate(actor, row.class_id);
    const isAuthor = canWrite && row.author_uid === actor.uid;
    const existingMeta = decodeForumPostMeta(row.body, row.title);

    if (action === 'edit') {
      demand(canModerate || isAuthor, 403, 'Bạn không có quyền chỉnh sửa bài viết này.');
      const parsed = await readFlexiblePayload(request);
      const getVal = key => (parsed.kind === 'json' ? parsed.data[key] : parsed.data.get(key));
      const hasKey = key =>
        parsed.kind === 'json'
          ? Object.prototype.hasOwnProperty.call(parsed.data, key)
          : parsed.data.has(key);

      const nextTitle = hasKey('title') ? string(getVal('title'), 250) : row.title;
      const nextRawBody = hasKey('body') ? string(getVal('body'), 20000) : existingMeta.cleanBody;
      const cleanBody = decodeForumPostMeta(nextRawBody, nextTitle).cleanBody.trim();
      demand(cleanBody.length > 0, 400, 'Nội dung không hợp lệ.');

      const nextCategory = hasKey('category')
        ? String(getVal('category') || 'general').trim()
        : existingMeta.category;
      const nextSession = hasKey('sessionNumber')
        ? normalizeForumSessionNumber(getVal('sessionNumber'))
        : existingMeta.sessionNumber;

      const encodedBody = encodeForumPostMeta({
        category: nextCategory,
        sessionNumber: nextSession,
        pinned: existingMeta.pinned,
        resolved: existingMeta.resolved,
        acceptedCommentId: existingMeta.acceptedCommentId,
        locked: existingMeta.locked,
        editedAt: Date.now(),
        body: cleanBody
      });
      demand(encodedBody.length >= 1 && encodedBody.length <= 20000, 400, 'Nội dung vượt quá giới hạn 20.000 ký tự.');

      const uploaded = parsed.kind === 'form' ? await attachment(parsed.data, env, row.class_id) : {};
      const shouldRemoveFile = !uploaded.file_path && parseBoolField(getVal('removeFile'));
      const patch = {
        title: nextTitle,
        body: encodedBody,
        ...(uploaded.file_path ? uploaded : {}),
        ...(shouldRemoveFile ? { file_path: null, file_name: null, content_type: null, file_size: null } : {})
      };

      try {
        data(await db.from('ltch_forum_posts').update(patch).eq('id', row.id));
      } catch (error) {
        if (uploaded.file_path) await removeStoragePathsSafe(env, [uploaded.file_path]);
        throw error;
      }

      if ((uploaded.file_path || shouldRemoveFile) && row.file_path) {
        await removeStoragePathsSafe(env, [row.file_path]);
      }

      const updatedRow = { ...row, ...patch };
      const decorated = await decoratePosts(db, [updatedRow], { classId: row.class_id, actor });
      return json({ ok: true, post: decorated[0] });
    }

    if (action === 'moderate') {
      demand(canModerate || isAuthor, 403, 'Bạn không có quyền cập nhật trạng thái bài viết.');
      const body = await readJson(request, 16384);
      const hasPinned = Object.prototype.hasOwnProperty.call(body, 'pinned');
      const hasLocked = Object.prototype.hasOwnProperty.call(body, 'locked');
      const hasResolved = Object.prototype.hasOwnProperty.call(body, 'resolved');
      const hasAccepted = Object.prototype.hasOwnProperty.call(body, 'acceptedCommentId');
      demand(hasPinned || hasLocked || hasResolved || hasAccepted, 400, 'Thiếu thông tin cập nhật.');

      if (hasPinned || hasLocked) {
        demand(canModerate, 403, 'Chỉ giáo viên hoặc trợ giảng có quyền mới được ghim hoặc khóa chủ đề.');
      }

      let nextPinned = existingMeta.pinned;
      let nextLocked = existingMeta.locked;
      let nextResolved = existingMeta.resolved;
      let nextAccepted = existingMeta.acceptedCommentId;

      if (hasPinned) {
        demand(typeof body.pinned === 'boolean', 400, 'Trạng thái ghim không hợp lệ.');
        nextPinned = body.pinned;
      }
      if (hasLocked) {
        demand(typeof body.locked === 'boolean', 400, 'Trạng thái khóa không hợp lệ.');
        nextLocked = body.locked;
      }
      if (hasAccepted) {
        if (body.acceptedCommentId === null || body.acceptedCommentId === '') {
          nextAccepted = null;
        } else {
          const cid = id(body.acceptedCommentId);
          const commentRow = data(
            await db.from('ltch_forum_comments').select('id,post_id').eq('id', cid).maybeSingle()
          );
          demand(
            commentRow && commentRow.post_id === row.id,
            400,
            'Không tìm thấy câu trả lời hợp lệ trong bài viết này.'
          );
          nextAccepted = commentRow.id;
          nextResolved = true;
        }
      }
      if (hasResolved) {
        demand(typeof body.resolved === 'boolean', 400, 'Trạng thái giải đáp không hợp lệ.');
        nextResolved = body.resolved;
        if (!nextResolved) nextAccepted = null;
      }

      const encodedBody = encodeForumPostMeta({
        category: existingMeta.category,
        sessionNumber: existingMeta.sessionNumber,
        pinned: nextPinned,
        resolved: nextResolved,
        acceptedCommentId: nextAccepted,
        locked: nextLocked,
        editedAt: existingMeta.editedAt,
        body: existingMeta.cleanBody
      });
      demand(encodedBody.length >= 1 && encodedBody.length <= 20000, 400, 'Nội dung vượt quá giới hạn 20.000 ký tự.');

      data(await db.from('ltch_forum_posts').update({ body: encodedBody }).eq('id', row.id));
      const updatedRow = { ...row, body: encodedBody };
      const decorated = await decoratePosts(db, [updatedRow], { classId: row.class_id, actor });
      return json({ ok: true, post: decorated[0] });
    }

    // action === 'delete'
    const postCommentsList = await safeRowsQuery(
      db.from('ltch_forum_comments').select('id,file_path').eq('post_id', row.id)
    );
    demand(
      canModerate || (isAuthor && postCommentsList.length === 0),
      403,
      postCommentsList.length > 0
        ? 'Bài viết đã có câu trả lời, chỉ Ban điều hành mới có quyền xóa.'
        : 'Bạn không có quyền xóa bài viết này.'
    );

    if (postCommentsList.length > 0) {
      data(await db.from('ltch_forum_comments').delete().eq('post_id', row.id));
    }
    data(await db.from('ltch_forum_posts').delete().eq('id', row.id));
    await removeStoragePathsSafe(env, [
      row.file_path,
      ...postCommentsList.map(c => c.file_path)
    ]);
    return json({ ok: true, deletedPostId: row.id });
  }

  if (postComments) {
    const row = data(
      await db.from('ltch_forum_posts').select('id,class_id,author_uid,title,body').eq('id', id(postComments[1])).maybeSingle()
    );
    demand(row, 404, 'Không tìm thấy bài viết.');
    demand(forumCanRead(actor, row.class_id));
    const postMeta = decodeForumPostMeta(row.body, row.title);
    const canWrite = forumCanWrite(actor, row.class_id);
    const canModerate = forumCanModerate(actor, row.class_id);

    if (request.method === 'GET') {
      const result = await page(db.from('ltch_forum_comments').select('*').eq('post_id', row.id), request, 200);
      const items = await decorateComments(db, result.items.reverse(), {
        classId: row.class_id,
        actor,
        postAuthorUid: row.author_uid,
        acceptedCommentId: postMeta.acceptedCommentId
      });
      return json({
        ...result,
        items,
        canWrite,
        canModerate
      });
    }

    demand(request.method === 'POST', 405);
    demand(canWrite);
    if (postMeta.locked && !canModerate) {
      demand(false, 403, 'Chủ đề này đã được khóa bình luận.');
    }
    const f = await readFormData(request, 10_100_000);
    const rawBody = string(f.get('body'), 20000);
    const cleanInput = decodeForumCommentMeta(rawBody).cleanBody.trim();
    demand(cleanInput.length > 0, 400, 'Nội dung không hợp lệ.');

    const commentId = randomUUID();
    await save(
      db,
      'ltch_forum_comments',
      {
        id: commentId,
        post_id: row.id,
        author_uid: actor.uid,
        body: cleanInput,
        created_at: Date.now(),
        ...(await attachment(f, env, row.class_id))
      },
      env
    );
    return json({ ok: true, id: commentId }, 201);
  }

  if (commentAction) {
    demand(request.method === 'POST', 405);
    const commentId = id(commentAction[1]);
    const action = commentAction[2];
    const comment = data(await db.from('ltch_forum_comments').select('*').eq('id', commentId).maybeSingle());
    demand(comment, 404, 'Không tìm thấy câu trả lời.');
    const parentPost = data(
      await db.from('ltch_forum_posts').select('id,class_id,author_uid,title,body').eq('id', comment.post_id).maybeSingle()
    );
    demand(parentPost, 404, 'Không tìm thấy bài viết.');
    demand(forumCanRead(actor, parentPost.class_id));

    const canWrite = forumCanWrite(actor, parentPost.class_id);
    const canModerate = forumCanModerate(actor, parentPost.class_id);
    const isMine = canWrite && comment.author_uid === actor.uid;
    demand(canModerate || isMine, 403, 'Bạn không có quyền thực hiện thao tác này.');

    const parentMeta = decodeForumPostMeta(parentPost.body, parentPost.title);

    if (action === 'edit') {
      const parsed = await readFlexiblePayload(request);
      const getVal = key => (parsed.kind === 'json' ? parsed.data[key] : parsed.data.get(key));
      const rawBody = string(getVal('body'), 20000);
      const cleanBody = decodeForumCommentMeta(rawBody).cleanBody.trim();
      demand(cleanBody.length > 0, 400, 'Nội dung không hợp lệ.');
      const encodedBody = encodeForumCommentMeta({ editedAt: Date.now(), body: cleanBody });
      demand(encodedBody.length >= 1 && encodedBody.length <= 20000, 400, 'Nội dung vượt quá giới hạn 20.000 ký tự.');

      const uploaded = parsed.kind === 'form' ? await attachment(parsed.data, env, parentPost.class_id) : {};
      const shouldRemoveFile = !uploaded.file_path && parseBoolField(getVal('removeFile'));
      const patch = {
        body: encodedBody,
        ...(uploaded.file_path ? uploaded : {}),
        ...(shouldRemoveFile ? { file_path: null, file_name: null, content_type: null, file_size: null } : {})
      };

      try {
        data(await db.from('ltch_forum_comments').update(patch).eq('id', comment.id));
      } catch (error) {
        if (uploaded.file_path) await removeStoragePathsSafe(env, [uploaded.file_path]);
        throw error;
      }

      if ((uploaded.file_path || shouldRemoveFile) && comment.file_path) {
        await removeStoragePathsSafe(env, [comment.file_path]);
      }

      const decorated = await decorateComments(db, [{ ...comment, ...patch }], {
        classId: parentPost.class_id,
        actor,
        postAuthorUid: parentPost.author_uid,
        acceptedCommentId: parentMeta.acceptedCommentId
      });
      return json({ ok: true, comment: decorated[0] });
    }

    // action === 'delete'
    data(await db.from('ltch_forum_comments').delete().eq('id', comment.id));
    if (comment.file_path) {
      await removeStoragePathsSafe(env, [comment.file_path]);
    }
    if (parentMeta.acceptedCommentId === comment.id) {
      const updatedParentBody = encodeForumPostMeta({
        category: parentMeta.category,
        sessionNumber: parentMeta.sessionNumber,
        pinned: parentMeta.pinned,
        resolved: false,
        acceptedCommentId: null,
        locked: parentMeta.locked,
        editedAt: parentMeta.editedAt,
        body: parentMeta.cleanBody
      });
      data(await db.from('ltch_forum_posts').update({ body: updatedParentBody }).eq('id', parentPost.id));
    }
    return json({ ok: true, deletedCommentId: comment.id });
  }

  // file download / inline preview
  demand(request.method === 'GET', 405);
  const record = data(await db.from(`ltch_forum_${file[1]}`).select('*').eq('id', id(file[2])).maybeSingle());
  demand(record && record.file_path, 404, 'Không tìm thấy tệp.');
  const owner =
    file[1] === 'posts'
      ? record
      : data(await db.from('ltch_forum_posts').select('class_id').eq('id', record.post_id).maybeSingle());
  demand(owner && forumCanRead(actor, owner.class_id));
  const upstream = await configuredStorage(env).download({ bucket: 'ltch-materials', path: record.file_path });
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  const ext = FILE_EXT_BY_MIME[record.content_type] || 'bin';
  return new Response(upstream.body, {
    headers: {
      'content-type': record.content_type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="forum-${record.id}.${ext}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
