import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError, data, demand, id, string } from './policy.mjs';
import { configuredDrive, folderName } from './lesson-storage.mjs';
import { ensureDriveFolder } from './drive-folders.mjs';
import { requireAllowedSharing } from './drive-preview.mjs';
import { resolveApiOrigin } from './config.mjs';

const POOL_FOLDER_NAMES = {
  thptqg: 'THPTQG',
  hsa: 'HSA',
  tsa: 'TSA'
};

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ALLOWED_SOURCE_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf'
]);

const MAX_STAGE_BATCH = 12;
const MAX_INLINE_AUTO_UPLOAD = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const PRACTICE_TICKET_LIFETIME = 4 * 60 * 60 * 1000;
const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PACK_CACHE_ENTRIES = 30;

const packCache = new Map();
const folderCache = new Map();

export function clearPracticeDriveCaches() {
  packCache.clear();
  folderCache.clear();
}

export function isPracticeDriveConfigured(env, openDrive) {
  if (typeof openDrive === 'function') return true;
  return Boolean(
    env?.GOOGLE_DRIVE_CLIENT_ID &&
    env?.GOOGLE_DRIVE_CLIENT_SECRET &&
    env?.GOOGLE_DRIVE_REFRESH_TOKEN
  );
}

function normalizeMimeType(rawMime, fileName = '') {
  const cleaned = String(rawMime || '').trim().toLowerCase().split(';')[0];
  if (cleaned === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_IMAGE_TYPES.has(cleaned) || ALLOWED_SOURCE_TYPES.has(cleaned)) return cleaned;
  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return cleaned;
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return 'bin';
}

function matchesMagicBytes(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return false;
  if (mimeType === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    );
  }
  if (mimeType === 'application/pdf') {
    return bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  return false;
}

