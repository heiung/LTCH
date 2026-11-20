export const FORUM_CATEGORIES = [
  {
    key: 'homework',
    label: 'Bài tập về nhà',
    pillLabel: 'Bài tập',
    badgeClass: 'badge-primary',
    iconName: 'assignment'
  },
  {
    key: 'lesson',
    label: 'Bài giảng trên lớp',
    pillLabel: 'Bài giảng',
    badgeClass: 'badge-info',
    iconName: 'material'
  },
  {
    key: 'exam',
    label: 'Luyện đề & Ôn thi',
    pillLabel: 'Luyện đề',
    badgeClass: 'badge-warning',
    iconName: 'practice'
  },
  {
    key: 'tip',
    label: 'Chia sẻ & Phương pháp',
    pillLabel: 'Phương pháp',
    badgeClass: 'badge-mint',
    iconName: 'check'
  },
  {
    key: 'general',
    label: 'Thảo luận chung',
    pillLabel: 'Chung',
    badgeClass: 'badge-neutral',
    iconName: 'message'
  }
];

const CATEGORY_MAP = Object.fromEntries(FORUM_CATEGORIES.map(item => [item.key, item]));
const VALID_CATEGORY_KEYS = new Set(FORUM_CATEGORIES.map(item => item.key));
const POST_META_PREFIX_RE = /^\[\[ltch-forum:([^\]]+)\]\](?:\r?\n)?([\s\S]*)$/i;
const COMMENT_META_PREFIX_RE = /^\[\[ltch-fcm:([^\]]+)\]\](?:\r?\n)?([\s\S]*)$/i;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function stripForumDiacriticsLower(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

export function getForumCategoryMeta(category = 'general') {
  return CATEGORY_MAP[category] || CATEGORY_MAP.general;
}

export function normalizeForumSessionNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 200) return null;
  return num;
}

export function inferForumCategory(rawTitle = '', rawBody = '') {
  const combined = stripForumDiacriticsLower(`${rawTitle} ${rawBody}`);
  if (!combined) return 'general';
  if (/(btvn|bai tap|phieu bai|nop bai|bai ve nha|cau \d+\s*(btvn|bai tap))/.test(combined)) {
    return 'homework';
  }
  if (/(phong luyen|luyen de|de thi|thi thu|thptqg|hsa|tsa|kiem tra|dap an de|de minh hoa)/.test(combined)) {
    return 'exam';
  }
  if (/(bai giang|buoi \d+|ly thuyet|slide|video giang|tai lieu buoi)/.test(combined)) {
    return 'lesson';
  }
  if (/(phuong phap|meo|kinh nghiem|ghi nho|cach lam nhanh|tong hop cong thuc|chia se)/.test(combined)) {
    return 'tip';
  }
  return 'general';
}

export function inferForumSessionNumber(rawTitle = '', rawBody = '') {
  const titleMatch = /(?:^|\s)buoi\s+(\d{1,3})(?=\s|$|[:.,\-–—])/i.exec(stripForumDiacriticsLower(rawTitle));
  if (titleMatch) {
    const num = normalizeForumSessionNumber(titleMatch[1]);
    if (num) return num;
  }
  const bodyMatch = /(?:^|\s)buoi\s+(\d{1,3})(?=\s|$|[:.,\-–—])/i.exec(stripForumDiacriticsLower(rawBody));
  if (bodyMatch) {
    const num = normalizeForumSessionNumber(bodyMatch[1]);
    if (num) return num;
  }
  return null;
}

