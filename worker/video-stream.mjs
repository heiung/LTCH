import { ApiError, demand, id } from './policy.mjs';
import { configuredDrive, clearCachedDriveAuth } from './lesson-storage.mjs';
import { resolveApiOrigin } from './config.mjs';

export const VIDEO_TICKET_LIFETIME_MS = 4 * 60 * 60 * 1000;
export const MAX_VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const VIDEO_TICKET_AAD = textEncoder.encode('ltch-video-stream-v1');

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(value) {
  demand(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 4096, 403, 'Liên kết phát video không hợp lệ.');
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const s = atob(padded);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ.');
  }
}

async function videoStreamKey(env) {
  const raw = env?.MAIL_SECRET;
  demand(typeof raw === 'string' && raw.length >= 32, 503, 'Dịch vụ phát video chưa được cấu hình an toàn.');
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(`ltch:video-stream-ticket:v1:${raw}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealVideoStreamTicket(env, { uid, driveFileId, mimeType, size }, now = Date.now()) {
  const actorUid = id(uid);
  demand(typeof driveFileId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(driveFileId), 400, 'Mã tệp video không hợp lệ.');
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  demand(/^video\/[a-z0-9!#$&^_.+-]+$/i.test(cleanMime) && cleanMime.length <= 127, 400, 'Định dạng video không hợp lệ.');
  const numericSize = Number(size);
  demand(
    Number.isSafeInteger(numericSize) && numericSize >= 1 && numericSize <= MAX_VIDEO_BYTES,
    400,
    'Kích thước video không hợp lệ.'
  );

  const key = await videoStreamKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = textEncoder.encode(
    JSON.stringify({
      u: actorUid,
      f: driveFileId,
      m: cleanMime,
      s: numericSize,
      exp: now + VIDEO_TICKET_LIFETIME_MS
    })
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: VIDEO_TICKET_AAD },
    key,
    payload
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(cipher))}`;
}

export async function openVideoStreamTicket(env, ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || !ticket || ticket.length > 2048) {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }
  const key = await videoStreamKey(env);
  let iv;
  let cipher;
  try {
    iv = b64urlDecode(parts[1]);
    cipher = b64urlDecode(parts[2]);
  } catch {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }
  if (iv.length !== 12 || cipher.length < 16) {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }
  let parsed;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: VIDEO_TICKET_AAD },
      key,
      cipher
    );
    parsed = JSON.parse(textDecoder.decode(plain));
  } catch {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Number.isSafeInteger(parsed.exp) ||
    parsed.exp <= now ||
    parsed.exp > now + VIDEO_TICKET_LIFETIME_MS + 60_000 ||
    typeof parsed.f !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(parsed.f) ||
    typeof parsed.m !== 'string' ||
    !/^video\/[a-z0-9!#$&^_.+-]+$/i.test(parsed.m) ||
    parsed.m.length > 127 ||
    !Number.isSafeInteger(parsed.s) ||
    parsed.s < 1 ||
    parsed.s > MAX_VIDEO_BYTES
  ) {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }

  try {
    id(parsed.u);
  } catch {
    throw new ApiError(403, 'Liên kết phát video không hợp lệ hoặc đã hết hạn.');
  }

  return {
    uid: parsed.u,
    driveFileId: parsed.f,
    mimeType: parsed.m,
    size: parsed.s,
    expiresAt: parsed.exp
  };
}

export function buildVideoStreamUrl(env, requestUrl, ticket) {
  const baseOrigin = resolveApiOrigin(env, requestUrl);
  return `${baseOrigin}/api/video-media?ticket=${encodeURIComponent(ticket)}`;
}

export function parseVideoByteRange(rangeHeader, totalSize, maxChunkBytes = MAX_VIDEO_CHUNK_BYTES) {
  const raw = String(rangeHeader || '').trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
  demand(match && (match[1] !== '' || match[2] !== ''), 416, 'Phạm vi video không hợp lệ.');
  demand(Number.isSafeInteger(totalSize) && totalSize > 0, 416, 'Phạm vi video không hợp lệ.');

  let start;
  let requestedEnd = null;
  if (!match[1] && match[2]) {
    const suffix = Number(match[2]);
    demand(Number.isSafeInteger(suffix) && suffix > 0, 416, 'Phạm vi video không hợp lệ.');
    start = Math.max(0, totalSize - suffix);
    requestedEnd = totalSize - 1;
  } else {
    start = Number(match[1]);
    demand(Number.isSafeInteger(start) && start >= 0 && start < totalSize, 416, 'Phạm vi video không hợp lệ.');
    if (match[2] !== '') {
      const parsedEnd = Number(match[2]);
      demand(Number.isSafeInteger(parsedEnd) && parsedEnd >= start, 416, 'Phạm vi video không hợp lệ.');
      requestedEnd = Math.min(parsedEnd, totalSize - 1);
    }
  }

  const maxEnd = Math.min(totalSize - 1, start + Math.max(1, Number(maxChunkBytes) || MAX_VIDEO_CHUNK_BYTES) - 1);
  const effectiveEnd = requestedEnd === null ? maxEnd : Math.min(requestedEnd, maxEnd);
  return {
    start,
    end: effectiveEnd,
    header: `bytes=${start}-${effectiveEnd}`
  };
}

export async function videoMedia(request, { env, openDrive = configuredDrive, clearDriveCache = clearCachedDriveAuth } = {}) {
  demand(request.method === 'GET' || request.method === 'HEAD', 405);
  const ticketRaw = new URL(request.url).searchParams.get('ticket');
  const ticket = await openVideoStreamTicket(env, ticketRaw);

  const headers = new Headers({
    'content-type': ticket.mimeType,
    'content-disposition': 'inline',
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'cross-origin',
    'content-security-policy': "default-src 'none'; sandbox"
  });

  if (request.method === 'HEAD') {
    headers.set('content-length', String(ticket.size));
    return new Response(null, { status: 200, headers });
  }

  const rawRange = request.headers.get('range');
  let parsedRange = null;
  if (rawRange) {
    try {
      parsedRange = parseVideoByteRange(rawRange, ticket.size);
    } catch (err) {
      if (err instanceof ApiError && err.status === 416) {
        headers.set('content-type', 'application/json; charset=utf-8');
        headers.set('content-range', `bytes */${ticket.size}`);
        return new Response(JSON.stringify({ error: err.message }), { status: 416, headers });
      }
      throw err;
    }
  }

  const fetchUpstream = async () => {
    const drive = await openDrive(env);
    return drive.download({ id: ticket.driveFileId, range: parsedRange?.header });
  };

  let upstream;
  try {
    try {
      upstream = await fetchUpstream();
    } catch (err) {
      if (openDrive === configuredDrive && err?.code === 'authorization' && typeof clearDriveCache === 'function') {
        clearDriveCache();
        upstream = await fetchUpstream();
      } else {
        throw err;
      }
    }

    if (parsedRange) {
      const crMatch = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get('content-range') || '');
      demand(
        upstream.status === 206 &&
          crMatch &&
          Number(crMatch[1]) === parsedRange.start &&
          Number(crMatch[2]) >= parsedRange.start &&
          Number(crMatch[2]) < ticket.size &&
          Number(crMatch[3]) === ticket.size,
        503,
        'Không thể phát đoạn video từ Google Drive.'
      );
    }

    for (const key of ['content-length', 'content-range']) {
      const val = upstream.headers.get(key);
      if (val) headers.set(key, val);
    }
    if (!parsedRange && !headers.has('content-length')) {
      headers.set('content-length', String(ticket.size));
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Không thể phát video từ Google Drive.');
  }
}