function decodeBase64ToBytes(rawBase64) {
  let b64 = String(rawBase64 || '').trim();
  const dataPrefix = /^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(b64);
  let extractedMime = null;
  if (dataPrefix) {
    extractedMime = normalizeMimeType(dataPrefix[1]);
    b64 = dataPrefix[2];
  }
  b64 = b64.replace(/\s+/g, '');
  demand(b64.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b64), 400, 'Dữ liệu tệp mã hóa base64 không hợp lệ.');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  demand(bytes.byteLength > 0, 400, 'Tệp tải lên không được rỗng.');
  return { bytes, extractedMime };
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitizeSafeFileName(rawName, fallback) {
  const cleaned = String(rawName || fallback || 'file')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

function isDriveFolderMetaValid(meta, expectedId) {
  return Boolean(
    meta &&
    meta.id === expectedId &&
    meta.mimeType === 'application/vnd.google-apps.folder' &&
    meta.trashed === false &&
    meta.shared === false &&
    meta.ownedByMe === true
  );
}

function isValidFolderMeta(meta, expectedId, expectedName, expectedParentId, isRootOk = false) {
  return Boolean(
    isDriveFolderMetaValid(meta, expectedId) &&
    meta.name === expectedName &&
    Array.isArray(meta.parents) &&
    meta.parents.length === 1 &&
    (expectedParentId === 'root' ? isRootOk : meta.parents[0] === expectedParentId)
  );
}

async function tryResolvePoolFolderFast({ byKey, drive, poolKey, poolTitle }) {
  const rootRec = byKey.get('ltch-root');
  const practiceRootRec = byKey.get('practice:root');
  const poolRec = byKey.get(poolKey);
  if (
    !rootRec?.drive_folder_id ||
    !practiceRootRec?.drive_folder_id ||
    !poolRec?.drive_folder_id ||
    rootRec.folder_name !== 'Lớp Toán cô Hạnh' ||
    practiceRootRec.folder_name !== 'Phòng luyện' ||
    practiceRootRec.parent_folder_id !== rootRec.drive_folder_id ||
    poolRec.folder_name !== poolTitle ||
    poolRec.parent_folder_id !== practiceRootRec.drive_folder_id
  ) {
    return null;
  }
  try {
    const [rootMeta, isRootOk, practiceRootMeta, poolMeta] = await Promise.all([
      drive.metadata({ id: rootRec.drive_folder_id }),
      drive.isRootChild({ id: rootRec.drive_folder_id, name: rootRec.folder_name }),
      drive.metadata({ id: practiceRootRec.drive_folder_id }),
      drive.metadata({ id: poolRec.drive_folder_id })
    ]);
    if (
      isValidFolderMeta(rootMeta, rootRec.drive_folder_id, 'Lớp Toán cô Hạnh', 'root', isRootOk) &&
      isValidFolderMeta(practiceRootMeta, practiceRootRec.drive_folder_id, 'Phòng luyện', rootRec.drive_folder_id) &&
      isValidFolderMeta(poolMeta, poolRec.drive_folder_id, poolTitle, practiceRootRec.drive_folder_id)
    ) {
      return poolRec.drive_folder_id;
    }
  } catch (err) {
    if (err?.code !== 'not_found') throw err;
  }
  return null;
}

async function tryVerifyExamFoldersFast({ byKey, drive, examKey, stableExamFolderName, poolFolderId, childSpecs }) {
  const examRec = byKey.get(examKey);
  if (!examRec?.drive_folder_id || examRec.parent_folder_id !== poolFolderId || examRec.folder_name !== stableExamFolderName) {
    return null;
  }
  const childRecs = childSpecs.map((spec) => byKey.get(spec.key));
  if (childRecs.some((rec, i) => !rec?.drive_folder_id || rec.parent_folder_id !== examRec.drive_folder_id || rec.folder_name !== childSpecs[i].name)) {
    return null;
  }
  try {
    const [examMeta, ...childMetas] = await Promise.all([
      drive.metadata({ id: examRec.drive_folder_id }),
      ...childRecs.map((rec) => drive.metadata({ id: rec.drive_folder_id }))
    ]);
    const valid =
      isValidFolderMeta(examMeta, examRec.drive_folder_id, stableExamFolderName, poolFolderId) &&
      childSpecs.every((spec, i) => isValidFolderMeta(childMetas[i], childRecs[i].drive_folder_id, spec.name, examRec.drive_folder_id));
    if (!valid) return null;
    return {
      examFolderId: examRec.drive_folder_id,
      sourceFolderId: childRecs[0].drive_folder_id,
      videoFolderId: childRecs[1].drive_folder_id,
      docFolderId: childRecs[2].drive_folder_id,
      mediaFolderId: childRecs[3].drive_folder_id
    };
  } catch (err) {
    if (err?.code !== 'not_found') throw err;
    return null;
  }
}

async function tryCreateExamFoldersBatch({ db, drive, examKey, stableExamFolderName, poolFolderId, childSpecs }) {
  const [newExamId, ...newChildIds] = await drive.reserveIds(1 + childSpecs.length);
  const desiredRows = [
    { folder_key: examKey, drive_folder_id: newExamId, parent_folder_id: poolFolderId, folder_name: stableExamFolderName },
    ...childSpecs.map((spec, idx) => ({
      folder_key: spec.key,
      drive_folder_id: newChildIds[idx],
      parent_folder_id: newExamId,
      folder_name: spec.name
    }))
  ];
  data(await db.from('ltch_drive_folders').upsert(desiredRows, { onConflict: 'folder_key', ignoreDuplicates: true }));

  const targetKeys = [examKey, ...childSpecs.map((spec) => spec.key)];
  const reloaded = data(await db.from('ltch_drive_folders').select('*').in('folder_key', targetKeys)) || [];
  const reloadedByKey = new Map(reloaded.map((r) => [r.folder_key, r]));
  const examRec = reloadedByKey.get(examKey);
  if (
    reloaded.length !== targetKeys.length ||
    !examRec?.drive_folder_id ||
    examRec.drive_folder_id !== newExamId ||
    examRec.parent_folder_id !== poolFolderId ||
    examRec.folder_name !== stableExamFolderName ||
    childSpecs.some((spec, idx) => {
      const rec = reloadedByKey.get(spec.key);
      return !rec || rec.drive_folder_id !== newChildIds[idx] || rec.parent_folder_id !== newExamId || rec.folder_name !== spec.name;
    })
  ) {
    return null;
  }

  try {
    await drive.createFolder({ id: newExamId, parentId: poolFolderId, name: stableExamFolderName });
  } catch (err) {
    if (err?.code !== 'conflict') throw err;
  }
  await Promise.all(
    childSpecs.map(async (spec, idx) => {
      try {
        await drive.createFolder({ id: newChildIds[idx], parentId: newExamId, name: spec.name });
      } catch (err) {
        if (err?.code !== 'conflict') throw err;
      }
    })
  );
  const [examMeta, ...childMetas] = await Promise.all([
    drive.metadata({ id: newExamId }),
    ...newChildIds.map((fid) => drive.metadata({ id: fid }))
  ]);
  const valid =
    isValidFolderMeta(examMeta, newExamId, stableExamFolderName, poolFolderId) &&
    childSpecs.every((spec, idx) => isValidFolderMeta(childMetas[idx], newChildIds[idx], spec.name, newExamId));
  demand(valid, 503, 'Thư mục Drive không còn riêng tư hoặc không đúng cấu trúc.');

  return {
    examFolderId: newExamId,
    sourceFolderId: newChildIds[0],
    videoFolderId: newChildIds[1],
    docFolderId: newChildIds[2],
    mediaFolderId: newChildIds[3]
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

export async function ensurePracticeExamFolders({ db, drive, env, examId, examType, title, useCache = true }) {
  const normType = String(examType || 'thptqg').toLowerCase();
  const poolTitle = POOL_FOLDER_NAMES[normType];
  demand(Boolean(poolTitle), 400, 'Kỳ thi phòng luyện không hợp lệ.');

  const ownerTag = `${env?.GOOGLE_DRIVE_CLIENT_ID || ''}:${String(env?.GOOGLE_DRIVE_REFRESH_TOKEN || '').slice(-8)}`;
  const examKey = `practice:exam:${id(examId)}`;
  const sourceKey = `practice:source:${id(examId)}`;
  const videoKey = `practice:sol-video:${id(examId)}`;
  const docKey = `practice:sol-doc:${id(examId)}`;
  const mediaKey = `practice:media:${id(examId)}`;

  if (useCache) {
    const cachedExam = folderCache.get(`${ownerTag}:${examKey}`);
    const cachedSource = folderCache.get(`${ownerTag}:${sourceKey}`);
    const cachedVideo = folderCache.get(`${ownerTag}:${videoKey}`);
    const cachedDoc = folderCache.get(`${ownerTag}:${docKey}`);
    const cachedMedia = folderCache.get(`${ownerTag}:${mediaKey}`);
    const now = Date.now();
    if (
      cachedExam && cachedSource && cachedVideo && cachedDoc && cachedMedia &&
      cachedExam.expiresAt > now && cachedSource.expiresAt > now &&
      cachedVideo.expiresAt > now && cachedDoc.expiresAt > now && cachedMedia.expiresAt > now
    ) {
      try {
        const [examMeta, sourceMeta, videoMeta, docMeta, mediaMeta] = await Promise.all([
          drive.metadata({ id: cachedExam.folderId }),
          drive.metadata({ id: cachedSource.folderId }),
          drive.metadata({ id: cachedVideo.folderId }),
          drive.metadata({ id: cachedDoc.folderId }),
          drive.metadata({ id: cachedMedia.folderId })
        ]);
        const childOk = (meta, cached) =>
          isDriveFolderMetaValid(meta, cached.folderId) && meta.parents?.[0] === cachedExam.folderId;
        if (
          isDriveFolderMetaValid(examMeta, cachedExam.folderId) &&
          childOk(sourceMeta, cachedSource) &&
          childOk(videoMeta, cachedVideo) &&
          childOk(docMeta, cachedDoc) &&
          childOk(mediaMeta, cachedMedia)
        ) {
          return {
            examFolderId: cachedExam.folderId,
            sourceFolderId: cachedSource.folderId,
            videoFolderId: cachedVideo.folderId,
            docFolderId: cachedDoc.folderId,
            mediaFolderId: cachedMedia.folderId
          };
        }
      } catch (err) {
        if (err?.code !== 'not_found') throw err;
      }
      for (const k of [examKey, sourceKey, videoKey, docKey, mediaKey]) {
        folderCache.delete(`${ownerTag}:${k}`);
      }
    }
  }

  const poolKey = `practice:pool:${normType}`;
  const childSpecs = [
    { key: sourceKey, name: 'File đề' },
    { key: videoKey, name: 'Video chữa' },
    { key: docKey, name: 'File tài liệu' },
    { key: mediaKey, name: 'Hình minh họa' }
  ];
  const allKeys = ['ltch-root', 'practice:root', poolKey, examKey, sourceKey, videoKey, docKey, mediaKey];
  const existingRows = data(await db.from('ltch_drive_folders').select('*').in('folder_key', allKeys)) || [];
  const byKey = new Map(existingRows.map((r) => [r.folder_key, r]));
  const stableExamFolderName = byKey.get(examKey)?.folder_name || folderName(title || `Đề ${normType.toUpperCase()}`, examId);

  let poolFolderId = await tryResolvePoolFolderFast({ byKey, drive, poolKey, poolTitle });
  if (!poolFolderId) {
    const rootFolderId = await ensureDriveFolder({
      db, drive, key: 'ltch-root', parentId: await drive.rootId(), name: 'Lớp Toán cô Hạnh'
    });
    const practiceRootId = await ensureDriveFolder({
      db, drive, key: 'practice:root', parentId: rootFolderId, name: 'Phòng luyện'
    });
    poolFolderId = await ensureDriveFolder({
      db, drive, key: poolKey, parentId: practiceRootId, name: poolTitle
    });
  }

  let resolved = await tryVerifyExamFoldersFast({
    byKey, drive, examKey, stableExamFolderName, poolFolderId, childSpecs
  });
  if (!resolved && !byKey.has(examKey) && childSpecs.every((spec) => !byKey.has(spec.key))) {
    resolved = await tryCreateExamFoldersBatch({
      db, drive, examKey, stableExamFolderName, poolFolderId, childSpecs
    });
  }
  if (!resolved) {
    const examFolderId = await ensureDriveFolder({
      db, drive, key: examKey, parentId: poolFolderId, name: stableExamFolderName
    });
    const [sourceFolderId, videoFolderId, docFolderId, mediaFolderId] = await Promise.all(
      childSpecs.map((spec) => ensureDriveFolder({ db, drive, key: spec.key, parentId: examFolderId, name: spec.name }))
    );
    resolved = { examFolderId, sourceFolderId, videoFolderId, docFolderId, mediaFolderId };
  }
  const { examFolderId, sourceFolderId, videoFolderId, docFolderId, mediaFolderId } = resolved;

  if (useCache) {
    const expiresAt = Date.now() + FOLDER_CACHE_TTL_MS;
    folderCache.set(`${ownerTag}:${examKey}`, { folderId: examFolderId, expiresAt });
    folderCache.set(`${ownerTag}:${sourceKey}`, { folderId: sourceFolderId, expiresAt });
    folderCache.set(`${ownerTag}:${videoKey}`, { folderId: videoFolderId, expiresAt });
    folderCache.set(`${ownerTag}:${docKey}`, { folderId: docFolderId, expiresAt });
    folderCache.set(`${ownerTag}:${mediaKey}`, { folderId: mediaFolderId, expiresAt });
  }

  return { examFolderId, sourceFolderId, videoFolderId, docFolderId, mediaFolderId };
}

async function uploadAndVerifyPrivateFile(drive, { id: fileId, parentId, name, contentType, bytes, sha256 }) {
  try {
    await drive.upload({ id: fileId, parentId, name, contentType, bytes, sha256 });
  } catch (err) {
    if (err?.code !== 'conflict') throw err;
  }
  const meta = await drive.metadata({ id: fileId });
  await requireAllowedSharing(
    drive,
    meta,
    {
      drive_file_id: fileId,
      name,
      content_type: contentType,
      file_size: bytes.byteLength,
      sha256
    },
    { parentId }
  );
  return meta;
}

export async function stagePracticeDriveAssets({
  db,
  env,
  openDrive = configuredDrive,
  examId,
  examType,
  title,
  assets,
  existingMedia = []
}) {
  demand(Array.isArray(assets) && assets.length >= 1 && assets.length <= MAX_STAGE_BATCH, 400, `Mỗi lần tải tối đa ${MAX_STAGE_BATCH} tệp.`);

  const parsedItems = assets.map((asset, idx) => {
    demand(asset && typeof asset === 'object', 400, `Tệp thứ ${idx + 1} không hợp lệ.`);
    const kind = asset.kind === 'source' ? 'source' : 'image';
    const key = string(String(asset.key || asset.id || `asset_${idx + 1}`), 128);
    const { bytes, extractedMime } = decodeBase64ToBytes(asset.dataUrl || asset.dataBase64);
    const mimeType = normalizeMimeType(asset.mimeType || extractedMime, asset.name);

    if (kind === 'image') {
      demand(ALLOWED_IMAGE_TYPES.has(mimeType), 400, `Ảnh "${asset.name || key}" phải là PNG, JPG, GIF hoặc WebP.`);
      demand(bytes.byteLength <= MAX_IMAGE_BYTES, 400, `Ảnh "${asset.name || key}" vượt quá giới hạn 2 MB.`);
      demand(matchesMagicBytes(bytes, mimeType), 400, `Nội dung ảnh "${asset.name || key}" không khớp định dạng ${mimeType}.`);
    } else {
      demand(ALLOWED_SOURCE_TYPES.has(mimeType), 400, `Tệp nguồn "${asset.name || key}" chỉ hỗ trợ .docx hoặc .pdf.`);
      demand(bytes.byteLength <= MAX_SOURCE_BYTES, 400, `Tệp nguồn "${asset.name || key}" vượt quá giới hạn 10 MB.`);
      demand(matchesMagicBytes(bytes, mimeType), 400, `Nội dung tệp "${asset.name || key}" không khớp định dạng khai báo.`);
    }

    const sha256 = sha256Hex(bytes);
    const ext = extensionForMime(mimeType);
    const fallbackName = kind === 'image' ? `${key}_${sha256.slice(0, 8)}.${ext}` : `${key}.${ext}`;
    const safeName = kind === 'image'
      ? `${sanitizeSafeFileName(asset.id || key, 'img').slice(0, 80)}_${sha256.slice(0, 8)}.${ext}`
      : sanitizeSafeFileName(asset.name, fallbackName);

    return {
      index: idx,
      key,
      kind,
      id: typeof asset.id === 'string' ? asset.id.slice(0, 128) : key,
      name: safeName,
      mimeType,
      bytes,
      size: bytes.byteLength,
      sha256
    };
  });

  const drive = await openDrive(env);
  const { examFolderId, sourceFolderId, mediaFolderId } = await ensurePracticeExamFolders({
    db,
    drive,
    env,
    examId,
    examType,
    title,
    useCache: openDrive === configuredDrive
  });

  const knownImagesByHash = new Map();
  for (const m of existingMedia || []) {
    if (m?.sha256 && m?.driveFileId) {
      knownImagesByHash.set(String(m.sha256).toLowerCase(), m);
    }
  }

  const dedupedToUpload = [];
  const resolved = new Array(parsedItems.length);
  const queuedImagesBySha = new Set();
  const uploadedImagesBySha = new Map();

  for (const item of parsedItems) {
    if (item.kind === 'image') {
      const existing = knownImagesByHash.get(item.sha256);
      if (existing) {
        resolved[item.index] = {
          key: item.key,
          kind: 'image',
          id: item.id,
          name: existing.name || item.name,
          driveFileId: existing.driveFileId,
          mimeType: existing.mimeType || item.mimeType,
          size: Number(existing.size) || item.size,
          sha256: item.sha256
        };
        continue;
      }
      if (queuedImagesBySha.has(item.sha256)) {
        continue;
      }
      queuedImagesBySha.add(item.sha256);
    }
    dedupedToUpload.push(item);
  }

  if (dedupedToUpload.length > 0) {
    const ids = await drive.reserveIds(dedupedToUpload.length);
    await runWithConcurrency(dedupedToUpload, 4, async (item, i) => {
      const driveFileId = ids[i];
      const parentId = item.kind === 'image' ? mediaFolderId : sourceFolderId;
      await uploadAndVerifyPrivateFile(drive, {
        id: driveFileId,
        parentId,
        name: item.name,
        contentType: item.mimeType,
        bytes: item.bytes,
        sha256: item.sha256
      });
      const descriptor = {
        key: item.key,
        kind: item.kind,
        id: item.id,
        name: item.name,
        driveFileId,
        mimeType: item.mimeType,
        size: item.size,
        sha256: item.sha256
      };
      resolved[item.index] = descriptor;
      if (item.kind === 'image') {
        uploadedImagesBySha.set(item.sha256, descriptor);
      }
    });

    for (const item of parsedItems) {
      if (!resolved[item.index] && item.kind === 'image') {
        const uploaded = uploadedImagesBySha.get(item.sha256);
        if (uploaded) {
          resolved[item.index] = { ...uploaded, key: item.key, id: item.id };
        }
      }
    }
  }

  return {
    examFolderId,
    sourceFolderId,
    mediaFolderId,
    assets: resolved
  };
}

export function compactQuestionStub(q) {
  if (!q || typeof q !== 'object') return q;
  const stub = {
    id: q.id,
    order: q.order,
    questionCode: q.questionCode || q.question_code || undefined,
    version: Number(q.version) || 1,
    section: q.section || 'part_1',
    type: q.type,
    points: q.points
  };
  if (Number.isFinite(Number(q.displayNumber)) && Number(q.displayNumber) > 0) {
    stub.displayNumber = Number(q.displayNumber);
  }
  if (q.subject) stub.subject = q.subject;
  if (q.clusterId) stub.clusterId = q.clusterId;
  if (q.passageId) stub.passageId = q.passageId;

  if (q.type === 'single') {
    stub.answer = q.answer;
  } else if (q.type === 'multiple') {
    const count = Array.isArray(q.options) ? q.options.length : 4;
    stub.options = Array.from({ length: count }, (_, i) => 'ABCDEF'[i] || String(i + 1));
    stub.answers = Array.isArray(q.answers) ? [...q.answers] : [];
  } else if (q.type === 'true_false') {
    stub.answers = Array.isArray(q.answers) ? [...q.answers] : [];
    if (Array.isArray(q.weights)) stub.weights = [...q.weights];
  } else if (q.type === 'short') {
    stub.accepted = Array.isArray(q.accepted) ? [...q.accepted] : [];
  } else if (q.type === 'fill_blank') {
    stub.blanks = Array.isArray(q.blanks) ? q.blanks : [];
  } else if (q.type === 'drag_drop') {
    const count = Array.isArray(q.cards) ? q.cards.length : 2;
    stub.cards = Array.from({ length: count }, (_, i) => `T${i + 1}`);
    if (Array.isArray(q.answer)) stub.answer = [...q.answer];
    else if (Array.isArray(q.answers)) stub.answers = [...q.answers];
  }

  return stub;
}

export function hydrateQuestionsFromPack(stubs, packQuestions) {
  if (!Array.isArray(stubs)) return [];
  if (!Array.isArray(packQuestions) || !packQuestions.length) return stubs;

  const byId = new Map();
  const byCode = new Map();
  for (const pq of packQuestions) {
    if (pq?.id) byId.set(pq.id, pq);
    const code = pq?.questionCode || pq?.question_code;
    if (code) byCode.set(code, pq);
  }

  return stubs.map((stub) => {
    if (!stub || typeof stub !== 'object') return stub;
    const full =
      byId.get(stub.id) ||
      (stub.questionCode || stub.question_code ? byCode.get(stub.questionCode || stub.question_code) : null);
    if (!full) return stub;
    return {
      ...full,
      ...stub,
      prompt: full.prompt,
      solution: full.solution || '',
      passageContent: full.passageContent,
      passageMedia: full.passageMedia,
      media: full.media,
      options: full.options ?? stub.options,
      statements: full.statements ?? stub.statements,
      cards: full.cards ?? stub.cards,
      blanks: full.blanks ?? stub.blanks
    };
  });
}

function cleanMediaForPack(mediaList) {
  if (!Array.isArray(mediaList) || !mediaList.length) return undefined;
  return mediaList.map((m) => {
    const clean = { id: m.id };
    if (m.driveFileId) clean.driveFileId = m.driveFileId;
    if (m.mimeType) clean.mimeType = m.mimeType;
    if (m.size) clean.size = m.size;
    if (m.sha256) clean.sha256 = m.sha256;
    if (m.width) clean.width = m.width;
    if (m.height) clean.height = m.height;
    if (m.inSolution) clean.inSolution = true;
    if (!m.driveFileId && m.path && !/^word\/media\//i.test(m.path)) clean.path = m.path;
    return clean;
  });
}

function sanitizeSourceFilesList(sourceFiles) {
  if (!Array.isArray(sourceFiles) || !sourceFiles.length) return [];
  demand(sourceFiles.length <= 20, 400, 'Mỗi bộ đề chỉ lưu tối đa 20 tệp nguồn gốc.');
  return sourceFiles.map((sf) => {
    demand(sf && typeof sf === 'object', 400, 'Thông tin tệp nguồn không hợp lệ.');
    const driveFileId = String(sf.driveFileId || '');
    demand(/^[A-Za-z0-9_-]{1,200}$/.test(driveFileId), 400, 'Mã tệp Drive của tài liệu nguồn không hợp lệ.');
    const mimeType = normalizeMimeType(sf.mimeType, sf.name);
    demand(ALLOWED_SOURCE_TYPES.has(mimeType), 400, 'Loại tệp nguồn không hợp lệ.');
    const size = Number(sf.size);
    demand(Number.isSafeInteger(size) && size > 0 && size <= MAX_SOURCE_BYTES, 400, 'Kích thước tệp nguồn không hợp lệ.');
    const rawSha = sf.sha256 == null ? '' : String(sf.sha256).trim().toLowerCase();
    const out = {
      name: sanitizeSafeFileName(sf.name, `source.${extensionForMime(mimeType)}`),
      driveFileId,
      mimeType,
      size
    };
    if (rawSha) {
      demand(/^[a-f0-9]{64}$/.test(rawSha), 400, 'Mã kiểm tra tệp nguồn không hợp lệ.');
      out.sha256 = rawSha;
    }
    return out;
  });
}

function setPackCache(cacheKey, pack) {
  if (packCache.has(cacheKey)) packCache.delete(cacheKey);
  packCache.set(cacheKey, pack);
  while (packCache.size > MAX_PACK_CACHE_ENTRIES) {
    const oldestKey = packCache.keys().next().value;
    packCache.delete(oldestKey);
  }
}

function cacheEdgeUrl(drivePackFileId, drivePackSha256) {
  return `https://practice-pack.ltch.internal/${encodeURIComponent(drivePackFileId)}/${encodeURIComponent(drivePackSha256 || 'v1')}`;
}

function toDriveSourceDescriptor(child) {
  const driveFileId = typeof child?.id === 'string' ? child.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(driveFileId)) return null;
  const rawName = String(child?.name || '').trim();
  const mimeType = normalizeMimeType(child?.mimeType, rawName);
  if (!ALLOWED_SOURCE_TYPES.has(mimeType)) return null;
  const size = Number(child?.size || 0);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_BYTES) return null;
  const out = {
    name: sanitizeSafeFileName(rawName, `source.${extensionForMime(mimeType)}`),
    driveFileId,
    mimeType,
    size
  };
  const sha = typeof child?.appProperties?.ltchSha256 === 'string'
    ? child.appProperties.ltchSha256.trim().toLowerCase()
    : '';
  if (/^[a-f0-9]{64}$/.test(sha)) {
    out.sha256 = sha;
  }
  return out;
}

export async function relocateLegacySourceFilesToSubfolder({ drive, sourceFiles = [], examFolderId, sourceFolderId }) {
  const seedList = Array.isArray(sourceFiles) ? sourceFiles.filter((sf) => sf && sf.driveFileId) : [];
  if (!examFolderId || !sourceFolderId) {
    return seedList.slice(0, 20);
  }

  const knownIds = new Set();
  const byId = new Map();
  for (const sf of seedList) {
    const fileId = typeof sf?.driveFileId === 'string' ? sf.driveFileId.trim() : '';
    if (!fileId) continue;
    knownIds.add(fileId);
    byId.set(fileId, sf);
    if (typeof drive?.moveFile === 'function' && typeof drive?.metadata === 'function') {
      try {
        const meta = await drive.metadata({ id: fileId });
        if (Array.isArray(meta?.parents) && meta.parents.includes(examFolderId) && !meta.parents.includes(sourceFolderId)) {
          await drive.moveFile({ id: fileId, addParentId: sourceFolderId, removeParentId: examFolderId });
        }
      } catch {}
    }
  }

  if (typeof drive?.listFolderChildren === 'function') {
    const movedChildren = [];
    try {
      const rootChildren = await drive.listFolderChildren({ parentId: examFolderId });
      for (const child of Array.isArray(rootChildren) ? rootChildren : []) {
        const childId = typeof child?.id === 'string' ? child.id.trim() : '';
        if (!childId || child.trashed === true || child.ownedByMe === false) continue;
        if (child.mimeType === 'application/vnd.google-apps.folder') continue;
        const rawName = String(child.name || '');
        if (/^de-luyen-v\d+\.json$/i.test(rawName)) continue;
        const mime = normalizeMimeType(child.mimeType, rawName);
        if (!ALLOWED_SOURCE_TYPES.has(mime)) continue;
        if (typeof drive?.moveFile === 'function') {
          try {
            await drive.moveFile({ id: childId, addParentId: sourceFolderId, removeParentId: examFolderId });
            movedChildren.push(child);
          } catch {}
        }
      }
    } catch {}

    let sourceChildren = [];
    try {
      const listed = await drive.listFolderChildren({ parentId: sourceFolderId });
      if (Array.isArray(listed)) sourceChildren = listed;
    } catch {}

    for (const child of [...sourceChildren, ...movedChildren]) {
      const desc = toDriveSourceDescriptor(child);
      if (!desc) continue;
      if (!byId.has(desc.driveFileId)) {
        byId.set(desc.driveFileId, desc);
      } else {
        const prev = byId.get(desc.driveFileId);
        if (!prev.sha256 && desc.sha256) {
          byId.set(desc.driveFileId, { ...prev, sha256: desc.sha256 });
        }
      }
    }
  }

  return [...byId.values()].slice(0, 20);
}

export async function savePracticeExamPackToDrive({
  db,
  env,
  openDrive = configuredDrive,
  examRow,
  enrichedQuestions,
  sourceFiles = [],
  previousExam = null
}) {
  const drive = await openDrive(env);
  const { examFolderId, sourceFolderId, videoFolderId, docFolderId, mediaFolderId } = await ensurePracticeExamFolders({
    db,
    drive,
    env,
    examId: examRow.id,
    examType: examRow.exam_type,
    title: examRow.title,
    useCache: openDrive === configuredDrive
  });
  const relocatedSources = await relocateLegacySourceFilesToSubfolder({
    drive,
    sourceFiles: previousExam?._examMeta?.sourceFiles || [],
    examFolderId,
    sourceFolderId
  });

  // Upload any remaining inline dataUrl images (for direct API callers / small restores)
  const existingMedia = [];
  for (const q of [...(previousExam?.questions || []), ...(enrichedQuestions || [])]) {
    for (const m of [...(q?.media || []), ...(q?.passageMedia || [])]) {
      if (m?.driveFileId && m?.sha256) existingMedia.push(m);
    }
  }

  const inlineByDataUrl = new Map();
  for (const q of enrichedQuestions) {
    for (const m of [...(q.media || []), ...(q.passageMedia || [])]) {
      if (m?.dataUrl && !m.driveFileId && !inlineByDataUrl.has(m.dataUrl)) {
        inlineByDataUrl.set(m.dataUrl, {
          key: `inline_${inlineByDataUrl.size + 1}`,
          kind: 'image',
          id: m.id,
          name: `${m.id}.png`,
          dataUrl: m.dataUrl
        });
      }
    }
  }

  let uploadedByDataUrl = new Map();
  if (inlineByDataUrl.size > 0) {
    demand(
      inlineByDataUrl.size <= MAX_INLINE_AUTO_UPLOAD,
      400,
      `Đề có ${inlineByDataUrl.size} hình ảnh chưa được tải lên Google Drive. Vui lòng dùng stage_drive_assets theo lô tối đa ${MAX_STAGE_BATCH} ảnh.`
    );
    const staged = await stagePracticeDriveAssets({
      db,
      env,
      openDrive: async () => drive,
      examId: examRow.id,
      examType: examRow.exam_type,
      title: examRow.title,
      assets: [...inlineByDataUrl.values()],
      existingMedia
    });
    const keys = [...inlineByDataUrl.keys()];
    staged.assets.forEach((desc, idx) => {
      uploadedByDataUrl.set(keys[idx], desc);
    });
  }

  const cleanQuestionsForPack = enrichedQuestions.map((q) => {
    const mapMediaArr = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return undefined;
      return cleanMediaForPack(arr.map((m) => {
        if (!m?.driveFileId && m?.dataUrl && uploadedByDataUrl.has(m.dataUrl)) {
          const desc = uploadedByDataUrl.get(m.dataUrl);
          return {
            ...m,
            driveFileId: desc.driveFileId,
            mimeType: desc.mimeType,
            size: desc.size,
            sha256: desc.sha256
          };
        }
        return m;
      }));
    };
    const next = { ...q };
    const media = mapMediaArr(q.media);
    if (media) next.media = media;
    else delete next.media;
    const passageMedia = mapMediaArr(q.passageMedia);
    if (passageMedia) next.passageMedia = passageMedia;
    else delete next.passageMedia;
    return next;
  });

  const cleanSources = sanitizeSourceFilesList(
    sourceFiles?.length ? sourceFiles : relocatedSources
  );

  const packPayload = {
    format: 'ltch-practice-pack-v1',
    examId: examRow.id,
    updatedAt: examRow.updated_at,
    examType: examRow.exam_type,
    examCode: examRow.exam_code || '01',
    title: examRow.title,
    questions: cleanQuestionsForPack
  };
  const packBytes = new TextEncoder().encode(JSON.stringify(packPayload));
  const packSha256 = sha256Hex(packBytes);
  const packFileName = `de-luyen-v${examRow.updated_at}.json`;
  const drivePackFileId = await drive.reserveId();

  await uploadAndVerifyPrivateFile(drive, {
    id: drivePackFileId,
    parentId: examFolderId,
    name: packFileName,
    contentType: 'application/json',
    bytes: packBytes,
    sha256: packSha256
  });

  const cacheKey = `${drivePackFileId}:${packSha256}`;
  setPackCache(cacheKey, packPayload);
  try {
    const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
    if (edgeCache) {
      await edgeCache.put(
        cacheEdgeUrl(drivePackFileId, packSha256),
        new Response(packBytes, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=31536000, immutable'
          }
        })
      );
    }
  } catch {}

  const oldPackFileId = previousExam?._examMeta?.drivePackFileId || null;
  if (oldPackFileId && oldPackFileId !== drivePackFileId) {
    packCache.delete(`${oldPackFileId}:${previousExam?._examMeta?.drivePackSha256 || ''}`);
  }

  return {
    stubs: cleanQuestionsForPack.map(compactQuestionStub),
    packQuestions: cleanQuestionsForPack,
    driveMeta: {
      storage: 'drive',
      driveFolderId: examFolderId,
      driveSourceFolderId: sourceFolderId,
      driveVideoFolderId: videoFolderId,
      driveDocFolderId: docFolderId,
      driveMediaFolderId: mediaFolderId,
      drivePackFileId,
      drivePackSha256: packSha256,
      drivePackSize: packBytes.byteLength,
      sourceFiles: cleanSources
    },
    oldPackFileId: oldPackFileId && oldPackFileId !== drivePackFileId ? oldPackFileId : null
  };
}