export function encodeForumPostMeta({
  category = 'general',
  sessionNumber = null,
  pinned = false,
  resolved = false,
  acceptedCommentId = null,
  locked = false,
  editedAt = null,
  body = ''
} = {}) {
  const safeCategory = VALID_CATEGORY_KEYS.has(category) ? category : 'general';
  const safeSession = normalizeForumSessionNumber(sessionNumber);
  const safeAccepted =
    typeof acceptedCommentId === 'string' && SAFE_ID_RE.test(acceptedCommentId.trim())
      ? acceptedCommentId.trim()
      : null;
  const safeResolved = Boolean(resolved || safeAccepted);
  const safePinned = Boolean(pinned);
  const safeLocked = Boolean(locked);
  const parsedEdited = Number(editedAt);
  const safeEdited = Number.isSafeInteger(parsedEdited) && parsedEdited > 0 ? parsedEdited : null;

  const rawStr = String(body ?? '');
  const matched = POST_META_PREFIX_RE.exec(rawStr);
  const cleanBody = (matched ? matched[2] : rawStr).replace(/^\r?\n/, '');

  const parts = [];
  if (safeCategory !== 'general') parts.push(`cat=${safeCategory}`);
  if (safeSession) parts.push(`ses=${safeSession}`);
  if (safePinned) parts.push('pin=1');
  if (safeResolved) parts.push('solved=1');
  if (safeAccepted) parts.push(`ans=${safeAccepted}`);
  if (safeLocked) parts.push('locked=1');
  if (safeEdited) parts.push(`edited=${safeEdited}`);

  if (!parts.length) return cleanBody;
  const header = `[[ltch-forum:${parts.join('|')}]]`;
  return cleanBody ? `${header}\n${cleanBody}` : header;
}

export function decodeForumPostMeta(rawBody = '', rawTitle = '') {
  const str = String(rawBody ?? '');
  const matched = POST_META_PREFIX_RE.exec(str);
  if (matched) {
    const pairs = matched[1].split('|').map(part => part.trim()).filter(Boolean);
    let category = 'general';
    let sessionNumber = null;
    let pinned = false;
    let resolved = false;
    let acceptedCommentId = null;
    let locked = false;
    let editedAt = null;

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) continue;
      const rawKey = pair.slice(0, eqIdx).trim().toLowerCase();
      const rawVal = pair.slice(eqIdx + 1).trim();
      const lowerVal = rawVal.toLowerCase();
      if (rawKey === 'cat' && VALID_CATEGORY_KEYS.has(lowerVal)) {
        category = lowerVal;
      } else if (rawKey === 'ses') {
        sessionNumber = normalizeForumSessionNumber(rawVal);
      } else if (rawKey === 'pin') {
        pinned = lowerVal === '1' || lowerVal === 'true';
      } else if (rawKey === 'solved') {
        resolved = lowerVal === '1' || lowerVal === 'true';
      } else if (rawKey === 'ans' && SAFE_ID_RE.test(rawVal)) {
        acceptedCommentId = rawVal;
      } else if (rawKey === 'locked') {
        locked = lowerVal === '1' || lowerVal === 'true';
      } else if (rawKey === 'edited') {
        const ts = Number(rawVal);
        if (Number.isSafeInteger(ts) && ts > 0) editedAt = ts;
      }
    }

    if (acceptedCommentId) resolved = true;
    return {
      category,
      categoryMeta: getForumCategoryMeta(category),
      sessionNumber,
      pinned,
      resolved,
      acceptedCommentId,
      locked,
      editedAt,
      cleanBody: matched[2] ?? '',
      hasExplicitMeta: true
    };
  }

  const inferredCategory = inferForumCategory(rawTitle, str);
  const inferredSession = inferForumSessionNumber(rawTitle, str);
  return {
    category: inferredCategory,
    categoryMeta: getForumCategoryMeta(inferredCategory),
    sessionNumber: inferredSession,
    pinned: false,
    resolved: false,
    acceptedCommentId: null,
    locked: false,
    editedAt: null,
    cleanBody: str,
    hasExplicitMeta: false
  };
}

export function encodeForumCommentMeta({ editedAt = null, body = '' } = {}) {
  const rawStr = String(body ?? '');
  const matched = COMMENT_META_PREFIX_RE.exec(rawStr);
  const cleanBody = (matched ? matched[2] : rawStr).replace(/^\r?\n/, '');
  const parsedEdited = Number(editedAt);
  const safeEdited = Number.isSafeInteger(parsedEdited) && parsedEdited > 0 ? parsedEdited : null;
  if (!safeEdited) return cleanBody;
  const header = `[[ltch-fcm:edited=${safeEdited}]]`;
  return cleanBody ? `${header}\n${cleanBody}` : header;
}

export function decodeForumCommentMeta(rawBody = '') {
  const str = String(rawBody ?? '');
  const matched = COMMENT_META_PREFIX_RE.exec(str);
  if (!matched) {
    return { editedAt: null, cleanBody: str, hasExplicitMeta: false };
  }
  let editedAt = null;
  for (const pair of matched[1].split('|').map(p => p.trim()).filter(Boolean)) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const rawKey = pair.slice(0, eqIdx).trim().toLowerCase();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (rawKey === 'edited') {
      const ts = Number(rawVal);
      if (Number.isSafeInteger(ts) && ts > 0) editedAt = ts;
    }
  }
  return {
    editedAt,
    cleanBody: matched[2] ?? '',
    hasExplicitMeta: true
  };
}

