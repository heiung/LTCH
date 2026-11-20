export const SUBMISSION_ALLOWED_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

export const SUBMISSION_MAX_FILES = 12;
export const SUBMISSION_MAX_FILE_BYTES = 10_000_000;
export const SUBMISSION_MAX_TOTAL_BYTES = 25_000_000;
export const SUBMISSION_MAX_NOTE_LENGTH = 1000;

const EXT_TO_MIME = Object.freeze({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
});

const LEGACY_META_RE = /\s*<!--LTCH_SUB_META:([\s\S]*?)-->/;
const LEGACY_META_ALL_RE = /\s*<!--LTCH_SUB_META:[\s\S]*?-->/g;

export function normalizeSubmissionMimeType(contentType, fileName = '') {
  const cleanType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (cleanType === 'image/jpg' || cleanType === 'image/pjpeg') return 'image/jpeg';
  if (cleanType === 'application/x-pdf') return 'application/pdf';
  if (Object.prototype.hasOwnProperty.call(SUBMISSION_ALLOWED_TYPES, cleanType)) {
    return cleanType;
  }
  if (!cleanType || cleanType === 'application/octet-stream') {
    const extMatch = /\.([a-z0-9]{2,5})$/i.exec(String(fileName || '').trim());
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    return Object.prototype.hasOwnProperty.call(EXT_TO_MIME, ext) ? EXT_TO_MIME[ext] : null;
  }
  return null;
}

export function sanitizeSubmissionFileName(rawName, fallbackExt = 'bin', index = 0) {
  const safeExt = /^[a-z0-9]{2,5}$/i.test(String(fallbackExt || ''))
    ? String(fallbackExt).toLowerCase()
    : 'bin';
  const cleaned = String(rawName || '')
    .replace(/[\u0000-\u001f\u007f/\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = `bai-lam-${Number(index) + 1}.${safeExt}`;
  if (!cleaned) return fallback;
  if (cleaned.length <= 80) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0 && dot >= cleaned.length - 6) {
    const ext = cleaned.slice(dot);
    const stem = cleaned.slice(0, Math.max(1, 80 - ext.length)).trim();
    return `${stem || `bai-lam-${Number(index) + 1}`}${ext}`;
  }
  return cleaned.slice(0, 80).trim() || fallback;
}

export function isMissingSubmissionColumnError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    ['42703', 'PGRST204'].includes(code) ||
    /student_note|files|schema cache|does not exist|Could not find the/i.test(message)
  );
}

function normalizeLegacyFiles(files = []) {
  if (!Array.isArray(files)) return [];
  return files
    .map((f, index) => {
      const mime = String(f?.contentType ?? f?.content_type ?? f?.t ?? 'application/octet-stream');
      const fallbackExt = SUBMISSION_ALLOWED_TYPES[mime] || 'bin';
      return {
        n: sanitizeSubmissionFileName(f?.name ?? f?.n, fallbackExt, index),
        t: mime,
        s: Math.max(0, Math.trunc(Number(f?.size ?? f?.file_size ?? f?.s ?? 0) || 0)),
        p: String(f?.objectPath ?? f?.object_path ?? f?.p ?? '')
      };
    })
    .filter(f => f.p);
}

export function encodeLegacySubmissionFeedback({ feedback = '', note = '', files = [] } = {}) {
  const cleanFeedback = String(feedback || '').replace(LEGACY_META_ALL_RE, '').trim();
  const cleanNote = String(note || '').trim().slice(0, SUBMISSION_MAX_NOTE_LENGTH);
  const normalizedFiles = normalizeLegacyFiles(files);
  const needsMeta =
    Boolean(cleanNote) ||
    normalizedFiles.length > 1 ||
    (normalizedFiles.length === 1 && Boolean(normalizedFiles[0]?.n));
  if (!needsMeta) {
    return cleanFeedback.slice(0, 10000);
  }
  const metaSuffix = `\n\n<!--LTCH_SUB_META:${JSON.stringify({
    v: 1,
    note: cleanNote,
    files: normalizedFiles
  })}-->`;
  if (metaSuffix.length > 10000) {
    throw new RangeError('Dữ liệu bài nộp vượt quá giới hạn lưu trữ.');
  }
  const maxFeedbackLen = Math.max(0, 10000 - metaSuffix.length);
  const trimmedFeedback = cleanFeedback.length > maxFeedbackLen ? cleanFeedback.slice(0, maxFeedbackLen).trimEnd() : cleanFeedback;
  return trimmedFeedback ? `${trimmedFeedback}${metaSuffix}` : metaSuffix.trimStart();
}

export function decodeSubmissionRecord(row = {}) {
  const rawFeedback = typeof row?.feedback === 'string' ? row.feedback : '';
  const match = LEGACY_META_RE.exec(rawFeedback);
  let legacyMeta = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        legacyMeta = parsed;
      }
    } catch {
      legacyMeta = null;
    }
  }
  const cleanFeedback = rawFeedback.replace(LEGACY_META_ALL_RE, '').trim();
  const columnNote = typeof row?.student_note === 'string' ? row.student_note.trim() : '';
  const metaNote = typeof legacyMeta?.note === 'string' ? legacyMeta.note.trim() : '';
  const note = columnNote || metaNote;

  let files = [];
  if (Array.isArray(row?.files) && row.files.length > 0) {
    files = row.files.map((f, index) => {
      const contentType = String(f?.contentType ?? f?.content_type ?? f?.t ?? 'application/octet-stream');
      const ext = SUBMISSION_ALLOWED_TYPES[contentType] || 'bin';
      return {
        index,
        name: sanitizeSubmissionFileName(f?.name ?? f?.n, ext, index),
        contentType,
        size: Math.max(0, Math.trunc(Number(f?.size ?? f?.file_size ?? f?.s ?? 0) || 0)),
        objectPath: String(f?.objectPath ?? f?.object_path ?? f?.p ?? '')
      };
    });
  } else if (Array.isArray(legacyMeta?.files) && legacyMeta.files.length > 0) {
    files = legacyMeta.files.map((f, index) => {
      const contentType = String(f?.t ?? f?.contentType ?? f?.content_type ?? 'application/octet-stream');
      const ext = SUBMISSION_ALLOWED_TYPES[contentType] || 'bin';
      return {
        index,
        name: sanitizeSubmissionFileName(f?.n ?? f?.name, ext, index),
        contentType,
        size: Math.max(0, Math.trunc(Number(f?.s ?? f?.size ?? 0) || 0)),
        objectPath: String(f?.p ?? f?.objectPath ?? '')
      };
    });
  } else if (typeof row?.object_path === 'string' && row.object_path) {
    const contentType = String(row?.content_type || 'application/octet-stream');
    const ext = SUBMISSION_ALLOWED_TYPES[contentType] || 'bin';
    files = [
      {
        index: 0,
        name: sanitizeSubmissionFileName('', ext, 0),
        contentType,
        size: Math.max(0, Math.trunc(Number(row?.file_size) || 0)),
        objectPath: row.object_path
      }
    ];
  }

  return {
    feedback: cleanFeedback,
    note,
    files,
    hasLegacyMeta: Boolean(legacyMeta)
  };
}

export function toPublicSubmission(row = {}) {
  const { feedback, note, files } = decodeSubmissionRecord(row);
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    uid: row.uid,
    status: row.status,
    created_at: row.created_at,
    stored_at: row.stored_at,
    file_size: row.file_size,
    content_type: row.content_type,
    feedback,
    note,
    file_count: files.length,
    files: files.map((f, index) => ({
      index,
      name: f.name,
      content_type: f.contentType,
      size: f.size
    }))
  };
}