export async function loadExamQuestionsFromDrive(exam, { env, openDrive = configuredDrive } = {}) {
  if (!exam || typeof exam !== 'object') return exam;
  const meta = exam._examMeta || {};
  if (meta.storage !== 'drive' || !meta.drivePackFileId) {
    return exam;
  }

  const drivePackFileId = String(meta.drivePackFileId);
  const expectedSha = typeof meta.drivePackSha256 === 'string' ? meta.drivePackSha256.toLowerCase() : '';
  const cacheKey = `${drivePackFileId}:${expectedSha}`;

  let pack = packCache.get(cacheKey);
  if (!pack) {
    try {
      const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
      if (edgeCache) {
        const cachedResp = await edgeCache.match(cacheEdgeUrl(drivePackFileId, expectedSha));
        if (cachedResp && cachedResp.ok) {
          const bytes = new Uint8Array(await cachedResp.arrayBuffer());
          if (!expectedSha || sha256Hex(bytes) === expectedSha) {
            pack = JSON.parse(new TextDecoder().decode(bytes));
            setPackCache(cacheKey, pack);
          }
        }
      }
    } catch {}
  }

  if (!pack) {
    const drive = await openDrive(env);
    const response = await drive.download({ id: drivePackFileId });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expectedSha && sha256Hex(bytes) !== expectedSha) {
      throw new ApiError(503, 'Dữ liệu đề thi trên Google Drive không khớp chữ ký toàn vẹn.');
    }
    try {
      pack = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ApiError(503, 'Không thể đọc gói nội dung đề thi từ Google Drive.');
    }
    setPackCache(cacheKey, pack);
    try {
      const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
      if (edgeCache) {
        await edgeCache.put(
          cacheEdgeUrl(drivePackFileId, expectedSha),
          new Response(bytes, {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'public, max-age=31536000, immutable'
            }
          })
        );
      }
    } catch {}
  }

  const stubs = Array.isArray(exam.questions) && exam.questions.length ? exam.questions : (pack.questions || []);
  const hydrated = Array.isArray(exam.questions) && exam.questions.length
    ? hydrateQuestionsFromPack(stubs, pack.questions || [])
    : (pack.questions || []);

  return {
    ...exam,
    questions: hydrated
  };
}

