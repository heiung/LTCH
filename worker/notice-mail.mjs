import { createHash, createHmac, randomBytes } from 'node:crypto';
import { data } from './policy.mjs';
import templates from '../server/domain/notification-templates.cjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatVietnamDateTime(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(Number(ms) || Date.now()));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.hour}:${map.minute} ${map.day}/${map.month}/${map.year}`;
}

function resolveSenderName(accounts, actor) {
  const actorAccount = (accounts || []).find(acc => acc?.uid === actor?.uid);
  const directName = actorAccount?.display_name?.trim() || actor?.name?.trim() || actor?.display_name?.trim();
  if (directName) return directName;
  const roles = Array.isArray(actor?.roles) ? actor.roles : [];
  if (roles.includes('admin')) return 'Ban Quản trị Lớp Toán cô Hạnh';
  if (roles.includes('teacher')) return 'Giáo viên Lớp Toán cô Hạnh';
  return 'Trợ giảng Lớp Toán cô Hạnh';
}

export async function resolveClassNoticeEmails(db, { classId, noticeId, title, body, actor, createdAt = Date.now() }) {
  const [classRes, membersRes] = await Promise.all([
    db.from('ltch_classes').select('id,name,archived').eq('id', classId).maybeSingle(),
    db.from('ltch_class_memberships').select('uid').eq('class_id', classId).eq('member_role', 'student').eq('status', 'active')
  ]);
  const klass = data(classRes);
  const members = data(membersRes) || [];
  if (!klass || klass.archived || !members.length) return [];

  const studentUids = [...new Set(members.map(m => m.uid).filter(Boolean))];
  if (!studentUids.length) return [];

  const lookupUids = [...new Set([...studentUids, actor?.uid].filter(Boolean))];
  const accounts = data(await db.from('ltch_accounts').select('uid,email,display_name,roles,status').eq('status', 'active').in('uid', lookupUids)) || [];

  const senderName = resolveSenderName(accounts, actor);
  const postedAt = formatVietnamDateTime(createdAt);
  const studentSet = new Set(studentUids);
  const messages = new Map();

  for (const acc of accounts) {
    if (!studentSet.has(acc?.uid) || acc?.status !== 'active') continue;
    if (!Array.isArray(acc.roles) || !acc.roles.includes('student')) continue;
    const email = acc.email?.trim().toLowerCase();
    if (!email || email.length > 254 || !emailPattern.test(email) || messages.has(email)) continue;

    const mail = templates.renderNotification('class_notice', {
      student_name: acc.display_name || 'em',
      class_name: klass.name || classId,
      notice_title: title,
      notice_body: body,
      class_id: classId,
      sender_name: senderName,
      posted_at: postedAt
    });
    const eventId = 'notice_' + createHash('sha256').update([noticeId, email].join('\n')).digest('hex');
    messages.set(email, { email, eventId, ...mail });
  }

  return [...messages.values()];
}

async function sendSingleNoticeMail(env, mail, fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const timestamp = Date.now();
      const nonce = randomBytes(16).toString('hex');
      const payload = JSON.stringify({
        email: mail.email,
        eventId: mail.eventId,
        subject: mail.subject,
        body: mail.body,
        htmlBody: mail.htmlBody
      });
      const signature = createHmac('sha256', env.MAIL_SECRET)
        .update([timestamp, nonce, payload].join('\n'))
        .digest('hex');
      const serialized = JSON.stringify({ kind: 'notification', timestamp, nonce, payload, signature })
        .replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
      const response = await fetchImpl(env.MAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: serialized,
        signal: AbortSignal.timeout(25000)
      });
      if (response.ok && (await response.json()).ok === true) return true;
    } catch {
      // EventId guarantees idempotent retry on temporary mail transport error.
    }
  }
  return false;
}

export async function notifyClassStudentsOfNotice({ db, env, classId, noticeId, title, body, actor, createdAt = Date.now(), fetchImpl = globalThis.fetch }) {
  try {
    const messages = await resolveClassNoticeEmails(db, { classId, noticeId, title, body, actor, createdAt });
    if (!messages.length) return { status: 'no_recipients', sent: 0, total: 0 };
    if (!env?.MAIL_ENDPOINT || typeof env?.MAIL_SECRET !== 'string' || env.MAIL_SECRET.length < 32) {
      return { status: 'not_configured', sent: 0, total: messages.length };
    }
    let sent = 0;
    for (let i = 0; i < messages.length; i += 6) {
      const results = await Promise.allSettled(messages.slice(i, i + 6).map(mail => sendSingleNoticeMail(env, mail, fetchImpl)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value === true) sent++;
      }
    }
    if (sent < messages.length) console.warn('LTCH_NOTICE_MAIL_PARTIAL', { sent, total: messages.length });
    return { status: sent === messages.length ? 'sent' : sent > 0 ? 'partial' : 'failed', sent, total: messages.length };
  } catch {
    console.warn('LTCH_NOTICE_MAIL_FAILED');
    return { status: 'failed', sent: 0, total: 0 };
  }
}
