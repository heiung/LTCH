import { randomUUID } from 'node:crypto';
import { ApiError, demand, id, string, data, isAdmin } from './policy.mjs';
import { json, readBytes, readFormData, readJson } from './http.mjs';
import { DriveError } from './google-drive.mjs';
import { GoogleAuthorizationError } from './google-oauth.mjs';
import { matchesDriveFile, requireAllowedSharing, enableLinkSharing, drivePreviewUrl } from './drive-preview.mjs';
import { configuredDrive, sealDriveUploadToken, openDriveUploadToken } from './lesson-storage.mjs';
import { sealVideoStreamTicket, buildVideoStreamUrl } from './video-stream.mjs';
import { lessonsAvailable } from './lessons.mjs';
import { resolveSiteOrigin } from './config.mjs';
import {
  ensurePracticeExamFolders,
  relocateLegacySourceFilesToSubfolder
} from './practice-drive.mjs';
import {
  EXAM_TYPES,
  canManagePracticePool,
  computePracticeAccess,
  isStudentAllowedExam,
  loadSharedExamIdsForYear,
  normalizeExamRow,
  saveExamRowToDb
} from './practice-rooms.mjs';
import { parseIsoDateParts } from '../shared/classroom.mjs';

const UPLOAD_PURPOSE = 'ltch-exam-psol-v1';
const MAX_DOCUMENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 10_000_000;
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

function safeName(value) {
  const name = string(value, 250);
  demand(!/[\u0000-\u001f\u007f/\\]/.test(name), 400, 'Tên tệp không hợp lệ.');
  return name;
}

function normalizeContentType(value) {
  return typeof value === 'string' &&
    /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value) &&
    value.length <= 127 &&
    !value.toLowerCase().startsWith('application/vnd.google-apps.')
    ? value
    : 'application/octet-stream';
}