function ticketSignature(env, payload) {
  demand(typeof env?.MAIL_SECRET === 'string' && env.MAIL_SECRET.length >= 32, 503, 'Dịch vụ tệp chưa sẵn sàng.');
  return createHmac('sha256', env.MAIL_SECRET).update('ltch:practice-media:v1|').update(payload).digest('base64url');
}

function driveFileIdOk(value) {
  demand(typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value), 400, 'Mã tệp Drive không hợp lệ.');
  return value;
}

export function createPracticeMediaTicket(env, { driveFileId, sha256, mimeType, size }, now = Date.now()) {
  const cleanDriveId = driveFileIdOk(driveFileId);
  const normMime = normalizeMimeType(mimeType);
  demand(ALLOWED_IMAGE_TYPES.has(normMime), 400, 'Định dạng ảnh không hợp lệ.');
  const cleanSha = typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : '';
  const payload = Buffer.from(
    JSON.stringify({
      df: cleanDriveId,
      sh: cleanSha,
      mt: normMime,
      sz: Number.isSafeInteger(Number(size)) ? Number(size) : 0,
      exp: now + PRACTICE_TICKET_LIFETIME
    })
  ).toString('base64url');
  return `${payload}.${ticketSignature(env, payload)}`;
}

export function verifyPracticeMediaTicket(env, ticket, now = Date.now()) {
  demand(typeof ticket === 'string' && ticket.length <= 2000, 403, 'Liên kết hình ảnh không hợp lệ.');
  const parts = ticket.split('.');
  demand(parts.length === 2 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)), 403, 'Liên kết hình ảnh không hợp lệ.');
  const expected = Buffer.from(ticketSignature(env, parts[0]));
  const actual = Buffer.from(parts[1]);
  demand(actual.length === expected.length && timingSafeEqual(actual, expected), 403, 'Liên kết hình ảnh không hợp lệ.');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(403, 'Liên kết hình ảnh không hợp lệ.');
  }
  demand(
    payload &&
    Number.isSafeInteger(payload.exp) &&
    payload.exp > now &&
    payload.exp <= now + PRACTICE_TICKET_LIFETIME + 60_000,
    403,
    'Liên kết hình ảnh đã hết hạn.'
  );
  demand(typeof payload.df === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(payload.df), 403, 'Liên kết hình ảnh không hợp lệ.');
  const driveFileId = payload.df;
  const mimeType = normalizeMimeType(payload.mt);
  demand(ALLOWED_IMAGE_TYPES.has(mimeType), 403, 'Định dạng hình ảnh không hợp lệ.');
  const sha256 = typeof payload.sh === 'string' && /^[a-f0-9]{64}$/i.test(payload.sh) ? payload.sh.toLowerCase() : '';
  return {
    driveFileId,
    mimeType,
    sha256,
    size: Number.isSafeInteger(Number(payload.sz)) ? Number(payload.sz) : 0
  };
}

