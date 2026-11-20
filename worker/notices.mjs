import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {ApiError, classCanRead, data, demand, id, isAdmin, staffCan, string} from './policy.mjs';
import {json, readBytes, readJson} from './http.mjs';
import {configuredDrive, folderName, openDriveUploadToken, sealDriveUploadToken} from './lesson-storage.mjs';
import {ensureDriveFolder} from './drive-folders.mjs';
import {matchesDriveFile, requireAllowedSharing} from './drive-preview.mjs';
import {createSupabaseRepository} from './supabase-repository.mjs';
import {deliverNotification} from './mail-queue.mjs';
import {noticeMediaTypes, noticeMaxImageBytes, noticeMaxVideoBytes} from '../shared/notice-media.mjs';
import {
  decodeLegacyNoticeReads,
  encodeLegacyNoticeReads,
  isMissingNoticeReadsTableError,
  mergeNoticeReads,
  stripLegacyNoticeReads,
  summarizeNoticeReads
} from '../shared/notice-reads.mjs';
import {loadNoticeReadRows} from './notice-queries.mjs';
import {resolveApiOrigin} from './config.mjs';

const uploadPurpose = 'ltch-notice-upload-v1';
const mediaTypes = new Set(noticeMediaTypes);
const ticketLifetime = 2 * 60 * 60 * 1000;
const READ_ROLE_LABELS = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh',
  parent: 'Phụ huynh'
};
const READ_ROLE_PRIORITY = ['admin', 'teacher', 'assistant', 'student', 'parent'];

function compareViNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'vi', {sensitivity: 'base'});
}

async function recordNoticeRead(db, notice, actorUid, now = Date.now()) {
  const upsertRes = await db
    .from('ltch_notice_reads')
    .upsert({notice_id: notice.id, uid: actorUid, seen_at: now}, {onConflict: 'notice_id,uid', ignoreDuplicates: true});

  if (!upsertRes?.error) {
    const existing = data(
      await db
        .from('ltch_notice_reads')
        .select('seen_at')
        .eq('notice_id', notice.id)
        .eq('uid', actorUid)
        .maybeSingle()
    );
    const {reads: legacyReads} = decodeLegacyNoticeReads(notice.body);
    const tableTs = Number(existing?.seen_at);
    const legacyTs = Number(legacyReads[actorUid]);
    const candidates = [tableTs, legacyTs].filter(ts => Number.isSafeInteger(ts) && ts > 0);
    return candidates.length ? Math.min(...candidates) : now;
  }

  if (!isMissingNoticeReadsTableError(upsertRes.error)) {
    data(upsertRes);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const current = data(
      await db
        .from('ltch_notices')
        .select('id,body')
        .eq('id', notice.id)
        .eq('status', 'published')
        .maybeSingle()
    );
    demand(current, 404, 'Không tìm thấy thông báo.');
    const {cleanBody, reads} = decodeLegacyNoticeReads(current.body);
    if (Number.isSafeInteger(reads[actorUid]) && reads[actorUid] > 0) {
      return reads[actorUid];
    }
    let nextBody;
    try {
      nextBody = encodeLegacyNoticeReads(cleanBody, {...reads, [actorUid]: now});
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ApiError(503, 'Không thể lưu xác nhận đã xem lúc này. Vui lòng báo quản trị viên cập nhật cơ sở dữ liệu.');
      }
      throw error;
    }
    const updated = data(
      await db
        .from('ltch_notices')
        .update({body: nextBody})
        .eq('id', notice.id)
        .eq('status', 'published')
        .eq('body', current.body)
        .select('id')
    );
    if (Array.isArray(updated) && updated.length === 1) {
      return now;
    }
  }
  throw new ApiError(409, 'Trạng thái thông báo vừa thay đổi. Vui lòng thử lại.');
}