function computeSha256(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then((d) =>
    [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
  );
}

function resolveFileKind({ rawKind, name, contentType, defaultKind = 'document' }) {
  const cleanedKind = String(rawKind || '').trim().toLowerCase();
  if (cleanedKind === 'exam_file' || cleanedKind === 'video' || cleanedKind === 'document' || cleanedKind === 'cover') {
    return cleanedKind;
  }
  if (/^__ltch_cover__/i.test(String(name || ''))) return 'cover';
  if (/^video\//i.test(String(contentType || ''))) return 'video';
  return defaultKind;
}

function pickStreamFolderId(folders, fileKind) {
  if (fileKind === 'video') return folders.videoFolderId;
  if (fileKind === 'exam_file') return folders.sourceFolderId;
  if (fileKind === 'cover') return folders.mediaFolderId;
  return folders.docFolderId;
}

function formatDateVi(isoDate) {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return '';
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

export async function ensureExamStreamFolders({
  db,
  drive,
  env,
  exam,
  relocateSources = true,
  useCache = true,
  activeClasses = []
}) {
  const folders = await ensurePracticeExamFolders({
    db,
    drive,
    env,
    examId: exam.id,
    examType: exam.exam_type,
    title: exam.title,
    useCache
  });
  const prevSources = Array.isArray(exam._examMeta?.sourceFiles) ? exam._examMeta.sourceFiles : [];
  const mergedSources = relocateSources
    ? await relocateLegacySourceFilesToSubfolder({
        drive,
        sourceFiles: prevSources,
        examFolderId: folders.examFolderId,
        sourceFolderId: folders.sourceFolderId
      })
    : prevSources;
  const needsMetaSync =
    exam._examMeta?.storage === 'drive' &&
    (!exam._examMeta?.driveSourceFolderId ||
      exam._examMeta?.driveVideoFolderId !== folders.videoFolderId ||
      exam._examMeta?.driveDocFolderId !== folders.docFolderId ||
      mergedSources.length > prevSources.length);
  if (needsMetaSync) {
    const nextMeta = {
      ...exam._examMeta,
      storage: 'drive',
      driveFolderId: folders.examFolderId,
      driveSourceFolderId: folders.sourceFolderId,
      driveVideoFolderId: folders.videoFolderId,
      driveDocFolderId: folders.docFolderId,
      driveMediaFolderId: folders.mediaFolderId,
      sourceFiles: mergedSources
    };
    exam._examMeta = nextMeta;
    try {
      await saveExamRowToDb(
        db,
        { ...exam, driveMeta: nextMeta, _expectedUpdatedAt: exam.updated_at },
        activeClasses
      );
    } catch {}
  }
  return folders;
}

async function startResumableSolutionFile(request, { db, actor, env, exam, openDrive }) {
  const body = await readJson(request, 8192);
  const requestId = id(body.requestId);
  demand(requestId.length >= 16, 400, 'Mã tải tệp không hợp lệ.');

  const name = safeName(body.name);
  const fileKind = resolveFileKind({
    rawKind: body.fileKind,
    name,
    contentType: body.contentType,
    defaultKind: body.isVideoLecture ? 'video' : 'document'
  });

  const type = normalizeContentType(
    body.contentType || (fileKind === 'video' ? 'video/mp4' : 'application/octet-stream')
  );
  if (fileKind === 'video') {
    demand(/^video\/[a-z0-9!#$&^_.+-]+$/i.test(type), 400, 'Chọn tệp video hợp lệ (tối đa 5 GB).');
  }
  const maxAllowedBytes =
    fileKind === 'video'
      ? MAX_VIDEO_UPLOAD_BYTES
      : fileKind === 'cover'
        ? MAX_MULTIPART_BYTES
        : MAX_DOCUMENT_UPLOAD_BYTES;

  const total = Number(body.size);
  demand(
    Number.isSafeInteger(total) && total >= 1 && total <= maxAllowedBytes,
    400,
    fileKind === 'video'
      ? 'Chọn tệp video hợp lệ (tối đa 5 GB).'
      : 'Chọn tệp tài liệu hợp lệ (tối đa 100 MB).'
  );

  const sha256 = String(body.sha256 || '').trim().toLowerCase();
  demand(/^[a-f0-9]{64}$/.test(sha256), 400, 'Mã kiểm tra tệp không hợp lệ.');

  let stage = 'authorization';
  try {
    const drive = await openDrive(env);
    stage = 'folders';
    const folders = await ensureExamStreamFolders({
      db,
      drive,
      env,
      exam,
      relocateSources: true,
      useCache: openDrive === configuredDrive
    });
    const parentId = pickStreamFolderId(folders, fileKind);

    stage = 'record';
    const readRecord = async () =>
      data(
        await db
          .from('ltch_practice_solution_files')
          .select('*')
          .eq('exam_id', exam.id)
          .eq('created_by', actor.uid)
          .eq('request_id', requestId)
          .maybeSingle()
      );

    let record = await readRecord();
    if (!record) {
      const driveId = await drive.reserveId();
      data(
        await db.from('ltch_practice_solution_files').upsert(
          {
            id: randomUUID(),
            exam_id: exam.id,
            file_kind: fileKind,
            name,
            drive_file_id: driveId,
            parent_folder_id: parentId,
            content_type: type,
            file_size: total,
            sha256,
            request_id: requestId,
            status: 'pending',
            created_by: actor.uid,
            created_at: Date.now()
          },
          { onConflict: 'exam_id,created_by,request_id', ignoreDuplicates: true }
        )
      );
      record = await readRecord();
    } else if (
      record.status !== 'stored' &&
      record.exam_id === exam.id &&
      record.name === name &&
      record.file_kind === fileKind
    ) {
      const freshDriveId = await drive.reserveId();
      data(
        await db
          .from('ltch_practice_solution_files')
          .update({
            drive_file_id: freshDriveId,
            parent_folder_id: parentId,
            content_type: type,
            file_size: total,
            sha256,
            status: 'pending'
          })
          .eq('id', record.id)
          .eq('exam_id', exam.id)
      );
      record = {
        ...record,
        drive_file_id: freshDriveId,
        parent_folder_id: parentId,
        content_type: type,
        file_size: total,
        sha256,
        status: 'pending'
      };
    }

    demand(
      record &&
        record.exam_id === exam.id &&
        record.name === name &&
        record.file_kind === fileKind &&
        record.content_type === type &&
        Number(record.file_size) === total &&
        record.sha256 === sha256,
      409,
      'Mã tải tệp đã được dùng cho nội dung khác.'
    );

    if (record.status === 'stored') {
      return json({ id: record.id, fileKind, state: 'uploaded', totalSize: total, chunkSize: CHUNK_SIZE_BYTES }, 200);
    }

    stage = 'session';
    const reqOrigin = request.headers.get('origin') || resolveSiteOrigin(env);
    const sessionUrl = await drive.startResumableUpload({
      id: record.drive_file_id,
      parentId,
      name,
      contentType: type,
      total,
      sha256,
      origin: reqOrigin
    });
    const uploadToken = await sealDriveUploadToken(env, {
      classId: exam.exam_type,
      lessonId: exam.id,
      fileId: record.id,
      actorId: actor.uid,
      purpose: UPLOAD_PURPOSE,
      payload: {
        sessionUrl,
        driveFileId: record.drive_file_id,
        parentId,
        total,
        contentType: type,
        sha256,
        fileKind
      }
    });

    return json(
      {
        id: record.id,
        fileKind,
        uploadToken,
        sessionUrl,
        chunkSize: CHUNK_SIZE_BYTES,
        totalSize: total
      },
      201
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = error instanceof GoogleAuthorizationError || error instanceof DriveError ? error.code : 'unexpected';
    const safeCode = /^[a-z_]{1,50}$/.test(code) ? code : 'unexpected';
    console.error('LTCH_EXAM_PSOL_RESUMABLE_START_FAILED', { stage, code: safeCode });
    throw new ApiError(503, 'Không thể khởi tạo phiên tải tệp lên Google Drive. Vui lòng thử lại.');
  }
}

async function uploadMultipartSolutionFile(request, { db, actor, env, exam, openDrive }) {
  const form = await readFormData(request, 10_050_000);
  const file = form.get('file');
  const requestId = id(form.get('requestId'));
  demand(requestId.length >= 16, 400, 'Mã tải tệp không hợp lệ.');
  demand(
    file && typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= MAX_MULTIPART_BYTES,
    400,
    'Chọn tệp tối đa 10 MB.'
  );

  const name = safeName(file.name);
  const type = normalizeContentType(file.type);
  const fileKind = resolveFileKind({
    rawKind: form.get('fileKind'),
    name,
    contentType: type,
    defaultKind: 'document'
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await computeSha256(bytes);

  let stage = 'authorization';
  try {
    const drive = await openDrive(env);
    stage = 'folders';
    const folders = await ensureExamStreamFolders({
      db,
      drive,
      env,
      exam,
      relocateSources: true,
      useCache: openDrive === configuredDrive
    });
    const parentId = pickStreamFolderId(folders, fileKind);

    stage = 'record';
    const readRecord = async () =>
      data(
        await db
          .from('ltch_practice_solution_files')
          .select('*')
          .eq('exam_id', exam.id)
          .eq('created_by', actor.uid)
          .eq('request_id', requestId)
          .maybeSingle()
      );

    let record = await readRecord();
    if (!record) {
      const driveId = await drive.reserveId();
      data(
        await db.from('ltch_practice_solution_files').upsert(
          {
            id: randomUUID(),
            exam_id: exam.id,
            file_kind: fileKind,
            name,
            drive_file_id: driveId,
            parent_folder_id: parentId,
            content_type: type,
            file_size: bytes.byteLength,
            sha256,
            request_id: requestId,
            status: 'pending',
            created_by: actor.uid,
            created_at: Date.now()
          },
          { onConflict: 'exam_id,created_by,request_id', ignoreDuplicates: true }
        )
      );
      record = await readRecord();
    }

    demand(
      record &&
        record.exam_id === exam.id &&
        record.name === name &&
        record.file_kind === fileKind &&
        record.content_type === type &&
        Number(record.file_size) === bytes.byteLength &&
        record.sha256 === sha256,
      409,
      'Mã tải tệp đã được dùng cho nội dung khác.'
    );

    const alreadyStored = record.status === 'stored';
    if (!alreadyStored) {
      stage = 'upload';
      try {
        await drive.upload({
          id: record.drive_file_id,
          parentId: record.parent_folder_id || parentId,
          name,
          contentType: type,
          bytes,
          sha256
        });
      } catch (err) {
        if (err?.code !== 'conflict') throw err;
      }
    }

    stage = 'verify';
    const folderToCheck = record.parent_folder_id || parentId;
    const metadata = await drive.metadata({ id: record.drive_file_id });
    const isVideo = fileKind === 'video' || /^video\//i.test(type);
    if (env.LTCH_DRIVE_LINK_PREVIEW === '1' || isVideo) {
      await enableLinkSharing(drive, metadata, record, { parentId: folderToCheck });
    } else {
      await requireAllowedSharing(drive, metadata, record, { parentId: folderToCheck });
    }

    if (!alreadyStored) {
      data(
        await db
          .from('ltch_practice_solution_files')
          .update({ status: 'stored' })
          .eq('id', record.id)
          .eq('exam_id', exam.id)
      );
    }

    return json({ id: record.id, fileKind }, alreadyStored ? 200 : 201);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = error instanceof GoogleAuthorizationError || error instanceof DriveError ? error.code : 'unexpected';
    const safeCode = /^[a-z_]{1,50}$/.test(code) ? code : 'unexpected';
    console.error('LTCH_EXAM_PSOL_DRIVE_UPLOAD_FAILED', { stage, code: safeCode });
    throw new ApiError(503, 'Không thể lưu tệp vào Drive. Hãy thử lại với cùng mã tải tệp.');
  }
}

async function handleSolutionFileChunk(request, { db, actor, env, exam, fileId, openDrive }) {
  let uploadTokenStr = '';
  let isStatusQuery = false;
  let offset = 0;
  let bytes = null;

  const reqUrl = new URL(request.url);
  const reqType = (request.headers.get('content-type') || '').toLowerCase();

  if (reqUrl.searchParams.has('uploadToken') || reqType.startsWith('application/octet-stream')) {
    uploadTokenStr = String(reqUrl.searchParams.get('uploadToken') || '');
    isStatusQuery = reqUrl.searchParams.get('status') === '1';
    if (!isStatusQuery) {
      offset = Number(reqUrl.searchParams.get('offset'));
      bytes = await readBytes(request, 8_600_000);
      demand(bytes && bytes.byteLength > 0, 400, 'Thiếu dữ liệu tải lên.');
    }
  } else if (reqType.startsWith('application/json')) {
    const body = await readJson(request, 8192);
    uploadTokenStr = String(body.uploadToken || '');
    isStatusQuery = body.status === '1' || body.status === true;
  } else {
    const form = await readFormData(request, 8_600_000);
    uploadTokenStr = String(form.get('uploadToken') || '');
    isStatusQuery = form.get('status') === '1';
    if (!isStatusQuery) {
      offset = Number(form.get('offset'));
      const chunkFile = form.get('chunk');
      demand(chunkFile && typeof chunkFile.arrayBuffer === 'function' && chunkFile.size > 0, 400, 'Thiếu dữ liệu tải lên.');
      bytes = new Uint8Array(await chunkFile.arrayBuffer());
    }
  }

  const payload = await openDriveUploadToken(env, {
    token: uploadTokenStr,
    classId: exam.exam_type,
    lessonId: exam.id,
    fileId: id(fileId),
    actorId: actor.uid,
    purpose: UPLOAD_PURPOSE
  });

  const record = data(
    await db
      .from('ltch_practice_solution_files')
      .select('*')
      .eq('id', id(fileId))
      .eq('exam_id', exam.id)
      .maybeSingle()
  );
  demand(record, 404, 'Không tìm thấy phiên tải tệp.');

  if (record.status === 'stored') {
    return json({ state: 'uploaded', id: record.id, offset: payload.total });
  }

  try {
    const drive = await openDrive(env);
    const parentId = record.parent_folder_id || payload.parentId;
    const isVideo = record.file_kind === 'video' || /^video\//i.test(String(record.content_type || ''));

    const finalizeWithMetadata = async (metadata) => {
      if (env.LTCH_DRIVE_LINK_PREVIEW === '1' || isVideo) {
        await enableLinkSharing(drive, metadata, record, { parentId });
      } else {
        await requireAllowedSharing(drive, metadata, record, { parentId });
      }
      data(
        await db
          .from('ltch_practice_solution_files')
          .update({ status: 'stored' })
          .eq('id', record.id)
          .eq('exam_id', exam.id)
      );
      return json({ state: 'uploaded', id: record.id, offset: payload.total });
    };

    if (isStatusQuery) {
      let existingMeta = null;
      try {
        existingMeta = await drive.metadata({ id: payload.driveFileId });
      } catch (err) {
        if (err?.code !== 'not_found') throw err;
      }
      if (existingMeta && matchesDriveFile(existingMeta, record, parentId)) {
        return finalizeWithMetadata(existingMeta);
      }

      const statusResult = await drive.uploadResumableChunk({
        sessionUrl: payload.sessionUrl,
        total: payload.total,
        id: payload.driveFileId,
        offset: 0,
        bytes: null,
        contentType: payload.contentType
      });
      if (statusResult.state === 'uploading') return json(statusResult);
      const freshMeta = await drive.metadata({ id: record.drive_file_id });
      return finalizeWithMetadata(freshMeta);
    }

    demand(Number.isSafeInteger(offset) && offset >= 0 && offset < payload.total, 400, 'Vị trí đoạn dữ liệu không hợp lệ.');
    const chunkResult = await drive.uploadResumableChunk({
      sessionUrl: payload.sessionUrl,
      total: payload.total,
      id: payload.driveFileId,
      offset,
      bytes,
      contentType: payload.contentType
    });
    bytes = null;
    if (chunkResult.state === 'uploading') return json(chunkResult);

    const metadata = await drive.metadata({ id: record.drive_file_id });
    return finalizeWithMetadata(metadata);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể gửi đoạn dữ liệu lên Google Drive. Vui lòng thử lại.');
  }
}

function attachmentHeaders(filename) {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="document"; filename*=UTF-8''${encoded}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox"
  };
}

async function downloadSolutionFile({ db, env, exam, fileId, openDrive }) {
  const record = data(
    await db
      .from('ltch_practice_solution_files')
      .select('*')
      .eq('id', id(fileId))
      .eq('exam_id', exam.id)
      .maybeSingle()
  );
  demand(record && record.status === 'stored', 404, 'Không tìm thấy tài liệu.');

  try {
    const drive = await openDrive(env);
    const meta = await drive.metadata({ id: record.drive_file_id });
    const isVideo = record.file_kind === 'video' || /^video\//i.test(String(record.content_type || ''));
    await requireAllowedSharing(drive, meta, record, {
      parentId: record.parent_folder_id || undefined,
      allowLink: env.LTCH_DRIVE_LINK_PREVIEW === '1' || isVideo
    });
    const upstream = await drive.download({ id: record.drive_file_id });
    return new Response(upstream.body, { headers: attachmentHeaders(record.name) });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể tải tệp từ Drive.');
  }
}

async function downloadExamSourceFile({ db, env, exam, driveFileId, openDrive }) {
  const sourceFiles = Array.isArray(exam._examMeta?.sourceFiles) ? exam._examMeta.sourceFiles : [];
  const sf = sourceFiles.find((item) => item?.driveFileId === driveFileId);
  demand(sf, 404, 'Không tìm thấy tệp đề gốc.');

  try {
    const drive = await openDrive(env);
    const folders = await ensureExamStreamFolders({
      db,
      drive,
      env,
      exam,
      relocateSources: false,
      useCache: openDrive === configuredDrive
    });
    const meta = await drive.metadata({ id: driveFileId });
    const actualParent = Array.isArray(meta?.parents) && meta.parents.length === 1 ? meta.parents[0] : '';
    const allowedParent =
      actualParent === folders.sourceFolderId
        ? folders.sourceFolderId
        : actualParent === folders.examFolderId
          ? folders.examFolderId
          : folders.sourceFolderId;

    await requireAllowedSharing(
      drive,
      meta,
      {
        drive_file_id: sf.driveFileId,
        name: sf.name,
        content_type: sf.mimeType,
        file_size: Number(sf.size),
        sha256: sf.sha256
      },
      { parentId: allowedParent }
    );
    const upstream = await drive.download({ id: driveFileId });
    return new Response(upstream.body, { headers: attachmentHeaders(sf.name || 'de-thi.docx') });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể tải tệp đề từ Drive.');
  }
}

async function previewSolutionFile({ db, env, exam, fileId, enable = false, openDrive }) {
  const record = data(
    await db
      .from('ltch_practice_solution_files')
      .select('*')
      .eq('id', id(fileId))
      .eq('exam_id', exam.id)
      .maybeSingle()
  );
  const isVideo = Boolean(
    record && (record.file_kind === 'video' || /^video\//i.test(String(record.content_type || '')))
  );
  demand(env.LTCH_DRIVE_LINK_PREVIEW === '1' || isVideo, 404, 'Chức năng chưa sẵn sàng.');
  demand(record && record.status === 'stored', 404, 'Không tìm thấy tài liệu.');

  try {
    const drive = await openDrive(env);
    const meta = await drive.metadata({ id: record.drive_file_id });
    const parentId = record.parent_folder_id || undefined;
    if (enable || isVideo) {
      await enableLinkSharing(drive, meta, record, { parentId });
    } else {
      await requireAllowedSharing(drive, meta, record, { parentId, allowLink: true, requireLink: true });
    }
    return json({ url: drivePreviewUrl(record.drive_file_id) });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể xác minh quyền xem tài liệu trên Drive.');
  }
}

async function streamSolutionVideo({ request, db, actor, env, exam, fileId, openDrive }) {
  const record = data(
    await db
      .from('ltch_practice_solution_files')
      .select('*')
      .eq('id', id(fileId))
      .eq('exam_id', exam.id)
      .maybeSingle()
  );
  demand(record && record.status === 'stored', 404, 'Không tìm thấy tài liệu.');

  try {
    const drive = await openDrive(env);
    const meta = await drive.metadata({ id: record.drive_file_id });
    const recordMime = String(record.content_type || '').trim().toLowerCase();
    const metaMime = String(meta?.mimeType || '').trim().toLowerCase();
    const mimeType = /^video\/[a-z0-9!#$&^_.+-]+$/i.test(recordMime)
      ? recordMime
      : /^video\/[a-z0-9!#$&^_.+-]+$/i.test(metaMime)
        ? metaMime
        : '';
    demand(mimeType, 400, 'Tệp này không phải video bài chữa.');
    const parentId = record.parent_folder_id || undefined;
    await requireAllowedSharing(drive, meta, record, { parentId, allowLink: true });
    const actualSize = Number(meta?.size || record.file_size);
    demand(Number.isSafeInteger(actualSize) && actualSize > 0, 503, 'Không thể xác định dung lượng video trên Drive.');
    const ticket = await sealVideoStreamTicket(env, {
      uid: actor.uid,
      driveFileId: record.drive_file_id,
      mimeType,
      size: actualSize
    });
    return json({
      url: buildVideoStreamUrl(env, request?.url, ticket),
      mimeType,
      size: actualSize,
      name: record.name
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể khởi tạo luồng phát video từ Drive.');
  }
}

async function buildExamSolutionPayload({ db, exam, canManage, env, actor, openDrive }) {
  const [metaRes, filesRes] = await Promise.all([
    db
      .from('ltch_practice_solutions')
      .select('exam_id,topic,solution_note,solution_date,updated_by,created_at,updated_at')
      .eq('exam_id', exam.id)
      .maybeSingle(),
    db
      .from('ltch_practice_solution_files')
      .select('id,exam_id,file_kind,name,content_type,file_size,created_at')
      .eq('exam_id', exam.id)
      .eq('status', 'stored')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200)
  ]);

  const metaRow = data(metaRes);
  const fileRows = data(filesRes) || [];

  const videos = [];
  const files = [];
  const uploadedExamFiles = [];
  let coverFileId = null;

  for (const row of fileRows) {
    const base = {
      id: row.id,
      fileKind: row.file_kind,
      name: row.name,
      content_type: row.content_type,
      file_size: Number(row.file_size) || 0,
      created_at: row.created_at
    };
    if (row.file_kind === 'cover') coverFileId = row.id;
    else if (row.file_kind === 'video') videos.push(base);
    else if (row.file_kind === 'exam_file') {
      uploadedExamFiles.push({
        ...base,
        sourceType: 'uploaded_exam_file',
        downloadPath: `/api/practice/exams/${exam.id}/solutions/files/${row.id}`
      });
    } else {
      files.push(base);
    }
  }

  const rawSources = Array.isArray(exam._examMeta?.sourceFiles) ? exam._examMeta.sourceFiles : [];
  const examFiles = [
    ...rawSources
      .filter((sf) => sf && sf.driveFileId)
      .map((sf) => ({
        id: `source-${sf.driveFileId}`,
        sourceType: 'exam_source',
        driveFileId: sf.driveFileId,
        name: sf.name || 'de-thi.docx',
        content_type: sf.mimeType || 'application/octet-stream',
        file_size: Number(sf.size) || 0,
        downloadPath: `/api/practice/exams/${exam.id}/solutions/source/${sf.driveFileId}`
      })),
    ...uploadedExamFiles
  ];

  const driveConfigured = Boolean(
    openDrive !== configuredDrive ||
      (env?.GOOGLE_DRIVE_CLIENT_ID && env?.GOOGLE_DRIVE_CLIENT_SECRET && env?.GOOGLE_DRIVE_REFRESH_TOKEN)
  );
  const solutionsEnabled = Boolean(lessonsAvailable(env, actor) && driveConfigured);
  const solutionDate = metaRow?.solution_date || '';

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      examType: String(exam.exam_type || 'thptqg').toLowerCase(),
      examCode: exam.exam_code || '',
      targetGrade: Number(exam.target_grade) || 12,
      durationMinutes: Number(exam.duration_minutes) || 90,
      questionCount: Array.isArray(exam.questions) ? exam.questions.length : 0,
      status: exam.status,
      canManage: Boolean(canManage)
    },
    solution: {
      examId: exam.id,
      topic: metaRow?.topic || '',
      solutionNote: metaRow?.solution_note || '',
      date: solutionDate,
      formattedDate: formatDateVi(solutionDate),
      coverFileId,
      videos,
      files,
      examFiles
    },
    solutionsEnabled,
    solutionsLinkPreview: env?.LTCH_DRIVE_LINK_PREVIEW === '1'
  };
}

export async function practiceSolutions(request, path, { db, actor, env, openDrive = configuredDrive }) {
  const match =
    /^\/api\/practice\/exams\/([A-Za-z0-9_-]{1,128})\/solutions(?:\/(?:files(?:\/([A-Za-z0-9_-]{1,128})(?:\/(preview|chunks|stream))?)?|source\/([A-Za-z0-9_-]{1,200})))?$/.exec(
      path
    );
  if (!match) return null;

  const examId = id(match[1]);
  const isFilesRoute = path.includes('/solutions/files');
  const fileIdParam = match[2] ? id(match[2]) : null;
  const subAction = match[3] || null;
  const sourceDriveFileId = match[4] || null;

  const exam = normalizeExamRow(
    data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle())
  );
  demand(
    exam && EXAM_TYPES.includes(String(exam.exam_type || '').toLowerCase()),
    404,
    'Không tìm thấy đề luyện.'
  );

  const access = await computePracticeAccess(db, actor);
  const sharedExamIds = await loadSharedExamIdsForYear(db, [exam], access.currentSchoolYearId);
  demand(
    isStudentAllowedExam(access, exam, sharedExamIds),
    403,
    'Bạn không có quyền truy cập đề luyện này.'
  );

  const canManage = canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade);

  if (sourceDriveFileId) {
    demand(request.method === 'GET', 405);
    demand(lessonsAvailable(env, actor), 404, 'Chức năng chưa sẵn sàng.');
    return downloadExamSourceFile({ db, env, exam, driveFileId: sourceDriveFileId, openDrive });
  }

  if (isFilesRoute) {
    if (env?.LTCH_LESSONS_ENABLED === '0') throw new ApiError(404, 'Chức năng chưa sẵn sàng.');

    if (subAction === 'chunks') {
      demand(request.method === 'POST', 405);
      demand(canManage, 403, 'Bạn không có quyền chỉnh sửa bài chữa của đề này.');
      return handleSolutionFileChunk(request, { db, actor, env, exam, fileId: fileIdParam, openDrive });
    }

    if (subAction === 'stream') {
      demand(request.method === 'GET', 405);
      return streamSolutionVideo({
        request,
        db,
        actor,
        env,
        exam,
        fileId: fileIdParam,
        openDrive
      });
    }

    if (subAction === 'preview') {
      demand(request.method === 'GET' || request.method === 'POST', 405);
      if (request.method === 'POST') {
        demand(isAdmin(actor) || canManage, 403, 'Bạn không có quyền bật xem nhanh tệp.');
      }
      return previewSolutionFile({
        db,
        env,
        exam,
        fileId: fileIdParam,
        enable: request.method === 'POST',
        openDrive
      });
    }

    if (request.method === 'POST') {
      demand(!fileIdParam, 405);
      demand(canManage, 403, 'Bạn không có quyền chỉnh sửa bài chữa của đề này.');
      demand(lessonsAvailable(env, actor), 404, 'Chức năng chưa sẵn sàng.');

      if (request.headers.get('content-type')?.startsWith('application/json')) {
        return startResumableSolutionFile(request, { db, actor, env, exam, openDrive });
      }
      return uploadMultipartSolutionFile(request, { db, actor, env, exam, openDrive });
    }

    demand(request.method === 'GET', 405);
    if (fileIdParam) {
      return downloadSolutionFile({ db, env, exam, fileId: fileIdParam, openDrive });
    }

    const filesRows = data(
      await db
        .from('ltch_practice_solution_files')
        .select('id,exam_id,file_kind,name,content_type,file_size,created_at')
        .eq('exam_id', exam.id)
        .eq('status', 'stored')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(200)
    );
    return json({ items: filesRows || [], hasMore: false });
  }

  // Root endpoint: /api/practice/exams/:examId/solutions
  if (request.method === 'GET') {
    const driveConfigured =
      openDrive !== configuredDrive ||
      Boolean(env?.GOOGLE_DRIVE_CLIENT_ID && env?.GOOGLE_DRIVE_CLIENT_SECRET && env?.GOOGLE_DRIVE_REFRESH_TOKEN);
    if (
      exam._examMeta?.storage === 'drive' &&
      !exam._examMeta?.driveSourceFolderId &&
      driveConfigured &&
      lessonsAvailable(env, actor)
    ) {
      try {
        const cachedSourceFolder = data(
          await db.from('ltch_drive_folders').select('drive_folder_id').eq('folder_key', `practice:source:${exam.id}`).maybeSingle()
        );
        if (!cachedSourceFolder?.drive_folder_id) {
          const drive = await openDrive(env);
          await ensureExamStreamFolders({
            db,
            drive,
            env,
            exam,
            relocateSources: true,
            useCache: openDrive === configuredDrive,
            activeClasses: access.activeClasses
          });
        }
      } catch {}
    }
    return json(await buildExamSolutionPayload({ db, exam, canManage, env, actor, openDrive }));
  }

  demand(request.method === 'POST', 405);
  demand(canManage, 403, 'Bạn không có quyền chỉnh sửa bài chữa của đề này.');

  const now = Date.now();
  const b = await readJson(request);

  if (b.action === 'update_meta') {
    const existingMeta = data(
      await db.from('ltch_practice_solutions').select('*').eq('exam_id', exam.id).maybeSingle()
    );
    const topic =
      typeof b.topic === 'string'
        ? b.topic.trim().slice(0, 200)
        : existingMeta?.topic || '';
    const solutionNote =
      typeof b.solutionNote === 'string'
        ? b.solutionNote.trim().slice(0, 1000)
        : existingMeta?.solution_note || '';
    let solutionDate = existingMeta?.solution_date || '';
    if (b.date !== undefined) {
      const trimmed = String(b.date || '').trim();
      if (!trimmed) {
        solutionDate = '';
      } else {
        const parsed = parseIsoDateParts(trimmed)?.iso;
        demand(parsed, 400, 'Ngày chữa đề không hợp lệ.');
        solutionDate = parsed;
      }
    }

    data(
      await db.from('ltch_practice_solutions').upsert(
        {
          exam_id: exam.id,
          topic,
          solution_note: solutionNote,
          solution_date: solutionDate,
          updated_by: actor.uid,
          created_at: existingMeta?.created_at ?? now,
          updated_at: now
        },
        { onConflict: 'exam_id' }
      )
    );
    return json({ ok: true, ...(await buildExamSolutionPayload({ db, exam, canManage, env, actor, openDrive })) });
  }

  if (b.action === 'sync_folders') {
    const drive = await openDrive(env);
    const folders = await ensureExamStreamFolders({
      db,
      drive,
      env,
      exam,
      relocateSources: true,
      useCache: openDrive === configuredDrive
    });
    return json({ ok: true, folders });
  }

  if (b.action === 'delete_file') {
    const fileId = id(b.fileId);
    const fileRow = data(
      await db
        .from('ltch_practice_solution_files')
        .select('id,exam_id,drive_file_id,file_kind,name,content_type')
        .eq('id', fileId)
        .eq('exam_id', exam.id)
        .maybeSingle()
    );
    demand(fileRow, 404, 'Không tìm thấy tệp cần xóa.');

    const driveOpener =
      openDrive !== configuredDrive
        ? openDrive
        : env?.GOOGLE_DRIVE_CLIENT_ID && env?.GOOGLE_DRIVE_CLIENT_SECRET && env?.GOOGLE_DRIVE_REFRESH_TOKEN
          ? configuredDrive
          : null;
    if (driveOpener && fileRow.drive_file_id) {
      try {
        const drive = await driveOpener(env);
        await drive.trash({ id: fileRow.drive_file_id });
      } catch {
        console.warn('LTCH_EXAM_PSOL_DRIVE_TRASH_FAILED');
      }
    }

    data(
      await db
        .from('ltch_practice_solution_files')
        .delete()
        .eq('id', fileId)
        .eq('exam_id', exam.id)
    );

    return json({
      ok: true,
      deletedFileId: fileId,
      ...(await buildExamSolutionPayload({ db, exam, canManage, env, actor, openDrive }))
    });
  }

  throw new ApiError(400, 'Thao tác bài chữa đề thi không hợp lệ.');
}