export function attachSignedPracticeMediaUrls(questions, { env, requestUrl, now = Date.now() } = {}) {
  if (!Array.isArray(questions) || !questions.length) return questions;
  if (typeof env?.MAIL_SECRET !== 'string' || env.MAIL_SECRET.length < 32) return questions;

  const baseOrigin = resolveApiOrigin(env, requestUrl);

  const signEntry = (m) => {
    if (!m || !m.driveFileId) return m;
    const ticket = createPracticeMediaTicket(env, {
      driveFileId: m.driveFileId,
      sha256: m.sha256 || '',
      mimeType: m.mimeType || 'image/png',
      size: m.size || 0
    }, now);
    const url = baseOrigin ? `${baseOrigin}/api/practice-media?ticket=${ticket}` : `/api/practice-media?ticket=${ticket}`;
    return { ...m, url };
  };

  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q;
    const hasMedia = Array.isArray(q.media) && q.media.some(m => m?.driveFileId);
    const hasPassageMedia = Array.isArray(q.passageMedia) && q.passageMedia.some(m => m?.driveFileId);
    if (!hasMedia && !hasPassageMedia) return q;
    return {
      ...q,
      ...(hasMedia ? { media: q.media.map(signEntry) } : {}),
      ...(hasPassageMedia ? { passageMedia: q.passageMedia.map(signEntry) } : {})
    };
  });
}