async function inspectNoticeReads(db, actor, notice, requestedClassId = null) {
  let scopeClassId = null;
  if (notice.scope === 'class') {
    if (requestedClassId) {
      demand(requestedClassId === notice.class_id, 400, 'Thông báo không thuộc lớp này.');
    }
    scopeClassId = notice.class_id;
    demand(staffCan(actor, scopeClassId), 403, 'Chỉ ban điều hành lớp mới xem được danh sách đã xem.');
  } else if (requestedClassId) {
    demand(staffCan(actor, requestedClassId), 403, 'Chỉ ban điều hành lớp mới xem được danh sách đã xem.');
    scopeClassId = requestedClassId;
  } else {
    demand(canPostGlobal(actor), 403, 'Chỉ ban điều hành mới xem được danh sách đã xem.');
  }

  const {reads: legacyReads} = decodeLegacyNoticeReads(notice.body);
  const {rows: readRows} = await loadNoticeReadRows(db, [notice.id]);
  const readsMap = mergeNoticeReads(readRows, legacyReads);

  if (scopeClassId) {
    const [membersRes, adminsRes] = await Promise.all([
      db.from('ltch_class_memberships').select('uid,member_role').eq('class_id', scopeClassId).eq('status', 'active'),
      db.from('ltch_accounts').select('uid').contains('roles', ['admin']).eq('status', 'active')
    ]);
    const classMembers = data(membersRes) || [];
    const adminAccounts = data(adminsRes) || [];

    const studentSet = new Set(
      classMembers.filter(m => m?.member_role === 'student' && m?.uid).map(m => m.uid)
    );
    const staffRoleByUid = new Map();
    for (const m of classMembers) {
      if (!m?.uid) continue;
      if (m.member_role === 'assistant' && !staffRoleByUid.has(m.uid)) {
        staffRoleByUid.set(m.uid, 'assistant');
      } else if (m.member_role === 'teacher') {
        staffRoleByUid.set(m.uid, 'teacher');
      }
    }
    for (const acc of adminAccounts) {
      if (acc?.uid) staffRoleByUid.set(acc.uid, 'admin');
    }

    const studentUids = [...studentSet];
    const parentLinks = studentUids.length
      ? data(
          await db
            .from('ltch_parent_links')
            .select('parent_uid,student_uid')
            .in('student_uid', studentUids)
            .eq('status', 'active')
        ) || []
      : [];

    const parentChildrenMap = new Map();
    const parentSet = new Set();
    for (const link of parentLinks) {
      const parentUid = link?.parent_uid;
      const studentUid = link?.student_uid;
      if (!parentUid || studentSet.has(parentUid)) continue;
      parentSet.add(parentUid);
      if (!parentChildrenMap.has(parentUid)) parentChildrenMap.set(parentUid, []);
      if (studentUid && !parentChildrenMap.get(parentUid).includes(studentUid)) {
        parentChildrenMap.get(parentUid).push(studentUid);
      }
    }

    const accountUids = [
      ...new Set([
        ...studentUids,
        ...parentSet,
        ...[...readsMap.keys()].filter(uid => studentSet.has(uid) || parentSet.has(uid) || staffRoleByUid.has(uid))
      ])
    ];
    const accounts = accountUids.length
      ? data(
          await db
            .from('ltch_accounts')
            .select('uid,display_name,roles,student_code,status')
            .in('uid', accountUids)
        ) || []
      : [];
    const accountByUid = new Map(accounts.map(acc => [acc.uid, acc]));

    const seen = [];
    for (const [uid, seenAt] of readsMap.entries()) {
      const acc = accountByUid.get(uid);
      const name = acc?.display_name || uid;
      if (studentSet.has(uid)) {
        seen.push({
          uid,
          name,
          studentCode: acc?.student_code || null,
          role: 'student',
          roleLabel: READ_ROLE_LABELS.student,
          seenAt
        });
      } else if (parentSet.has(uid)) {
        const childNames = (parentChildrenMap.get(uid) || []).map(
          sid => accountByUid.get(sid)?.display_name || sid
        );
        seen.push({
          uid,
          name,
          role: 'parent',
          roleLabel: READ_ROLE_LABELS.parent,
          childNames,
          seenAt
        });
      } else if (staffRoleByUid.has(uid)) {
        const staffRole = staffRoleByUid.get(uid);
        seen.push({
          uid,
          name,
          role: staffRole,
          roleLabel: READ_ROLE_LABELS[staffRole] || 'Ban điều hành',
          seenAt
        });
      }
    }
    seen.sort((a, b) => b.seenAt - a.seenAt || compareViNames(a.name, b.name));

    const unseenStudents = studentUids
      .filter(uid => !readsMap.has(uid))
      .map(uid => {
        const acc = accountByUid.get(uid);
        return {
          uid,
          name: acc?.display_name || uid,
          studentCode: acc?.student_code || null,
          role: 'student',
          roleLabel: READ_ROLE_LABELS.student
        };
      })
      .sort((a, b) => compareViNames(a.name, b.name));

    const summary = summarizeNoticeReads({
      readsMap,
      studentUids,
      parentLinks,
      allowedOtherUids: [...staffRoleByUid.keys()]
    });

    return {noticeId: notice.id, scope: notice.scope, classId: scopeClassId, summary, seen, unseenStudents};
  }

  const readerUids = [...readsMap.keys()];
  const accounts = readerUids.length
    ? data(
        await db
          .from('ltch_accounts')
          .select('uid,display_name,roles,student_code,status')
          .in('uid', readerUids)
      ) || []
    : [];
  const accountByUid = new Map(accounts.map(acc => [acc.uid, acc]));

  const seen = readerUids
    .map(uid => {
      const acc = accountByUid.get(uid);
      const roles = Array.isArray(acc?.roles) ? acc.roles : [];
      const primaryRole = READ_ROLE_PRIORITY.find(r => roles.includes(r)) || 'student';
      return {
        uid,
        name: acc?.display_name || uid,
        ...(primaryRole === 'student' ? {studentCode: acc?.student_code || null} : {}),
        role: primaryRole,
        roleLabel: READ_ROLE_LABELS[primaryRole] || 'Thành viên',
        seenAt: readsMap.get(uid)
      };
    })
    .sort((a, b) => b.seenAt - a.seenAt || compareViNames(a.name, b.name));

  return {
    noticeId: notice.id,
    scope: notice.scope,
    classId: null,
    summary: summarizeNoticeReads({readsMap}),
    seen,
    unseenStudents: []
  };
}