export function deriveForumPostStatus({
  resolved = false,
  acceptedCommentId = null,
  commentCount = 0,
  hasStaffReply = false,
  locked = false
} = {}) {
  if (resolved || acceptedCommentId) {
    return { key: 'solved', label: 'Đã giải đáp', tone: 'success', badgeClass: 'badge-success' };
  }
  if (hasStaffReply) {
    return { key: 'staff_replied', label: 'GV đã phản hồi', tone: 'info', badgeClass: 'badge-info' };
  }
  if (Number(commentCount) > 0) {
    return { key: 'discussing', label: 'Đang thảo luận', tone: 'neutral', badgeClass: 'badge-neutral' };
  }
  if (locked) {
    return { key: 'locked', label: 'Đã khóa', tone: 'neutral', badgeClass: 'badge-neutral' };
  }
  return { key: 'waiting', label: 'Chờ giải đáp', tone: 'warning', badgeClass: 'badge-warning' };
}

function tokenizeMathSafeSegments(input) {
  const text = String(input ?? '');
  const parts = [];
  let start = 0;
  let i = 0;
  const escaped = pos => {
    let count = 0;
    for (let j = pos - 1; j >= 0 && text[j] === '\\'; j--) count++;
    return count % 2 === 1;
  };
  while (i < text.length) {
    let open = '';
    let close = '';
    let display = false;
    if (text[i] === '$' && !escaped(i)) {
      open = text[i + 1] === '$' ? '$$' : '$';
      close = open;
      display = open === '$$';
    } else if (text[i] === '\\' && !escaped(i) && (text[i + 1] === '(' || text[i + 1] === '[')) {
      open = text.slice(i, i + 2);
      close = text[i + 1] === '(' ? '\\)' : '\\]';
      display = text[i + 1] === '[';
    } else {
      i++;
      continue;
    }
    let end = i + open.length;
    while (end < text.length) {
      if (!display && text[end] === '\n') break;
      if (text.startsWith(close, end) && !escaped(end)) break;
      end++;
    }
    if (end >= text.length || !text.startsWith(close, end)) {
      i = end < text.length ? end + 1 : text.length;
      continue;
    }
    if (i > start) parts.push({ type: 'text', raw: text.slice(start, i) });
    parts.push({ type: 'math', raw: text.slice(i, end + close.length) });
    i = end + close.length;
    start = i;
  }
  if (start < text.length) parts.push({ type: 'text', raw: text.slice(start) });
  return parts;
}

/**
 * Rút gọn nội dung bài viết cho thẻ danh sách mà không bao giờ cắt ngang công thức toán.
 */
export function summarizeForumExcerpt(cleanBody = '', maxLen = 190) {
  const source = String(cleanBody ?? '').trim();
  if (!source) return '';
  const limit = Math.max(40, Number(maxLen) || 190);
  const segments = tokenizeMathSafeSegments(source);
  const chunks = [];
  let len = 0;
  let truncated = false;

  for (const seg of segments) {
    const piece = seg.type === 'text' ? seg.raw.replace(/\s+/g, ' ') : seg.raw;
    if (!piece) continue;
    if (len + piece.length <= limit) {
      chunks.push(piece);
      len += piece.length;
      continue;
    }

    if (seg.type === 'text') {
      const remaining = limit - len;
      if (remaining > 12) {
        let cut = piece.slice(0, remaining);
        const lastSpace = cut.lastIndexOf(' ');
        if (lastSpace > Math.floor(remaining * 0.5)) cut = cut.slice(0, lastSpace);
        chunks.push(cut.trimEnd());
      }
      truncated = true;
      break;
    }

    // Do not split a math token; keep intact only if nothing precedes it, otherwise end cleanly before it.
    if (!chunks.length) {
      chunks.push(piece);
    } else {
      truncated = true;
    }
    break;
  }

  let out = chunks.join('').replace(/\s+/g, ' ').trim();
  if (!out && source) {
    out = source.replace(/\s+/g, ' ').trim().slice(0, limit).trimEnd();
    truncated = source.length > limit;
  }
  if (truncated && !out.endsWith('…')) {
    out = `${out.replace(/[,.;:\-–—\s]+$/, '')}…`;
  }
  return out;
}

