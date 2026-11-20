export const LEGACY_NOTICE_READS_RE = /\r?\n?<!--LTCH_NOTICE_READS:([\s\S]*?)-->/;
export const LEGACY_NOTICE_READS_ALL_RE = /\r?\n?<!--LTCH_NOTICE_READS:[\s\S]*?-->/g;

const VALID_UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NOTICE_BODY_MAX_LENGTH = 20000;

function isValidReadUid(uid) {
  return (
    typeof uid === 'string' &&
    VALID_UID_RE.test(uid) &&
    uid !== '__proto__' &&
    uid !== 'constructor' &&
    uid !== 'prototype'
  );
}

function normalizeSeenAt(value) {
  const ts = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(ts) && ts > 0 ? ts : null;
}

export function stripLegacyNoticeReads(rawBody = '') {
  return String(rawBody ?? '').replace(LEGACY_NOTICE_READS_ALL_RE, '');
}

export function decodeLegacyNoticeReads(rawBody = '') {
  const rawStr = String(rawBody ?? '');
  const cleanBody = stripLegacyNoticeReads(rawStr);
  const readsMap = new Map();
  const matcher = new RegExp(LEGACY_NOTICE_READS_RE.source, 'g');
  let match;
  while ((match = matcher.exec(rawStr)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      for (const [uid, rawTs] of Object.entries(parsed)) {
        if (!isValidReadUid(uid)) continue;
        const ts = normalizeSeenAt(rawTs);
        if (ts === null) continue;
        const prev = readsMap.get(uid);
        if (prev === undefined || ts < prev) {
          readsMap.set(uid, ts);
        }
      }
    } catch {
      // Ignore malformed legacy read-receipt metadata.
    }
  }
  const reads = {};
  for (const [uid, ts] of readsMap.entries()) {
    Object.defineProperty(reads, uid, {
      value: ts,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return { cleanBody, reads };
}

export function encodeLegacyNoticeReads(rawBody = '', readsMap = {}) {
  const cleanBody = stripLegacyNoticeReads(rawBody);
  const entries = readsMap instanceof Map
    ? [...readsMap.entries()]
    : readsMap && typeof readsMap === 'object'
      ? Object.entries(readsMap)
      : [];

  const normalized = new Map();
  for (const [uid, rawTs] of entries) {
    if (!isValidReadUid(uid)) continue;
    const ts = normalizeSeenAt(rawTs);
    if (ts === null) continue;
    const prev = normalized.get(uid);
    if (prev === undefined || ts < prev) {
      normalized.set(uid, ts);
    }
  }

  if (!normalized.size) {
    return cleanBody;
  }

  const sortedObj = {};
  for (const uid of [...normalized.keys()].sort()) {
    Object.defineProperty(sortedObj, uid, {
      value: normalized.get(uid),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }

  const encoded = `${cleanBody}\n<!--LTCH_NOTICE_READS:${JSON.stringify(sortedObj)}-->`;
  if (encoded.length > NOTICE_BODY_MAX_LENGTH) {
    throw new RangeError('Dữ liệu xác nhận đã xem vượt quá giới hạn lưu trữ.');
  }
  return encoded;
}

export function isMissingNoticeReadsTableError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    ['42P01', 'PGRST205'].includes(code) ||
    (/ltch_notice_reads/i.test(message) && /does not exist|schema cache|Could not find/i.test(message))
  );
}

export function mergeNoticeReads(tableRows = [], legacyReadsMap = {}) {
  const merged = new Map();
  const record = (uid, rawTs) => {
    if (!isValidReadUid(uid)) return;
    const ts = normalizeSeenAt(rawTs);
    if (ts === null) return;
    const prev = merged.get(uid);
    if (prev === undefined || ts < prev) {
      merged.set(uid, ts);
    }
  };

  if (legacyReadsMap instanceof Map) {
    for (const [uid, ts] of legacyReadsMap.entries()) record(uid, ts);
  } else if (legacyReadsMap && typeof legacyReadsMap === 'object') {
    for (const [uid, ts] of Object.entries(legacyReadsMap)) record(uid, ts);
  }

  for (const row of Array.isArray(tableRows) ? tableRows : []) {
    if (!row) continue;
    record(row.uid, row.seen_at ?? row.seenAt);
  }

  return merged;
}

export function summarizeNoticeReads({
  readsMap,
  studentUids = [],
  parentLinks = [],
  allowedOtherUids = null
} = {}) {
  const map = readsMap instanceof Map
    ? readsMap
    : mergeNoticeReads([], readsMap);
  const studentSet = new Set((Array.isArray(studentUids) ? studentUids : []).filter(Boolean));
  const parentSet = new Set(
    (Array.isArray(parentLinks) ? parentLinks : [])
      .map(link => link?.parent_uid)
      .filter(uid => uid && !studentSet.has(uid))
  );
  const allowedOtherSet = allowedOtherUids
    ? new Set([...allowedOtherUids].filter(Boolean))
    : null;

  let student_seen = 0;
  let parent_seen = 0;
  let other_seen = 0;

  for (const uid of map.keys()) {
    if (studentSet.has(uid)) {
      student_seen++;
    } else if (parentSet.has(uid)) {
      parent_seen++;
    } else if (!allowedOtherSet || allowedOtherSet.has(uid)) {
      other_seen++;
    }
  }

  const total_students = studentSet.size;
  const total_seen = student_seen + parent_seen + other_seen;

  return {
    total_seen,
    student_seen,
    total_students,
    parent_seen,
    other_seen
  };
}