function canPostGlobal(actor) {
  return isAdmin(actor) || (actor?.status === 'active' && (actor.memberships || []).some(member =>
    (actor.roles || []).includes(member.member_role) && (member.member_role === 'teacher' ||
      (member.member_role === 'assistant' && member.permissions?.includes('notices.write')))));
}

function canWriteNotice(actor, notice) {
  return notice.scope === 'all' ? canPostGlobal(actor) : staffCan(actor, notice.class_id, 'notices.write');
}

function canReadNotice(actor, notice) {
  if (notice.status !== 'published') return notice.created_by === actor.uid && canWriteNotice(actor, notice);
  return notice.scope === 'all' ? actor.status === 'active' : classCanRead(actor, notice.class_id);
}

async function getNotice(db, noticeId) {
  const notice = data(await db.from('ltch_notices').select('*').eq('id', id(noticeId)).maybeSingle());
  demand(notice, 404, 'Không tìm thấy thông báo.');
  return notice;
}

async function getFile(db, noticeId, fileId) {
  const file = data(await db.from('ltch_notice_files').select('*').eq('notice_id', id(noticeId)).eq('id', id(fileId)).maybeSingle());
  demand(file, 404, 'Không tìm thấy tệp đính kèm.');
  return file;
}

async function noticeFolder(db, drive, notice) {
  const ensure = (key, parent, name) => ensureDriveFolder({db, drive, key, parentId: parent, name});
  const root = await ensure('ltch-root', await drive.rootId(), 'Lớp Toán cô Hạnh');
  if (notice.scope === 'all') return ensure('notice:all', root, 'Thông báo chung');
  const klass = data(await db.from('ltch_classes').select('id,name,school_year_id,archived').eq('id', notice.class_id).maybeSingle());
  demand(klass && !klass.archived, 404, 'Không tìm thấy lớp đang hoạt động.');
  const year = data(await db.from('ltch_school_years').select('id,name').eq('id', klass.school_year_id).maybeSingle());
  demand(year, 503, 'Không tìm thấy năm học.');
  const yearFolder = await ensure(`year:${id(year.id)}`, root, folderName(year.name, year.id));
  const classFolder = await ensure(`class:${id(klass.id)}`, yearFolder, folderName(klass.name, klass.id));
  return ensure(`notice:class:${id(klass.id)}`, classFolder, 'Thông báo');
}

function uploadIdentity(notice, file, actor) {
  return {classId: notice.class_id || 'all', lessonId: notice.id, fileId: file.id, actorId: actor.uid, purpose: uploadPurpose};
}