export function formatRelativeForumTimeVi(timestampMs, nowMs = Date.now()) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffMs = Math.max(0, Number(nowMs) - ts);
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Vừa đăng';
  if (diffMins < 60) return `${diffMins} phút trước`;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 30) return `${diffDays} ngày trước`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} tháng trước`;
  return `${Math.floor(diffDays / 365)} năm trước`;
}

export function computeForumStats(posts = [], currentUid = null) {
  const list = Array.isArray(posts) ? posts : [];
  let waitingCount = 0;
  let openCount = 0;
  let solvedCount = 0;
  let staffRepliedCount = 0;
  let pinnedCount = 0;
  let mineCount = 0;
  let myOpenCount = 0;
  let mySolvedCount = 0;

  for (const post of list) {
    if (!post) continue;
    const isSolved = Boolean(post.resolved || post.accepted_comment_id);
    const hasStaff = Boolean(post.has_staff_reply);
    const isLocked = Boolean(post.locked);
    if (isSolved) solvedCount++;
    else {
      openCount++;
      if (!hasStaff && !isLocked) waitingCount++;
    }
    if (hasStaff) staffRepliedCount++;
    if (post.pinned) pinnedCount++;
    if (currentUid && post.author_uid === currentUid) {
      mineCount++;
      if (isSolved) mySolvedCount++;
      else myOpenCount++;
    }
  }

  return {
    total: list.length,
    waitingCount,
    openCount,
    solvedCount,
    staffRepliedCount,
    pinnedCount,
    mineCount,
    myOpenCount,
    mySolvedCount
  };
}

export function sortAndFilterForumPosts(
  posts = [],
  {
    statusFilter = 'all',
    category = 'all',
    sessionNumber = null,
    searchQuery = '',
    sortBy = 'activity',
    currentUid = null
  } = {}
) {
  const list = Array.isArray(posts) ? posts : [];
  const normQuery = stripForumDiacriticsLower(searchQuery);
  const targetSession = normalizeForumSessionNumber(sessionNumber);

  const filtered = list.filter(post => {
    if (!post) return false;
    const isSolved = Boolean(post.resolved || post.accepted_comment_id);
    const isWaitingStaff = !isSolved && !post.locked && !post.has_staff_reply;
    if (statusFilter === 'waiting' || statusFilter === 'needs_answer') {
      if (!isWaitingStaff) return false;
    } else if (statusFilter === 'open') {
      if (isSolved) return false;
    } else if (statusFilter === 'solved') {
      if (!isSolved) return false;
    } else if (statusFilter === 'pinned') {
      if (!post.pinned) return false;
    } else if (statusFilter === 'mine') {
      if (!currentUid || post.author_uid !== currentUid) return false;
    } else if (statusFilter === 'staff_replied') {
      if (!post.has_staff_reply) return false;
    }

    if (category && category !== 'all') {
      const cat = post.category || 'general';
      if (cat !== category) return false;
    }

    if (targetSession) {
      if (normalizeForumSessionNumber(post.session_number) !== targetSession) return false;
    }

    if (normQuery) {
      const catLabel = getForumCategoryMeta(post.category).label;
      const sessionHint = post.session_number ? `buoi ${post.session_number}` : '';
      const hay = stripForumDiacriticsLower(
        `${post.title || ''} ${post.body || ''} ${post.author_name || ''} ${catLabel} ${sessionHint}`
      );
      if (!hay.includes(normQuery)) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const pinDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
    if (pinDiff !== 0) return pinDiff;

    if (sortBy === 'unanswered') {
      const aWaiting = !a.resolved && !a.accepted_comment_id && !a.locked && !a.has_staff_reply ? 0 : !a.resolved ? 1 : 2;
      const bWaiting = !b.resolved && !b.accepted_comment_id && !b.locked && !b.has_staff_reply ? 0 : !b.resolved ? 1 : 2;
      if (aWaiting !== bWaiting) return aWaiting - bWaiting;
      return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    }

    if (sortBy === 'newest') {
      return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    }

    const aAct = Number(a.latest_activity_at || a.created_at || 0);
    const bAct = Number(b.latest_activity_at || b.created_at || 0);
    if (bAct !== aAct) return bAct - aAct;
    return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
  });

  return sorted;
}