export async function practiceMedia(request, { env, openDrive = configuredDrive } = {}) {
  demand(request.method === 'GET' || request.method === 'HEAD', 405);
  const ticketRaw = new URL(request.url).searchParams.get('ticket');
  const ticket = verifyPracticeMediaTicket(env, ticketRaw);
  const edgeUrl = `https://practice-media.ltch.internal/${encodeURIComponent(ticket.driveFileId)}/${encodeURIComponent(ticket.sha256 || 'v1')}`;

  const responseHeaders = {
    'content-type': ticket.mimeType,
    'content-disposition': 'inline',
    'cache-control': 'private, max-age=14400, immutable',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'cross-origin'
  };

  if (request.method === 'HEAD') {
    if (ticket.size > 0) responseHeaders['content-length'] = String(ticket.size);
    return new Response(null, { status: 200, headers: responseHeaders });
  }

  try {
    const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
    if (edgeCache) {
      const cached = await edgeCache.match(edgeUrl);
      if (cached && cached.ok) {
        const headers = new Headers(responseHeaders);
        const len = cached.headers.get('content-length');
        if (len) headers.set('content-length', len);
        return new Response(cached.body, { status: 200, headers });
      }
    }
  } catch {}

  try {
    const drive = await openDrive(env);
    const upstream = await drive.download({ id: ticket.driveFileId });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (ticket.sha256 && sha256Hex(bytes) !== ticket.sha256) {
      throw new ApiError(503, 'Hình ảnh trên Drive không khớp mã toàn vẹn.');
    }
    const headers = new Headers(responseHeaders);
    headers.set('content-length', String(bytes.byteLength));
    try {
      const edgeCache = typeof caches !== 'undefined' ? caches.default : null;
      if (edgeCache) {
        await edgeCache.put(
          edgeUrl,
          new Response(bytes, {
            headers: {
              'content-type': ticket.mimeType,
              'content-length': String(bytes.byteLength),
              'cache-control': 'public, max-age=31536000, immutable'
            }
          })
        );
      }
    } catch {}
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể tải hình ảnh từ Drive.');
  }
}