async function finishStoredFile(db, drive, notice, file, actor) {
  const metadata = await drive.metadata({id: file.drive_file_id});
  await requireAllowedSharing(drive, metadata, file, {parentId: file.parent_folder_id});
  const done = data(await db.rpc('ltch_finish_notice_file', {p_file_id: file.id, p_notice_id: notice.id, p_actor_uid: actor.uid}));
  demand(done === true, 503, 'Chưa xác nhận được tệp đính kèm.');
}

async function startUpload(request, {db, actor, env, notice, openDrive}) {
  const body = await readJson(request, 8192);
  const requestId = id(body.requestId);
  demand(requestId.length >= 16, 400, 'Mã tải tệp không hợp lệ.');
  const name = string(body.name, 250);
  demand(!/[\u0000-\u001f\u007f/\\]/.test(name), 400, 'Tên tệp không hợp lệ.');
  const contentType = String(body.contentType || '').toLowerCase();
  demand(mediaTypes.has(contentType), 400, 'Định dạng ảnh hoặc video chưa được hỗ trợ.');
  const size = Number(body.size);
  const limit = contentType.startsWith('video/') ? noticeMaxVideoBytes : noticeMaxImageBytes;
  demand(Number.isSafeInteger(size) && size > 0 && size <= limit, 400, 'Kích thước tệp vượt giới hạn cho phép.');
  const fingerprint = String(body.sha256 || '').toLowerCase();
  demand(/^[a-f0-9]{64}$/.test(fingerprint), 400, 'Mã kiểm tra tệp không hợp lệ.');
  try {
    const drive = await openDrive(env);
    const parent = await noticeFolder(db, drive, notice);
    const reserved = data(await db.rpc('ltch_reserve_notice_file', {
      p_id: randomUUID(), p_notice_id: notice.id, p_request_id: requestId,
      p_drive_id: await drive.reserveId(), p_parent_id: parent, p_name: name,
      p_content_type: contentType, p_file_size: size, p_sha256: fingerprint,
      p_actor_uid: actor.uid, p_now: Date.now()
    }));
    const file = Array.isArray(reserved) ? reserved[0] : reserved;
    demand(file && file.parent_folder_id === parent, 409, 'Không thể tiếp tục phiên tải tệp.');
    if (file.status === 'stored') return json({id: file.id, state: 'uploaded', totalSize: size}, 200);
    try {
      await finishStoredFile(db, drive, notice, file, actor);
      return json({id: file.id, state: 'uploaded', totalSize: size}, 200);
    } catch (error) {
      if (error?.code !== 'not_found') throw error;
    }
    const sessionUrl = await drive.startResumableUpload({
      id: file.drive_file_id, parentId: parent, name, contentType, total: size,
      sha256: fingerprint, origin: env.ALLOWED_ORIGIN
    });
    const payload = {sessionUrl, driveFileId: file.drive_file_id, parentId: parent, total: size, contentType, expiresAt: Number(notice.created_at) + 24 * 60 * 60 * 1000};
    const uploadToken = await sealDriveUploadToken(env, {...uploadIdentity(notice, file, actor), payload});
    return json({id: file.id, uploadToken, chunkSize: 8 * 1024 * 1024, totalSize: size}, 201);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.warn('LTCH_NOTICE_UPLOAD_START_FAILED', {code: /^[a-z_]{1,40}$/.test(error?.code || '') ? error.code : 'unexpected'});
    throw new ApiError(503, 'Không thể khởi tạo tải tệp lên Drive. Vui lòng thử lại.');
  }
}

async function uploadChunk(request, {db, actor, env, notice, file, openDrive}) {
  const params = new URL(request.url).searchParams;
  const token = params.get('uploadToken');
  const payload = await openDriveUploadToken(env, {token, ...uploadIdentity(notice, file, actor)});
  demand(payload.expiresAt > Date.now() && payload.driveFileId === file.drive_file_id &&
    payload.parentId === file.parent_folder_id && payload.total === Number(file.file_size) &&
    payload.contentType === file.content_type, 400, 'Phiên tải tệp không còn hợp lệ.');
  if (file.status === 'stored') return json({state: 'uploaded', id: file.id, offset: Number(file.file_size)});
  const isStatus = params.get('status') === '1';
  const offset = Number(params.get('offset'));
  const bytes = isStatus ? null : await readBytes(request, 8_600_000);
  if (!isStatus) demand(Number.isSafeInteger(offset) && offset >= 0 && offset < payload.total && bytes?.byteLength > 0, 400, 'Đoạn dữ liệu không hợp lệ.');
  try {
    const drive = await openDrive(env);
    const result = await drive.uploadResumableChunk({
      sessionUrl: payload.sessionUrl, total: payload.total, id: file.drive_file_id,
      offset: isStatus ? 0 : offset, bytes, contentType: file.content_type
    });
    if (result.state !== 'uploaded') return json(result);
    await finishStoredFile(db, drive, notice, file, actor);
    return json({state: 'uploaded', id: file.id, offset: payload.total});
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể tải đoạn tệp lên Drive. Vui lòng thử lại.');
  }
}

function ticketSignature(env, payload) {
  demand(typeof env?.MAIL_SECRET === 'string' && env.MAIL_SECRET.length >= 32, 503, 'Dịch vụ tệp chưa sẵn sàng.');
  return createHmac('sha256', env.MAIL_SECRET).update('ltch:notice-media:v1|').update(payload).digest('base64url');
}

export function createNoticeMediaTicket(env, {uid, noticeId, fileId}, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({uid: id(uid), noticeId: id(noticeId), fileId: id(fileId), expiresAt: now + ticketLifetime})).toString('base64url');
  return `${payload}.${ticketSignature(env, payload)}`;
}

export function verifyNoticeMediaTicket(env, ticket, now = Date.now()) {
  demand(typeof ticket === 'string' && ticket.length <= 2000, 403, 'Liên kết tệp không hợp lệ.');
  const parts = ticket.split('.');
  demand(parts.length === 2 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)), 403, 'Liên kết tệp không hợp lệ.');
  const expected = Buffer.from(ticketSignature(env, parts[0]));
  const actual = Buffer.from(parts[1]);
  demand(actual.length === expected.length && timingSafeEqual(actual, expected), 403, 'Liên kết tệp không hợp lệ.');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new ApiError(403, 'Liên kết tệp không hợp lệ.'); }
  demand(payload && Number.isSafeInteger(payload.expiresAt) && payload.expiresAt > now && payload.expiresAt <= now + ticketLifetime, 403, 'Liên kết tệp đã hết hạn.');
  id(payload.uid); id(payload.noticeId); id(payload.fileId);
  return payload;
}

export async function noticeMedia(request, {db, env, openDrive = configuredDrive}) {
  demand(request.method === 'GET' || request.method === 'HEAD', 405);
  const ticket = verifyNoticeMediaTicket(env, new URL(request.url).searchParams.get('ticket'));
  const actor = await createSupabaseRepository(db).actor(ticket.uid);
  demand(actor, 403, 'Tài khoản không còn quyền xem tệp.');
  const notice = await getNotice(db, ticket.noticeId);
  demand(canReadNotice(actor, notice), 403, 'Bạn không có quyền xem tệp.');
  const file = await getFile(db, notice.id, ticket.fileId);
  demand(file.status === 'stored' && mediaTypes.has(file.content_type), 404, 'Tệp chưa sẵn sàng.');
  const requestedRange = request.headers.get('range') || undefined;
  let range;
  let requestedStart;
  if (requestedRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requestedRange);
    const suffix = match && !match[1] && match[2] ? Number(match[2]) : null;
    requestedStart = suffix !== null ? Math.max(0, Number(file.file_size) - suffix) : match?.[1] ? Number(match[1]) : NaN;
    const requestedEnd = suffix === null && match?.[2] ? Number(match[2]) : null;
    demand(Number.isSafeInteger(requestedStart) && requestedStart < Number(file.file_size) &&
      (suffix === null || (Number.isSafeInteger(suffix) && suffix > 0)) &&
      (requestedEnd === null || (Number.isSafeInteger(requestedEnd) && requestedEnd >= requestedStart)), 416, 'Phạm vi tệp không hợp lệ.');
    range = `bytes=${requestedStart}-${requestedEnd === null ? '' : requestedEnd}`;
  }
  try {
    const drive = await openDrive(env);
    const metadata = await drive.metadata({id: file.drive_file_id});
    await requireAllowedSharing(drive, metadata, file, {parentId: file.parent_folder_id});
    const headers = new Headers({'content-type': file.content_type, 'content-disposition': 'inline', 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox", 'accept-ranges': 'bytes'});
    if (request.method === 'HEAD') {
      headers.set('content-length', String(file.file_size));
      return new Response(null, {status: 200, headers});
    }
    const upstream = await drive.download({id: file.drive_file_id, range});
    if (range) {
      const returnedRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get('content-range') || '');
      demand(upstream.status === 206 && returnedRange && Number(returnedRange[1]) === requestedStart &&
        Number(returnedRange[2]) >= requestedStart && Number(returnedRange[2]) < Number(file.file_size) &&
        Number(returnedRange[3]) === Number(file.file_size), 503, 'Không thể xem đoạn video.');
    }
    for (const key of ['content-length', 'content-range']) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(upstream.body, {status: upstream.status, headers});
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể mở tệp từ Drive.');
  }
}