export async function trashPracticeExamOnDrive({
  db,
  env,
  openDrive = configuredDrive,
  examId,
  driveFolderId = null,
  drivePackFileId = null
}) {
  if (!isPracticeDriveConfigured(env, openDrive)) return;
  const examKey = `practice:exam:${examId}`;
  const sourceKey = `practice:source:${examId}`;
  const videoKey = `practice:sol-video:${examId}`;
  const docKey = `practice:sol-doc:${examId}`;
  const mediaKey = `practice:media:${examId}`;
  const allKeys = [sourceKey, videoKey, docKey, mediaKey, examKey];

  let folderToTrash = driveFolderId || null;
  try {
    const folderRow = data(
      await db.from('ltch_drive_folders').select('drive_folder_id').eq('folder_key', examKey).maybeSingle()
    );
    if (folderRow?.drive_folder_id) folderToTrash = folderRow.drive_folder_id;
  } catch {}

  if (drivePackFileId) {
    for (const k of packCache.keys()) {
      if (k.startsWith(`${drivePackFileId}:`)) packCache.delete(k);
    }
  }
  for (const k of folderCache.keys()) {
    if (allKeys.some((suffix) => k.endsWith(`:${suffix}`))) folderCache.delete(k);
  }

  if (folderToTrash || drivePackFileId) {
    const drive = await openDrive(env);
    if (folderToTrash) {
      try {
        await drive.trash({ id: folderToTrash });
      } catch (err) {
        if (err?.code !== 'not_found') throw err;
      }
    } else if (drivePackFileId) {
      try {
        await drive.trash({ id: drivePackFileId });
      } catch (err) {
        if (err?.code !== 'not_found') throw err;
      }
    }
  }

  try {
    await db.from('ltch_drive_folders').delete().in('folder_key', allKeys);
  } catch {}
}