export async function cleanupExpiredNoticeDraft({db, env, openDrive = configuredDrive}, now = Date.now()) {
  const noticeId = data(await db.rpc('ltch_claim_expired_notice_draft', {p_now: now}));
  if (!noticeId) return false;
  const files = data(await db.from('ltch_notice_files').select('*').eq('notice_id', noticeId));
  if (files.length) {
    const drive = await openDrive(env);
    for (const file of files) {
      let metadata;
      try { metadata = await drive.metadata({id: file.drive_file_id}); }
      catch (error) { if (error?.code !== 'not_found') throw error; }
      if (metadata) {
        demand(matchesDriveFile({...metadata, trashed: false}, file, file.parent_folder_id), 503, 'Tệp bản nháp không khớp dữ liệu.');
        if (!metadata.trashed) {
          await requireAllowedSharing(drive, metadata, file, {parentId: file.parent_folder_id});
          await drive.trash({id: file.drive_file_id});
        }
      }
      data(await db.from('ltch_notice_files').delete().eq('id', file.id).eq('notice_id', noticeId));
    }
  }
  return data(await db.rpc('ltch_finish_notice_draft_cleanup', {p_notice_id: noticeId}));
}

export async function notices(request, path, {db, actor, env, openDrive = configuredDrive}) {
  if (path === '/api/notices/drafts') {
    demand(request.method === 'POST', 405);
    const body = await readJson(request);
    const noticeId = id(body.id);
    demand(noticeId.length >= 16, 400, 'Mã thông báo không hợp lệ.');
    demand(['all', 'class'].includes(body.scope), 400, 'Phạm vi thông báo không hợp lệ.');
    const classId = body.scope === 'class' ? id(body.classId) : null;
    const cleanBody = stripLegacyNoticeReads(string(body.body, 20000)).trim();
    demand(cleanBody.length > 0, 400, 'Nội dung không hợp lệ.');
    const record = {id: noticeId, scope: body.scope, class_id: classId, title: string(body.title, 250), body: cleanBody,
      expected_files: body.expectedFiles, created_by: actor.uid, created_at: Date.now(), status: 'draft'};
    demand(Number.isInteger(record.expected_files) && record.expected_files >= 0 && record.expected_files <= 8, 400, 'Chọn tối đa 8 tệp đính kèm.');
    demand(canWriteNotice(actor, record), 403, 'Bạn không có quyền đăng thông báo trong phạm vi này.');
    data(await db.from('ltch_notices').upsert(record, {onConflict: 'id', ignoreDuplicates: true}));
    const saved = await getNotice(db, noticeId);
    demand(saved.created_by === actor.uid && saved.scope === record.scope && saved.class_id === record.class_id &&
      saved.title === record.title && saved.body === record.body && saved.expected_files === record.expected_files,
      409, 'Mã thông báo đã được dùng cho nội dung khác.');
    demand(saved.status !== 'discarding' && (saved.status === 'published' || Date.now() - saved.created_at < 24 * 60 * 60 * 1000), 409, 'Bản nháp đã hết hạn. Vui lòng mở lại biểu mẫu và đăng lại.');
    return json({id: saved.id, status: saved.status}, saved.status === 'published' ? 200 : 201);
  }
  const match = /^\/api\/notices\/([A-Za-z0-9_-]{1,128})\/(publish|edit|read|reads|files)(?:\/([A-Za-z0-9_-]{1,128})(?:\/(chunks|ticket))?)?$/.exec(path);
  if (!match) return null;
  const notice = await getNotice(db, match[1]);
  if (match[2] === 'edit') {
    demand(request.method === 'POST' && !match[3], 405);
    demand(notice.status === 'published' && canWriteNotice(actor, notice), 403);
    const body = await readJson(request);
    const {reads: legacyReads} = decodeLegacyNoticeReads(notice.body);
    const cleanBody = stripLegacyNoticeReads(string(body.body, 20000)).trim();
    demand(cleanBody.length > 0, 400, 'Nội dung không hợp lệ.');
    let finalBody = cleanBody;
    if (Object.keys(legacyReads).length) {
      try {
        finalBody = encodeLegacyNoticeReads(cleanBody, legacyReads);
      } catch (error) {
        if (error instanceof RangeError) {
          throw new ApiError(413, 'Nội dung thông báo quá dài.');
        }
        throw error;
      }
    }
    const change = {title: string(body.title, 250), body: finalBody};
    data(await db.from('ltch_notices').update(change).eq('id', notice.id).eq('status', 'published'));
    return json({ok: true});
  }
  if (match[2] === 'read') {
    demand(request.method === 'POST' && !match[3], 405);
    demand(notice.status === 'published', 404, 'Không tìm thấy thông báo.');
    demand(canReadNotice(actor, notice), 403, 'Bạn không có quyền xem thông báo này.');
    if (notice.scope === 'class') {
      const klass = data(await db.from('ltch_classes').select('id,archived').eq('id', notice.class_id).maybeSingle());
      demand(klass && !klass.archived, 400, 'Không thể xác nhận thông báo của lớp đã lưu trữ.');
    }
    const seenAt = await recordNoticeRead(db, notice, actor.uid, Date.now());
    return json({ok: true, noticeId: notice.id, seen: true, seenAt});
  }
  if (match[2] === 'reads') {
    demand(request.method === 'GET' && !match[3], 405);
    demand(notice.status === 'published', 404, 'Không tìm thấy thông báo.');
    const rawClassId = new URL(request.url).searchParams.get('classId');
    const requestedClassId = rawClassId ? id(rawClassId) : null;
    return json(await inspectNoticeReads(db, actor, notice, requestedClassId));
  }
  if (match[2] === 'publish') {
    demand(request.method === 'POST' && !match[3], 405);
    demand(notice.created_by === actor.uid && canWriteNotice(actor, notice), 403);
    const count = data(await db.rpc('ltch_publish_notice', {p_notice_id: notice.id, p_actor_uid: actor.uid, p_now: Date.now()}));
    if (Number(count) > 0 && env?.MAIL_ENDPOINT && typeof env?.MAIL_SECRET === 'string' && env.MAIL_SECRET.length >= 32) {
      try {
        const jobs = await db.from('ltch_mail_outbox')?.select?.('id')?.eq?.('notice_id', notice.id)?.eq?.('status', 'pending')?.limit?.(6);
        if (Array.isArray(jobs?.data) && jobs.data.length > 0) {
          await Promise.allSettled(jobs.data.map(j => deliverNotification(db, env, j.id)));
        }
      } catch {
        // Pending mail jobs remain safely in ltch_mail_outbox for the reminder tick.
      }
    }
    return json({ok: true, id: notice.id, notificationStatus: Number(count) ? 'queued' : 'no_recipients', notifiedCount: Number(count) || 0});
  }
  if (!match[3]) {
    demand(request.method === 'POST', 405);
    demand(notice.status === 'draft' && notice.created_by === actor.uid && canWriteNotice(actor, notice), 403);
    return startUpload(request, {db, actor, env, notice, openDrive});
  }
  const file = await getFile(db, notice.id, match[3]);
  if (match[4] === 'chunks') {
    demand(request.method === 'POST', 405);
    demand(notice.status === 'draft' && notice.created_by === actor.uid && canWriteNotice(actor, notice), 403);
    return uploadChunk(request, {db, actor, env, notice, file, openDrive});
  }
  if (match[4] === 'ticket') {
    demand(request.method === 'GET', 405);
    demand(canReadNotice(actor, notice) && file.status === 'stored', 403);
    const ticket = createNoticeMediaTicket(env, {uid: actor.uid, noticeId: notice.id, fileId: file.id});
    return json({url: `${resolveApiOrigin(env, request.url)}/api/notice-media?ticket=${ticket}`});
  }
  throw new ApiError(404, 'Không tìm thấy chức năng.');
}
